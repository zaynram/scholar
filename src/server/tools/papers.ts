// src/server/tools/papers.ts — extraction cycle 6.6 (Green)
//
// scholar.papers.search   — hybrid lexical + sqlite-vec (RRF k=60)
// scholar.papers.update   — status / priority / depth / role / section
// scholar.paper.show      — view-opener (§7.6 owner table)
// scholar.progress.show   — view-opener (§7.6 owner table)
//
// Hybrid scoring (§6.6 "hybrid lexical + sqlite-vec"): the spec leaves the
// fusion formula unspecified. We adopt Reciprocal Rank Fusion (Cormack &
// Clarke 2009) with k=60 — defensible, parameter-light, unbiased between
// backends. Lexical ranking is case-insensitive LIKE %q% over title +
// authors, ordered by title COLLATE NOCASE. Semantic ranking is
// vec_distance_cosine(embedding, qvec) ascending, aggregated per paper
// using the minimum (closest chunk wins).
//
// Degradation (§11): when settings.chunk_vec.created='false', the semantic
// branch is skipped entirely and the response carries `still_indexing: true`
// so the UI can render the "still indexing" pill.

import { sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { z } from "zod";
import { rawClient } from "../db/raw-client.ts";
import { toTightFloat32 } from "../db/sqlite-vec.ts";
import { nowIso } from "../db/nowIso.ts";
import { APP_URI, viewMeta } from "../ui/resource.ts";
import {
  ollama,
  DEFAULT_EMBED_MODEL,
  OllamaUnavailableError,
} from "../ollama/client.ts";
import type { RegisterTools, ServerContext } from "./registry.ts";

// ─── error ────────────────────────────────────────────────────────────────────

export class PapersToolError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PapersToolError";
  }
}

// ─── shapes ───────────────────────────────────────────────────────────────────

export type SearchArgs = { q: string; limit?: number };
export type SearchHit = {
  id: string;
  key: string;
  title: string;
  score: number;
  lex_rank?: number;
  vec_rank?: number;
};
export type SearchResult = { hits: SearchHit[]; still_indexing: boolean };

export type SearchCtx = ServerContext & {
  embed?: (model: string, prompt: string) => Promise<Float32Array>;
};

export type UpdateArgs = {
  paper_id: string;
  status?: "pending" | "reading" | "reviewed" | "skip";
  priority?: number;
  depth?: "cited" | "background" | "deep";
  role?: string;
  section?: string;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function chunkVecReady(db: BunSQLiteDatabase): boolean {
  try {
    const rows = db.all(
      sql`SELECT value FROM settings WHERE key = 'chunk_vec.created'`,
    ) as { value: string }[];
    return rows.length > 0 && rows[0]!.value === "true";
  } catch {
    return false;
  }
}

// ─── search ───────────────────────────────────────────────────────────────────

export async function searchPapers(
  ctx: SearchCtx,
  args: SearchArgs,
): Promise<SearchResult> {
  const db = ctx.db;
  if (!db) {
    throw new PapersToolError(
      "NO_ACTIVE_CORPUS",
      "NO_ACTIVE_CORPUS: scholar.papers.search requires an active corpus.",
    );
  }
  const limit = args.limit ?? 20;
  const semanticOn = chunkVecReady(db);
  const raw = rawClient(db);

  // Lexical: case-insensitive substring across title + authors.
  const lexLike = `%${args.q}%`;
  const lexRows = raw.prepare(
    `SELECT id, key, title FROM papers
     WHERE LOWER(title) LIKE LOWER(?) OR LOWER(COALESCE(authors,'')) LIKE LOWER(?)
     ORDER BY title COLLATE NOCASE
     LIMIT 200`,
  ).all(lexLike, lexLike) as Array<{ id: string; key: string; title: string }>;
  const lexRank = new Map<string, number>(lexRows.map((r, i) => [r.id, i + 1]));

  // Semantic: vec_distance_cosine asc → per-paper best (smallest) distance.
  let vecRank = new Map<string, number>();
  if (semanticOn) {
    const embed = ctx.embed ?? ((m: string, p: string) => ollama.embed(m, p));
    try {
      // Audit M3: normalize a possibly-view embedding to a tightly-packed
      // Float32Array at the bind site (defense-in-depth — bun:sqlite handles
      // sliced views correctly today, but ctx.embed is test-injectable and
      // future driver swaps may not).
      const qvec = toTightFloat32(await embed(DEFAULT_EMBED_MODEL, args.q));
      // Audit M5: per-paper aggregation downstream picks MIN(d) per paper_id,
      // so the global LIMIT here must be large enough that several papers
      // each get at least one chunk represented. The old LIMIT 200 starved
      // diversity on corpora where any one paper had ≥200 close-ranking
      // chunks. 1000 covers the personal-use scale (5k chunks budget per
      // audit note). The deferred KNN-per-paper subquery rewrite would be
      // structurally tighter but needs a benchmark; tracked separately.
      const vecRows = raw.prepare(
        `SELECT pc.paper_id AS paper_id,
                vec_distance_cosine(cv.embedding, ?) AS d
           FROM chunk_vec cv
           JOIN paper_chunks pc ON pc.id = cv.chunk_id
           ORDER BY d ASC
           LIMIT 1000`,
      ).all(qvec) as Array<{ paper_id: string; d: number }>;
      const best = new Map<string, number>();
      for (const r of vecRows) {
        const cur = best.get(r.paper_id);
        if (cur === undefined || r.d < cur) best.set(r.paper_id, r.d);
      }
      const sorted = Array.from(best.entries()).sort((a, b) => a[1] - b[1]);
      vecRank = new Map(sorted.map(([pid], i) => [pid, i + 1]));
    } catch (err) {
      if (err instanceof OllamaUnavailableError) {
        ctx.log.warn("semantic search degraded — Ollama unavailable", { error: err.message });
        vecRank = new Map();
      } else {
        throw err;
      }
    }
  }

  // RRF fusion (k=60).
  const allIds = new Set<string>([...lexRank.keys(), ...vecRank.keys()]);
  const metaStmt = raw.prepare(
    "SELECT key, title FROM papers WHERE id = ?",
  );
  const fused: SearchHit[] = [];
  for (const id of allIds) {
    const lr = lexRank.get(id);
    const vr = vecRank.get(id);
    const score = (lr ? 1 / (60 + lr) : 0) + (vr ? 1 / (60 + vr) : 0);
    const meta = metaStmt.get(id) as { key: string; title: string } | undefined;
    fused.push({
      id,
      key: meta?.key ?? "",
      title: meta?.title ?? "",
      score,
      lex_rank: lr,
      vec_rank: vr,
    });
  }
  fused.sort((a, b) => b.score - a.score);
  return { hits: fused.slice(0, limit), still_indexing: !semanticOn };
}

// ─── update ───────────────────────────────────────────────────────────────────

export async function updatePaper(
  ctx: ServerContext,
  args: UpdateArgs,
): Promise<{ paper_id: string }> {
  const db = ctx.db;
  if (!db) {
    throw new PapersToolError(
      "NO_ACTIVE_CORPUS",
      "NO_ACTIVE_CORPUS: scholar.papers.update requires an active corpus.",
    );
  }
  const raw = rawClient(db);
  const sets: string[] = [];
  const vals: Array<string | number | null> = [];
  if (args.status !== undefined) {
    sets.push("status = ?", "status_touched_at = ?");
    vals.push(args.status, nowIso());
  }
  if (args.priority !== undefined) {
    sets.push("priority = ?");
    vals.push(args.priority);
  }
  if (args.depth !== undefined) {
    sets.push("depth = ?");
    vals.push(args.depth);
  }
  if (args.role !== undefined) {
    sets.push("role = ?");
    vals.push(args.role);
  }
  if (args.section !== undefined) {
    sets.push("section = ?");
    vals.push(args.section);
  }
  if (sets.length === 0) return { paper_id: args.paper_id };
  vals.push(args.paper_id);
  // sets is constructed from a fixed enum of column tokens above, NOT from
  // user input — safe to interpolate. Parameter values bind through `?` only.
  raw.prepare(`UPDATE papers SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return { paper_id: args.paper_id };
}

// ─── registerTools ────────────────────────────────────────────────────────────

export const registerTools: RegisterTools = (_server, ctx, _register) => {
  _register(
    "scholar.papers.search",
    {
      description:
        "Hybrid lexical + semantic search across the active corpus. " +
        "Reciprocal Rank Fusion (k=60) over LIKE matches and sqlite-vec " +
        "cosine distance. Degrades to lexical-only with still_indexing=true " +
        "when chunk_vec has not yet been materialized.",
      inputSchema: z.object({
        q: z.string().min(1),
        limit: z.number().int().positive().optional(),
      }),
    },
    async (args) => {
      const parsed = (args ?? {}) as SearchArgs;
      return await searchPapers(ctx as SearchCtx, parsed);
    },
  );
  _register(
    "scholar.papers.update",
    {
      description:
        "Partial-update a paper row: status, priority, depth, role, section. " +
        "Status flips bump status_touched_at so the reading_queue view reorders.",
      inputSchema: z.object({
        paper_id: z.string().min(1),
        status: z.enum(["pending", "reading", "reviewed", "skip"]).optional(),
        priority: z.number().int().optional(),
        depth: z.enum(["cited", "background", "deep"]).optional(),
        role: z.string().optional(),
        section: z.string().optional(),
      }),
    },
    async (args) => {
      return await updatePaper(ctx, (args ?? {}) as UpdateArgs);
    },
  );

  // View-openers (§9 amendment 2026-06-04): emit the ViewInput discriminant in
  // structuredContent (promoted by the registry wrapper); the ui:// link rides
  // each def's `_meta.ui` (viewMeta). Retired the old `{openView:{resource,route}}`
  // shape — the route string carried no paper_id the App.tsx consumer could read.
  _register(
    "scholar.paper.show",
    {
      description: "Open the paper detail view for the given paper_id.",
      inputSchema: z.object({ paper_id: z.string().min(1) }),
      _meta: viewMeta(APP_URI),
    },
    async (args) => {
      const { paper_id } = (args ?? {}) as { paper_id: string };
      return { view: "paper", paper_id };
    },
  );
  _register(
    "scholar.progress.show",
    {
      description: "Open the reader-progress view.",
      inputSchema: z.object({}).passthrough(),
      _meta: viewMeta(APP_URI),
    },
    async () => ({ view: "progress" }),
  );
};

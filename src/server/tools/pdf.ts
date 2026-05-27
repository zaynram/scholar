// src/server/tools/pdf.ts — extraction cycle 6.5 (Green)
//
// Implements scholar.pdf.refresh-extraction per spec §5.12 + §11. Foundation
// scaffolded this module as a no-op stub at cycle 6.1; this cycle fills the
// body for the extraction pipeline. The thin proxy tools (scholar.pdf.open,
// scholar.pdf.search-text, scholar.pdf.extract-anchors) forward into the
// child pdf MCP via ctx.pdf.interact — registered minimally so the
// MCP-side surface advertises them; payload shapes are pdf-child verbatim.
//
// §11 contract:
//   1. extract via pdf-child get_text
//   2. if settings.chunk_vec.created='false' → probe embed dim via Ollama,
//      persist embed.{model,dim}, runRawDdl(db), flip flag
//   3. chunk via extraction/chunker
//   4. compute every embedding BEFORE opening the transaction (§13 discipline
//      applied to extraction: no awaits inside the closure)
//   5. inside one transaction:
//        a. orphan pre-pass DELETE chunk_vec (vec0 has no FK CASCADE per §8.2)
//        b. ordinal-shrinkage trim DELETE paper_chunks WHERE ordinal >= new_count
//        c. UPSERT paper_chunks ON CONFLICT(paper_id, ordinal) DO UPDATE
//           RETURNING id (RETURNING captures the post-UPSERT id so the
//           chunk_vec INSERT keys correctly — see §11.5 Ruling B)
//        d. INSERT OR REPLACE INTO chunk_vec(chunk_id, embedding)
//        e. UPDATE papers SET status_touched_at = nowIso()
//
// Ruling B rationale: paper_chunks.id is a fresh ulid() per row (not
// deterministic). Re-extract idempotency rides on the (paper_id, ordinal)
// unique index, NOT on id equality across runs. The chunk_vec orphan
// pre-pass exists because chunk_vec is a vec0 virtual table and does not
// participate in SQLite FK CASCADE — without it, re-extracts would leak
// stale embeddings keyed by chunk_ids that no longer exist in paper_chunks.

import { sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { z } from "zod";
import { rawClient } from "../db/raw-client.ts";
import { nowIso, ulid } from "../db/nowIso.ts";
import { runRawDdl } from "../db/raw-ddl.ts";
import { chunkText } from "../extraction/chunker.ts";
import {
  ollama,
  DEFAULT_EMBED_MODEL,
  OllamaUnavailableError,
} from "../ollama/client.ts";
import { loadVecAndProbeDim } from "../ingest/primitives.ts";
import type { RegisterTools, ServerContext } from "./registry.ts";

// ─── error ────────────────────────────────────────────────────────────────────

export class PdfToolError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PdfToolError";
  }
}

// ─── handler shapes ───────────────────────────────────────────────────────────

export type ExtractionEmbedFn = (model: string, prompt: string) => Promise<Float32Array>;

export type ExtractionCtx = ServerContext & {
  /** Test-only override: bypasses HTTP to Ollama. */
  embed?: ExtractionEmbedFn;
};

export type RefreshArgs = {
  paper_id: string;
  /** Test-only override for the §11 deferred-chunk_vec probe path. */
  _testProbeDim?: () => Promise<{ dim: number; modelTag: string }>;
};

export type RefreshResult = {
  paper_id: string;
  chunks_written: number;
  embeddings_persisted: number;
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

async function materializeChunkVec(
  db: BunSQLiteDatabase,
  probe?: () => Promise<{ dim: number; modelTag: string }>,
): Promise<void> {
  // Per §11 deferred-creation: probe Ollama for the embedding dimension, persist
  // settings.embed.{model,dim}, flip chunk_vec.created='true', then re-invoke
  // runRawDdl which now creates the vec0 table.
  const result = probe ? await probe() : await loadVecAndProbeDim(db);
  // Settings values are JSON-encoded so the ConfigAccessor read path
  // (JSON.parse(value)) round-trips. Use parameter binding rather than
  // `sql.raw` string concat so a future modelTag with a single quote in it
  // doesn't break out of the SQL literal (CLAUDE.md §12.0 discipline).
  const dimJson = JSON.stringify(result.dim);
  const modelJson = JSON.stringify(result.modelTag);
  db.run(sql`INSERT INTO settings(key,value) VALUES('embed.dim', ${dimJson})
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  db.run(sql`INSERT INTO settings(key,value) VALUES('embed.model', ${modelJson})
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  db.run(sql`INSERT INTO settings(key,value) VALUES('chunk_vec.created', 'true')
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  runRawDdl(db);
}

// ─── handler ──────────────────────────────────────────────────────────────────

export async function refreshExtraction(
  ctx: ExtractionCtx,
  args: RefreshArgs,
): Promise<RefreshResult> {
  // §7.6 snapshot-at-entry — read ctx.db ONCE on the first line.
  const db = ctx.db;
  if (!db) {
    throw new PdfToolError(
      "NO_ACTIVE_CORPUS",
      "NO_ACTIVE_CORPUS: scholar.pdf.refresh-extraction requires an active corpus. Call scholar.corpus.activate first.",
    );
  }

  // (1) Extract text via the child pdf MCP. viewUUID === paper_id in v1.
  const text = await ctx.pdf.getText(args.paper_id);

  // (2) Lazy materialization if chunk_vec hasn't been created yet.
  if (!chunkVecReady(db)) {
    await materializeChunkVec(db, args._testProbeDim);
  }

  // (3) Split into windowed chunks.
  const chunks = chunkText(text);

  // (4) Compute embeddings OUTSIDE the transaction (§13 discipline applied to
  //     extraction). Tests inject ctx.embed; production calls Ollama over HTTP.
  const embed = ctx.embed ?? ((m: string, p: string) => ollama.embed(m, p));
  const embeddings = await Promise.all(
    chunks.map((c) => embed(DEFAULT_EMBED_MODEL, c.text)),
  );

  // (5) Single transaction: orphan-pre-pass → trim → UPSERT → chunk_vec INSERT.
  const raw = rawClient(db);
  const touchedAt = nowIso();
  let written = 0;
  let embeddingsPersisted = 0;
  const tx = raw.transaction(() => {
    // (5a) Drop any prior chunk_vec rows for this paper. vec0 has no FK CASCADE.
    raw.prepare(
      `DELETE FROM chunk_vec
       WHERE chunk_id IN (SELECT id FROM paper_chunks WHERE paper_id = ?)`,
    ).run(args.paper_id);

    // (5b) Trim paper_chunks rows whose ordinal is now beyond the new max.
    raw.prepare(
      `DELETE FROM paper_chunks WHERE paper_id = ? AND ordinal >= ?`,
    ).run(args.paper_id, chunks.length);

    // (5c) UPSERT each chunk. RETURNING id captures whichever id won
    //      (preserved-existing-id under collision, fresh ulid for inserts).
    const upsertChunk = raw.prepare(
      `INSERT INTO paper_chunks(id, paper_id, ordinal, text, embedded_at)
         VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(paper_id, ordinal) DO UPDATE
         SET text = excluded.text, embedded_at = excluded.embedded_at
       RETURNING id`,
    );
    const upsertVec = raw.prepare(
      `INSERT OR REPLACE INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)`,
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const fresh = ulid();
      const row = upsertChunk.get(
        fresh,
        args.paper_id,
        chunk.ordinal,
        chunk.text,
        touchedAt,
      ) as { id: string } | undefined;
      if (!row) {
        throw new PdfToolError(
          "PAPER_CHUNKS_UPSERT_NO_ROW",
          `paper_chunks UPSERT returned no row for ordinal ${chunk.ordinal}`,
        );
      }
      upsertVec.run(row.id, embeddings[i]!);
      written += 1;
      embeddingsPersisted += 1;
    }

    // (5e) Touch the paper so reading_queue surfaces "recently active" first.
    raw.prepare(`UPDATE papers SET status_touched_at = ? WHERE id = ?`)
       .run(touchedAt, args.paper_id);
  });
  tx();

  ctx.log.info("scholar.pdf.refresh-extraction completed", {
    paper_id: args.paper_id,
    chunks_written: written,
    embeddings_persisted: embeddingsPersisted,
  });
  return { paper_id: args.paper_id, chunks_written: written, embeddings_persisted: embeddingsPersisted };
}

// ─── registerTools ────────────────────────────────────────────────────────────

export const registerTools: RegisterTools = (_server, ctx, _register) => {
  _register(
    "scholar.pdf.refresh-extraction",
    {
      description:
        "Re-extract a paper's text via the pdf child MCP, chunk it, embed via " +
        "the local Ollama instance (default nomic-embed-text:v1.5), and persist " +
        "to paper_chunks + chunk_vec atomically.",
      inputSchema: z.object({
        paper_id: z.string().min(1).describe("Paper id (ULID) to re-extract."),
      }),
    },
    async (args) => {
      const parsed = (args ?? {}) as RefreshArgs;
      return await refreshExtraction(ctx as ExtractionCtx, { paper_id: parsed.paper_id });
    },
  );

  // Thin proxies into the pdf child MCP — payload shapes are pdf-child verbatim.
  // Registered so the MCP surface advertises them; the child handles validation.
  const proxy = (toolName: string, description: string) =>
    _register(
      toolName,
      {
        description,
        inputSchema: z.object({}).passthrough(),
      },
      async (args) => {
        return await ctx.pdf.interact([{ tool: toolName.replace(/^scholar\./, ""), args }]);
      },
    );
  proxy("scholar.pdf.open", "Open a PDF in the child pdf MCP and return its viewUUID.");
  proxy("scholar.pdf.search-text", "Search the PDF for a string and return matched anchors.");
  proxy("scholar.pdf.extract-anchors", "Extract anchor metadata from the PDF for annotation reconciliation.");
};

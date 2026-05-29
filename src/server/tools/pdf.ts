// src/server/tools/pdf.ts — extraction cycle 6.5 (Green) + §13 v1.1 amendment
//
// Implements scholar.pdf.refresh-extraction per spec §5.12 + §11, plus the
// new scholar.pdf.open tool added by the 2026-05-27 §13 amendment.
//
// scholar.pdf.open(paper_id, source) wraps vendor display_pdf and registers
// the returned viewUUID in ctx.pdfViews under the paper_id key. This is the
// population point for the §13 v1.1 push-only annotation propagation model:
// scholar.annotations.{upsert,delete} and scholar.pdf.refresh-extraction
// resolve viewUUID from ctx.pdfViews and throw NO_OPEN_VIEWER on miss.
//
// The v1.0 proxy stubs `scholar.pdf.search-text` and `scholar.pdf.extract-anchors`
// were deleted in the same amendment — they never mapped to real vendor tools.
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
import { toTightFloat32 } from "../db/sqlite-vec.ts";
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

  // (1) Extract text via the child pdf MCP. viewUUID is resolved from the
  // ctx.pdfViews map populated by scholar.pdf.open (§13 v1.1 amendment —
  // the v1.0 "viewUUID === paper_id" identity assumption was a bug because
  // the vendor issues fresh UUIDs at display_pdf time, not by paper_id).
  const viewUUID = ctx.pdfViews.get(args.paper_id);
  if (!viewUUID) {
    throw new PdfToolError(
      "NO_OPEN_VIEWER",
      `NO_OPEN_VIEWER: scholar.pdf.refresh-extraction requires scholar.pdf.open(paper_id=${args.paper_id}) to be called first so the viewUUID is registered in ctx.pdfViews.`,
    );
  }
  const text = await ctx.pdf.getText({ viewUUID });

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
      // Audit M3: defense-in-depth — see toTightFloat32 docstring.
      upsertVec.run(row.id, toTightFloat32(embeddings[i]!));
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

  // scholar.pdf.open — real proxy to vendor `display_pdf` (§13 v1.1 amendment).
  // Calls ctx.pdf.displayPdf, captures the returned viewUUID, and registers it
  // under paper_id in ctx.pdfViews so scholar.annotations.{upsert,delete} and
  // scholar.pdf.refresh-extraction can resolve viewUUID without the caller
  // re-passing it on every tool invocation.
  _register(
    "scholar.pdf.open",
    {
      description:
        "Open a paper in the child pdf MCP and register its viewUUID under " +
        "paper_id in ctx.pdfViews. Required before scholar.annotations.{upsert,delete} " +
        "or scholar.pdf.refresh-extraction on the same paper. `source` is an absolute " +
        "local path, a file:// URL, or an HTTPS URL — passed through to the vendor.",
      inputSchema: z.object({
        paper_id: z.string().min(1).describe("Scholar's paper id (ULID)."),
        source: z.string().min(1).describe("Path or URL the vendor display_pdf will open."),
      }),
    },
    async (args) => {
      const parsed = (args ?? {}) as { paper_id?: string; source?: string };
      if (typeof parsed.paper_id !== "string" || typeof parsed.source !== "string") {
        throw new PdfToolError(
          "INVALID_ARGS",
          "INVALID_ARGS: paper_id and source are required.",
        );
      }
      const { viewUUID } = await ctx.pdf.displayPdf(parsed.source);
      ctx.pdfViews.set(parsed.paper_id, viewUUID);
      return { paper_id: parsed.paper_id, viewUUID };
    },
  );
};

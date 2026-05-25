// src/server/db/raw-ddl.ts — extraction cycles 6.5 (chunk_vec) + 6.6 (reading_queue)
//
// Foundation scaffolded this file as a no-op stub at cycle 6.1 with the
// §7.6-frozen `RunRawDdl` signature. Extraction fills the body in two
// load-bearing ordered cycles (per splits.xml header):
//   6.5: CREATE VIRTUAL TABLE chunk_vec USING vec0(...)
//   6.6: CREATE VIEW reading_queue AS ...
//
// Invariants:
//   - Idempotent: every statement uses IF NOT EXISTS so corpus reopens are no-ops.
//   - chunk_vec is deferred when settings.chunk_vec.created='false' (§11 path —
//     corpus created with Ollama offline; the first successful
//     scholar.pdf.refresh-extraction probes the embed dim, flips the flag,
//     re-invokes runRawDdl, then writes the first vec0 row).
//   - The embed dimension is interpolated directly into the DDL because
//     drizzle's sql`...` cannot template a SQL-type token; the source is the
//     trusted per-corpus `settings` row written by `loadVecAndProbeDim`, NOT
//     user input. The Number() coercion in `embedDim()` guarantees a numeric
//     literal regardless of how the row arrived.
import { sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { rawClient } from "./raw-client.ts";
import type { RunRawDdl } from "../tools/registry.ts";

function readSetting(db: BunSQLiteDatabase, key: string): string | null {
  try {
    const row = db.all(sql`SELECT value FROM settings WHERE key = ${key}`) as { value: string }[];
    return row.length > 0 ? row[0]!.value : null;
  } catch {
    // `settings` table absent — typical on the very-first migrate call before
    // any extraction state has been recorded. Treat as "no settings yet".
    return null;
  }
}

function chunkVecCreated(db: BunSQLiteDatabase): boolean {
  return readSetting(db, "chunk_vec.created") === "true";
}

function embedDim(db: BunSQLiteDatabase): number | null {
  const raw = readSetting(db, "embed.dim");
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const runRawDdl: RunRawDdl = (db) => {
  // ─── cycle 6.5 — chunk_vec (sqlite-vec virtual table) ──────────────────────
  // Created only once the embed dimension is known AND the deferred-creation
  // flag has flipped to true. The vec0 module supports IF NOT EXISTS, so
  // re-invocation after the first materialization is a no-op.
  const dim = embedDim(db);
  if (dim !== null && chunkVecCreated(db)) {
    rawClient(db).exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding FLOAT[${dim}]
      )`,
    );
  }
  // ─── cycle 6.6 — reading_queue (SQL view) ──────────────────────────────────
  // Filled in cycle 6.6 (next Red/Green pair). Intentionally absent here.
};

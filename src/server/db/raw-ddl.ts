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
import { sql } from "drizzle-orm"
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"
import { rawClient } from "./raw-client.ts"
import type { RunRawDdl } from "../tools/registry.ts"

export class RawDdlInvariantError extends Error {
  override name = "RawDdlInvariantError"
}

function readSetting(db: BunSQLiteDatabase, key: string): string | null {
  try {
    const row = db.all(sql`SELECT value FROM settings WHERE key = ${key}`) as {
      value: string
    }[]
    return row.length > 0 ? row[0]!.value : null
  } catch {
    // `settings` table absent — typical on the very-first migrate call before
    // any extraction state has been recorded. Treat as "no settings yet".
    return null
  }
}

function chunkVecCreated(db: BunSQLiteDatabase): boolean {
  return readSetting(db, "chunk_vec.created") === "true"
}

function embedDim(db: BunSQLiteDatabase): number | null {
  // Audit M4: align with the canonical serialization convention — pdf.ts
  // writes embed.dim via JSON.stringify(number) and ConfigAccessor.get
  // reads via JSON.parse. The old Number(raw) coercion was too lenient,
  // accepting non-JSON forms like "0x300" that the canonical reader rejects.
  const raw = readSetting(db, "embed.dim")
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export const runRawDdl: RunRawDdl = (db) => {
  // ─── cycle 6.5 — chunk_vec (sqlite-vec virtual table) ──────────────────────
  // Created only once the embed dimension is known AND the deferred-creation
  // flag has flipped to true. The vec0 module supports IF NOT EXISTS, so
  // re-invocation after the first materialization is a no-op.
  const dim = embedDim(db)
  const created = chunkVecCreated(db)
  // Audit A1: settings can desynchronize across the chunk_vec.created flag and
  // the embed.dim row (manual edit, downgrade-then-upgrade, partial write).
  // Pre-A1 the call silently no-op'd when created='true' and dim was missing,
  // leaving the user with a permanent still_indexing=true and no diagnostic.
  // Surface the inconsistency loudly so the bug is debuggable at first open.
  if (created && dim === null) {
    throw new RawDdlInvariantError(
      "settings.chunk_vec.created='true' but embed.dim is missing or invalid — " +
        "fix settings (clear chunk_vec.created or restore a numeric JSON embed.dim) " +
        "before re-opening the corpus",
    )
  }
  if (dim !== null && created) {
    rawClient(db).run(
      `CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding FLOAT[${dim}]
      )`,
    )
  }
  // ─── cycle 6.6 — reading_queue (SQL view) ──────────────────────────────────
  // §8.2 view: surfaces only pending+reading papers; ordering puts the active
  // reads first, then highest-priority pending, then the longest-untouched
  // within each tier. Idempotent via IF NOT EXISTS; unconditional (does not
  // depend on chunk_vec / settings state — reading queue is meaningful even
  // when Ollama is offline).
  db.run(sql`CREATE VIEW IF NOT EXISTS reading_queue AS
    SELECT id, key, title, status, priority,
           (julianday('now') - julianday(COALESCE(status_touched_at, imported_at))) AS days_since_touch
    FROM papers
    WHERE status IN ('pending','reading')
    ORDER BY status='reading' DESC, priority DESC, days_since_touch DESC`)
}

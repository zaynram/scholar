// src/server/db/raw-ddl.ts — foundation cycle 6.1 (Task 1.8 scaffold)
//
// Foundation scaffold — body filled by extraction at cycle 6.5 (chunk_vec)
// and cycle 6.6 (reading_queue view). Cycle order is load-bearing.
//
// Imported by `migrations.ts` (Task 1.2). Foundation tests assert the call
// succeeds; they MUST NOT assert chunk_vec or reading_queue existence —
// that's extraction's contract.
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

export type RunRawDdl = (db: BunSQLiteDatabase) => void;

export const runRawDdl: RunRawDdl = (_db) => {
  // intentionally empty — extraction fills CREATE VIRTUAL TABLE chunk_vec
  // and CREATE VIEW reading_queue here, both with IF NOT EXISTS so this hook
  // remains idempotent across corpus opens.
};

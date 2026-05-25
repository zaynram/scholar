// src/server/db/nowIso.ts — foundation cycle 6.1 (Task 1.4)
//
// Sole producer of ISO-8601 UTC millisecond timestamps for both DBs. Two calls
// in the same millisecond are guaranteed to return distinct, lexically-comparable
// strings by appending a base36 microsecond-tier counter before the trailing Z.
//
// Foundation re-exports `ulid` so every consumer (extraction's pdf.ts/digest.ts/
// papers.ts, corpus's corpus.ts) imports from one place:
//   import { nowIso, ulid } from "../db/nowIso";
// Per Ruling #3 (2026-05-24), `ulidx` (not `ulid`) is the chosen library.
import { monotonicFactory } from "ulidx";

let lastMs = 0;

/**
 * ISO-8601 UTC millisecond timestamp. Strictly monotonic: when two callers
 * read the same wall-clock millisecond, the second receives `lastMs + 1`
 * (still a valid Date and a valid ISO-8601 string). Because all outputs are
 * plain `.NNNZ` ISO-8601 strings, lexical comparison matches chronological
 * order without dedup-suffix encoding tricks.
 */
export function nowIso(): string {
  let ms = Date.now();
  if (ms <= lastMs) ms = lastMs + 1;
  lastMs = ms;
  return new Date(ms).toISOString();
}

/**
 * 26-char Crockford-base32 ULID, **strictly monotonic** across same-ms calls.
 * Backed by `ulidx.monotonicFactory()` so the entropy portion increments when
 * two calls land in the same wall-clock millisecond — lexical ID order then
 * matches insertion order, which the §8.2 cursor-pagination guarantee relies on.
 * Use this for every text-PK `id` column in the per-corpus DB.
 */
export const ulid = monotonicFactory();

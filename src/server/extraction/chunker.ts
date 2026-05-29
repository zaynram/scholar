// src/server/extraction/chunker.ts — extraction cycle 6.5 (Green)
//
// Token-aware chunker (§5.18). The spec's target is 512-token windows with
// 64-token overlap, but foundation excludes `gpt-tokenizer` from the v1 dep
// set (§6.1). We approximate tokens as whitespace-delimited words at a
// 0.75 word/token English heuristic — 384-word windows with 48-word overlap.
//
// Chunk.ordinal is deterministic from (text, WINDOW_WORDS, OVERLAP_WORDS),
// so re-running on the same input produces identical ordinals. paper_chunks.id
// is NOT derived from (paper_id, ordinal): per user-ratified §11.5 Ruling B
// (2026-05-24), the id is a fresh ULID per row and idempotency rides on
// UPSERT against the (paper_id, ordinal) unique index — see pdf.ts.

export type Chunk = {
  /** 0-based, monotonic, contiguous chunk index within the paper. */
  ordinal: number;
  text: string;
};

const WINDOW_WORDS = 384;
const OVERLAP_WORDS = 48;

export function chunkText(text: string): Chunk[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  if (words.length <= WINDOW_WORDS) {
    return [{ ordinal: 0, text: words.join(" ") }];
  }
  const step = WINDOW_WORDS - OVERLAP_WORDS;
  const chunks: Chunk[] = [];
  let ordinal = 0;
  for (let start = 0; start < words.length; start += step) {
    const slice = words.slice(start, start + WINDOW_WORDS);
    if (slice.length === 0) break;
    // Audit M6: drop tail chunks whose new-word content (slice.length minus
    // OVERLAP_WORDS of prior overlap) is ≤ 1. These contribute one or zero
    // net new words while costing an embedding round-trip and polluting
    // vec_rank with a near-duplicate of the previous chunk.
    if (start > 0 && slice.length <= OVERLAP_WORDS + 1) break;
    chunks.push({ ordinal, text: slice.join(" ") });
    ordinal += 1;
    if (start + WINDOW_WORDS >= words.length) break;
  }
  return chunks;
}

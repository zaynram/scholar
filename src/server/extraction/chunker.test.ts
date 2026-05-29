// src/server/extraction/chunker.test.ts — extraction cycle 6.5 (Red)
//
// Token-aware chunker (§5.18). Foundation excludes gpt-tokenizer (spec §6.1),
// so we approximate token windows via whitespace-split words at 0.75 words/
// token → 384-word windows with 48-word overlap (mirrors §5.18's 512/64
// token contract).
import { test, expect } from "bun:test";
import { chunkText, type Chunk } from "./chunker.ts";

test("chunker: empty / whitespace input → no chunks", () => {
  expect(chunkText("")).toEqual([]);
  expect(chunkText("   \t\n  ")).toEqual([]);
});

test("chunker: short text fits in a single chunk with ordinal 0", () => {
  const chunks = chunkText("Hello scholar.");
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!.ordinal).toBe(0);
  expect(chunks[0]!.text).toBe("Hello scholar.");
});

test("chunker: long text yields multiple overlapping chunks with monotonic ordinals", () => {
  const words = Array.from({ length: 1000 }, (_, i) => `w${i}`).join(" ");
  const chunks = chunkText(words);
  expect(chunks.length).toBeGreaterThan(1);
  for (let i = 0; i < chunks.length; i++) expect(chunks[i]!.ordinal).toBe(i);
  // Overlap discipline: consecutive chunks share at least the configured
  // overlap (48 words) — the first word of chunk i is the (window-overlap)-th
  // word of chunk i-1, i.e. word index (window-overlap) of the previous chunk.
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1]!.text.split(/\s+/);
    const cur = chunks[i]!.text.split(/\s+/);
    // The first overlap_words of cur must equal the last overlap_words of prev.
    const overlap = 48;
    if (prev.length >= overlap && cur.length >= overlap) {
      const prevTail = prev.slice(prev.length - overlap);
      const curHead = cur.slice(0, overlap);
      expect(curHead).toEqual(prevTail);
    }
  }
});

test("chunker: each chunk's word count ≤ window-size (384 words)", () => {
  const words = Array.from({ length: 1000 }, (_, i) => `w${i}`).join(" ");
  const chunks = chunkText(words);
  for (const c of chunks) {
    expect(c.text.split(/\s+/).length).toBeLessThanOrEqual(384);
  }
});

test("chunker: Chunk shape exports ordinal + text fields", () => {
  const chunks = chunkText("alpha beta gamma");
  const sample: Chunk = chunks[0]!;
  expect(typeof sample.ordinal).toBe("number");
  expect(typeof sample.text).toBe("string");
});

test("chunker: drops a tail chunk whose new-word content is ≤ 1 word (M6)", () => {
  // Audit M6 / finding #16: WINDOW_WORDS+1 = 385 words produces a 49-word
  // tail chunk that's 48 words of overlap + 1 net new word — wastes an
  // embedding budget and pollutes vec_rank with a near-duplicate. Drop
  // such tails (slice.length ≤ OVERLAP_WORDS + 1).
  const words = Array.from({ length: 385 }, (_, i) => `w${i}`).join(" ");
  const chunks = chunkText(words);
  expect(chunks).toHaveLength(1);
  expect(chunks[0]!.text.split(/\s+/).length).toBe(384);
});

test("chunker: keeps a tail chunk with > 1 word of new content (M6 boundary)", () => {
  // Boundary on the other side: 50 tail-words = 48 overlap + 2 net new
  // words. Cheap to embed, contributes real new signal — must NOT be dropped.
  const words = Array.from({ length: 386 }, (_, i) => `w${i}`).join(" ");
  const chunks = chunkText(words);
  expect(chunks).toHaveLength(2);
  expect(chunks[1]!.text.split(/\s+/).length).toBe(50);
});

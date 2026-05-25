// src/server/db/schema.test.ts — foundation cycle 6.1 (Task 1.4)
//
// Asserts: nowIso shape + monotonicity, ulid format + monotonicity, and that
// applyMigrations creates the per-corpus + config DB tables enumerated in §8.
// Column-level invariants are exercised by downstream plans that consume them.
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWithPragmas, applyMigrations } from "./migrations.ts";
import { rawClient } from "./raw-client.ts";
import { nowIso, ulid } from "./nowIso.ts";

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test("nowIso returns ISO-8601 with millisecond precision in UTC", () => {
  const s = nowIso();
  // Strictly-monotonic-ms scheme: every output is a plain ISO-8601 ms form.
  expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  // Strict monotonicity — two adjacent calls are lexically ordered (b > a),
  // even when they fall in the same wall-clock millisecond (the second is
  // bumped to lastMs+1 so lexical = chronological).
  const a = nowIso();
  const b = nowIso();
  expect(b > a).toBe(true);
});

test("ulid re-export produces 26-char Crockford-base32 ids that are monotonic", () => {
  const a = ulid();
  const b = ulid();
  expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(b).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  // Same-ms guarantee from ulidx — second id sorts strictly greater.
  expect(b > a).toBe(true);
});

test("applyMigrations creates the per-corpus tables enumerated in §8.2", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-schema-"));
  const db = openWithPragmas(join(dir, "corpus.db"));
  applyMigrations(db);
  const tables = rawClient(db)
    .query("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  const names = tables.map((t) => t.name);
  for (const expected of [
    "papers", "paper_chunks", "annotations", "reconcile_state",
    "digests", "reading_prompts", "settings", "anchor_cache", "snapshots", "citations",
  ]) {
    expect(names).toContain(expected);
  }
});

test("applyMigrations creates the config DB tables enumerated in §8.1", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-schema-"));
  const db = openWithPragmas(join(dir, "config.db"));
  applyMigrations(db);
  const tables = rawClient(db)
    .query("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as { name: string }[];
  const names = tables.map((t) => t.name);
  for (const expected of ["corpora", "pdf_roots", "settings"]) {
    expect(names).toContain(expected);
  }
});

// src/server/db/default-pdf-root.test.ts — foundation cycle 6.1 (Task 1.4c)
//
// Per spec §8.1: defaultPdfRoot(corpusId) asserts exactly one is_default=true
// row matches. The pdf_roots_one_default_idx partial unique index makes
// "more than one" impossible; "zero" surfaces as ConfigurationIncompleteError.
import { test, expect, describe } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { defaultPdfRoot, ConfigurationIncompleteError, allPdfRoots } from "./default-pdf-root.ts";

function makeDb() {
  const raw = new Database(":memory:");
  raw.run("PRAGMA foreign_keys = ON");
  const tx = drizzle(raw);
  // Minimal schema needed for the test — production runs apply migrations.
  raw.run(`
    CREATE TABLE pdf_roots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      corpus_id TEXT NOT NULL,
      path TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0
    )`);
  raw.run("CREATE UNIQUE INDEX pdf_roots_one_default_idx ON pdf_roots(corpus_id) WHERE is_default = 1");
  return { tx, raw };
}

test("returns the single is_default=true row path", () => {
  const { tx, raw } = makeDb();
  raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 1)", ["c1", "/papers"]);
  expect(defaultPdfRoot(tx, "c1")).toBe("/papers");
});

test("ignores non-default rows for the same corpus", () => {
  const { tx, raw } = makeDb();
  raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 0)", ["c1", "/aux"]);
  raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 1)", ["c1", "/papers"]);
  expect(defaultPdfRoot(tx, "c1")).toBe("/papers");
});

test("throws ConfigurationIncompleteError when zero default rows exist", () => {
  const { tx } = makeDb();
  expect(() => defaultPdfRoot(tx, "missing")).toThrow(ConfigurationIncompleteError);
});

test("ignores rows from other corpora", () => {
  const { tx, raw } = makeDb();
  raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 1)", ["other", "/wrong"]);
  expect(() => defaultPdfRoot(tx, "c1")).toThrow(ConfigurationIncompleteError);
});

// =========================================================================
// allPdfRoots — chore foundation-fill-corpus-prereqs 2026-05-25
// =========================================================================

describe("allPdfRoots", () => {
  test("returns empty array when corpus has no pdf_roots rows", () => {
    const { tx } = makeDb();
    expect(allPdfRoots(tx, "c1")).toEqual([]);
  });

  test("returns single path when corpus has one pdf_roots row", () => {
    const { tx, raw } = makeDb();
    raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 0)", ["c1", "/papers"]);
    expect(allPdfRoots(tx, "c1")).toEqual(["/papers"]);
  });

  test("returns paths in insertion order (id ASC) for multiple rows", () => {
    const { tx, raw } = makeDb();
    // Insert in order: first /alpha, then /beta, then /gamma — expect same order back.
    raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 0)", ["c1", "/alpha"]);
    raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 0)", ["c1", "/beta"]);
    raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 1)", ["c1", "/gamma"]);
    expect(allPdfRoots(tx, "c1")).toEqual(["/alpha", "/beta", "/gamma"]);
  });

  test("excludes rows for other corpora", () => {
    const { tx, raw } = makeDb();
    raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 1)", ["other", "/wrong"]);
    raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 0)", ["c1", "/correct"]);
    expect(allPdfRoots(tx, "c1")).toEqual(["/correct"]);
  });
});

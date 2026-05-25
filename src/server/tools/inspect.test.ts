// src/server/tools/inspect.test.ts — extraction cycle 6.14 (Red)
//
// scholar.inspect: no-args dump of sqlite_master tables + indexes for the
// active corpus DB. Filters sqlite_* internals. Power-user per-table
// introspection is left to scholar.query (cuts the SQL-identifier-validation
// attack path per advisor guidance).
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { runInspect } from "./inspect.ts";

const noopLog = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

function fakeCtx(sqlite: Database) {
  const db = drizzle(sqlite);
  return {
    db, configDb: db,
    pdf: {
      interact: async () => null,
      getText: async () => "",
      currentRoots: () => [],
      setRoots: async () => {},
      isHealthy: () => ({ alive: true, lastOkAt: 0, stdioOpen: true }),
    },
    config: {
      get: <T,>(_k: string): T | undefined => undefined,
      set: (_k: string, _v: unknown) => {},
      corpora: () => [], activeCorpusId: () => undefined,
    },
    log: noopLog,
    withCorpus: async <T,>(fn: (db: ReturnType<typeof drizzle>) => Promise<T> | T) => await fn(db),
  } as unknown as Parameters<typeof runInspect>[0];
}

test("scholar.inspect: returns user tables + their CREATE sql from sqlite_master", async () => {
  const sqlite = new Database(":memory:");
  sqlite.run(`CREATE TABLE papers (id TEXT PRIMARY KEY, title TEXT NOT NULL)`);
  sqlite.run(`CREATE TABLE annotations (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, body TEXT)`);
  sqlite.run(`CREATE INDEX papers_title_idx ON papers(title)`);

  const result = await runInspect(fakeCtx(sqlite));

  const tableNames = result.tables.map((t) => t.name).sort();
  expect(tableNames).toEqual(["annotations", "papers"]);
  const papersEntry = result.tables.find((t) => t.name === "papers")!;
  expect(papersEntry.sql).toMatch(/CREATE TABLE papers/);

  const indexNames = result.indexes.map((i) => i.name);
  expect(indexNames).toContain("papers_title_idx");
});

test("scholar.inspect: filters sqlite_* internal objects", async () => {
  const sqlite = new Database(":memory:");
  // sqlite_sequence is auto-created when a table uses AUTOINCREMENT.
  sqlite.run(`CREATE TABLE auto (id INTEGER PRIMARY KEY AUTOINCREMENT, x TEXT)`);
  const result = await runInspect(fakeCtx(sqlite));
  expect(result.tables.map((t) => t.name)).not.toContain("sqlite_sequence");
});

test("scholar.inspect: NO_ACTIVE_CORPUS guard", async () => {
  const sqlite = new Database(":memory:");
  const ctx = fakeCtx(sqlite) as unknown as Record<string, unknown>;
  ctx.db = undefined;
  await expect(
    runInspect(ctx as unknown as Parameters<typeof runInspect>[0]),
  ).rejects.toThrow(/NO_ACTIVE_CORPUS/);
});

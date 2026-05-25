// src/server/tools/query.test.ts — extraction cycle 6.14 (Red)
//
// scholar.query: multi-query batch over the active corpus DB via bun:sqlite
// prepared statements. Read-only by default; opt-in commit:true per request
// promotes the batch to a write transaction. Engine-level write-intent
// enforcement via BEGIN/ROLLBACK (no keyword sniffing per advisor guidance —
// CTE write-tricks bypass naive sniffers).
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { runQuery } from "./query.ts";

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
  } as unknown as Parameters<typeof runQuery>[0];
}

function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.run(`CREATE TABLE papers (
    id TEXT PRIMARY KEY, title TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0
  )`);
  sqlite.run(`INSERT INTO papers(id, title, priority) VALUES
    ('p1','Alpha',1),
    ('p2','Beta',2)`);
  sqlite.run(`PRAGMA busy_timeout = 5000`);
  return sqlite;
}

test("scholar.query: read-only multi-query batch returns labeled rows", async () => {
  const sqlite = freshDb();
  const result = await runQuery(fakeCtx(sqlite), {
    queries: [
      { label: "all_papers", query: "SELECT id, title FROM papers ORDER BY id" },
      { label: "high_priority", query: "SELECT id FROM papers WHERE priority >= ?", params: [2] },
    ],
  });
  expect(result.all_papers).toEqual([
    { id: "p1", title: "Alpha" },
    { id: "p2", title: "Beta" },
  ]);
  expect(result.high_priority).toEqual([{ id: "p2" }]);
});

test("scholar.query: commit:true on any request promotes the batch to a write transaction", async () => {
  const sqlite = freshDb();
  await runQuery(fakeCtx(sqlite), {
    queries: [
      { label: "ins", query: "INSERT INTO papers(id, title, priority) VALUES (?, ?, ?)", params: ["p3", "Gamma", 3], commit: true },
      { label: "verify", query: "SELECT COUNT(*) AS n FROM papers" },
    ],
  });
  const row = sqlite.query("SELECT COUNT(*) AS n FROM papers").get() as { n: number };
  expect(row.n).toBe(3);
});

test("scholar.query: bare INSERT without commit:true ROLLS BACK (engine-level enforcement)", async () => {
  const sqlite = freshDb();
  await runQuery(fakeCtx(sqlite), {
    queries: [
      { label: "sneaky", query: "INSERT INTO papers(id, title, priority) VALUES ('p4', 'Delta', 4)" },
    ],
  });
  const row = sqlite.query("SELECT COUNT(*) AS n FROM papers").get() as { n: number };
  expect(row.n).toBe(2);
});

test("scholar.query: CTE-write (WITH x AS (DELETE … RETURNING) SELECT) without commit:true ALSO rolls back", async () => {
  // Lead-mandated invariant test: pins the no-sniff posture by exercising
  // a CTE-DELETE whose outer statement reads as SELECT. Naive write-keyword
  // sniffers would let this escape rollback; the BEGIN/ROLLBACK gate does not.
  const sqlite = freshDb();
  await runQuery(fakeCtx(sqlite), {
    queries: [
      { label: "cte-sneak", query: "WITH x AS (DELETE FROM papers WHERE id = 'p1' RETURNING id) SELECT id FROM x" },
    ],
  });
  const row = sqlite.query("SELECT COUNT(*) AS n FROM papers").get() as { n: number };
  expect(row.n).toBe(2);
});

test("scholar.query: invalid SQL throws and leaves no leftover transaction lock", async () => {
  const sqlite = freshDb();
  await expect(runQuery(fakeCtx(sqlite), {
    queries: [
      { label: "good", query: "SELECT 1 AS n", params: [] },
      { label: "bad", query: "SELECT FROM WHERE", params: [] },
    ],
  })).rejects.toThrow(/SQL|near|syntax/i);
  // A fresh subsequent batch must succeed (no stuck BEGIN).
  const result = await runQuery(fakeCtx(sqlite), {
    queries: [{ label: "n", query: "SELECT COUNT(*) AS n FROM papers" }],
  });
  expect((result.n[0] as { n: number }).n).toBe(2);
});

test("scholar.query: NO_ACTIVE_CORPUS guard", async () => {
  const sqlite = freshDb();
  const ctx = fakeCtx(sqlite) as unknown as Record<string, unknown>;
  ctx.db = undefined;
  await expect(
    runQuery(ctx as unknown as Parameters<typeof runQuery>[0], {
      queries: [{ label: "x", query: "SELECT 1" }],
    }),
  ).rejects.toThrow(/NO_ACTIVE_CORPUS/);
});

test("scholar.query: posture-B guard — never reads ctx.sqlite3 (sqlite3-mcp dropped)", async () => {
  const sqlite = freshDb();
  const ctx = fakeCtx(sqlite);
  const strict = new Proxy(ctx as object, {
    get(target, prop) {
      if (typeof prop === "string" && prop === "sqlite3") {
        throw new Error("sqlite3-mcp access detected on ctx — posture B violated");
      }
      return Reflect.get(target, prop);
    },
  });
  await runQuery(strict as unknown as Parameters<typeof runQuery>[0], {
    queries: [{ label: "n", query: "SELECT COUNT(*) AS n FROM papers" }],
  });
  // Reaching here means no sqlite3-property access happened.
  expect(true).toBe(true);
});

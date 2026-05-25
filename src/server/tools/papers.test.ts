// src/server/tools/papers.test.ts — extraction cycle 6.6 (Red)
//
// Hybrid lexical+semantic search via Reciprocal Rank Fusion (k=60) per §6.6
// "hybrid lexical + sqlite-vec" envelope. Degrades to lexical-only with
// `still_indexing: true` when settings.chunk_vec.created='false' (§11 pill).
// scholar.papers.update bumps status_touched_at so reading_queue reorders.
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { resolve } from "node:path";
import { searchPapers, updatePaper } from "./papers.ts";
import { runRawDdl } from "../db/raw-ddl.ts";

function ensureVec0Path(): string {
  if (!process.env.SCHOLAR_VEC0_PATH) {
    process.env.SCHOLAR_VEC0_PATH = resolve(
      process.cwd(),
      "node_modules/sqlite-vec-linux-x64/vec0.so",
    );
  }
  return process.env.SCHOLAR_VEC0_PATH;
}

function deterministicEmbedding(dim: number, input: string): Float32Array {
  const out = new Float32Array(dim);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h = (h ^ input.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  for (let i = 0; i < dim; i++) {
    const v = Math.imul(h ^ (i + 1), 2654435761) >>> 0;
    out[i] = ((v % 2000) - 1000) / 1000;
  }
  return out;
}

function seededDb(opts?: { deferred?: boolean }) {
  const sqlite = new Database(":memory:");
  sqlite.loadExtension(ensureVec0Path());
  sqlite.run(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  if (opts?.deferred) {
    sqlite.run(`INSERT INTO settings(key,value) VALUES ('chunk_vec.created','false')`);
  } else {
    sqlite.run(`INSERT INTO settings(key,value) VALUES
      ('embed.dim','768'),
      ('chunk_vec.created','true')`);
  }
  sqlite.run(`CREATE TABLE papers (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    authors TEXT, status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL, status_touched_at TEXT,
    role TEXT, depth TEXT, section TEXT
  )`);
  sqlite.run(`CREATE TABLE paper_chunks (
    id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
    text TEXT NOT NULL, embedded_at TEXT
  )`);
  sqlite.run(`CREATE UNIQUE INDEX paper_chunks_paper_ord_idx
              ON paper_chunks(paper_id, ordinal)`);
  runRawDdl(drizzle(sqlite));
  return sqlite;
}

const noopLog = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

function fakeCtx(sqlite: Database) {
  const db = drizzle(sqlite);
  return {
    db,
    configDb: db,
    pdf: {
      interact: async () => null,
      getText: async () => "",
      currentRoots: () => [],
      setRoots: async () => {},
      isHealthy: () => ({ alive: true, lastOkAt: 0, stdioOpen: true }),
    },
    config: {
      get: <T,>(_key: string): T | undefined => undefined,
      set: (_k: string, _v: unknown) => {},
      corpora: () => [],
      activeCorpusId: () => undefined,
    },
    log: noopLog,
    withCorpus: async <T,>(fn: (db: ReturnType<typeof drizzle>) => Promise<T> | T) => await fn(db),
    embed: async (_m: string, p: string) => deterministicEmbedding(768, p),
  } as unknown as Parameters<typeof searchPapers>[0];
}

test("hybrid search: returns lexical + semantic hits ranked via RRF (k=60)", async () => {
  const sqlite = seededDb();
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at) VALUES
    ('p1','smith2024','Scaling laws for language models','2026-01-01T00:00:00.000Z'),
    ('p2','jones2024','Architecture search techniques','2026-01-01T00:00:00.000Z'),
    ('p3','doe2024','Optimization of training','2026-01-01T00:00:00.000Z')`);
  sqlite.run(`INSERT INTO paper_chunks(id,paper_id,ordinal,text,embedded_at) VALUES
    ('c1','p1',0,'Scaling laws describe model capacity','2026-01-01T00:00:00.000Z'),
    ('c2','p2',0,'NAS finds good architectures','2026-01-01T00:00:00.000Z'),
    ('c3','p3',0,'Training optimization techniques','2026-01-01T00:00:00.000Z')`);
  for (const [id, txt] of [
    ["c1", "Scaling laws describe model capacity"],
    ["c2", "NAS finds good architectures"],
    ["c3", "Training optimization techniques"],
  ] as const) {
    sqlite.prepare(`INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)`)
      .run(id, deterministicEmbedding(768, txt));
  }

  const result = await searchPapers(fakeCtx(sqlite), { q: "scaling laws" });
  expect(result.still_indexing).toBe(false);
  // p1 wins by combined lexical (title match) + semantic (chunk text match).
  expect(result.hits[0]!.id).toBe("p1");
  expect(result.hits.map((h) => h.id)).toContain("p1");
});

test("hybrid search: degrades to lexical-only when chunk_vec is deferred (still_indexing=true)", async () => {
  const sqlite = seededDb({ deferred: true });
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at) VALUES
    ('p1','foo','Foo bar baz','2026-01-01T00:00:00.000Z')`);

  const result = await searchPapers(fakeCtx(sqlite), { q: "foo" });
  expect(result.still_indexing).toBe(true);
  expect(result.hits[0]!.id).toBe("p1");
});

test("hybrid search: respects limit parameter (default 20)", async () => {
  const sqlite = seededDb();
  // Insert 30 papers with the same hit-word.
  const stmt = sqlite.prepare(
    `INSERT INTO papers(id,key,title,imported_at) VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z')`,
  );
  for (let i = 0; i < 30; i++) stmt.run(`p${i}`, `k${i}`, `keyword ${i}`);
  const r1 = await searchPapers(fakeCtx(sqlite), { q: "keyword" });
  expect(r1.hits.length).toBeLessThanOrEqual(20);
  const r2 = await searchPapers(fakeCtx(sqlite), { q: "keyword", limit: 5 });
  expect(r2.hits.length).toBeLessThanOrEqual(5);
});

test("scholar.papers.update: status flip bumps status_touched_at; reading_queue reorders", async () => {
  const sqlite = seededDb();
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at) VALUES
    ('p1','foo','Foo','2026-01-01T00:00:00.000Z'),
    ('p2','bar','Bar','2026-01-01T00:00:00.000Z')`);

  await updatePaper(fakeCtx(sqlite), { paper_id: "p1", status: "reading" });
  const queue = sqlite.query("SELECT id, status FROM reading_queue").all() as { id: string; status: string }[];
  // 'reading' beats 'pending' regardless of other terms.
  expect(queue[0]!.id).toBe("p1");
  expect(queue[0]!.status).toBe("reading");

  const touched = (sqlite.query(
    "SELECT status_touched_at FROM papers WHERE id='p1'",
  ).get() as { status_touched_at: string }).status_touched_at;
  expect(touched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("scholar.papers.update: priority / depth / role / section partial updates", async () => {
  const sqlite = seededDb();
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at) VALUES
    ('p1','foo','Foo','2026-01-01T00:00:00.000Z')`);
  await updatePaper(fakeCtx(sqlite), {
    paper_id: "p1",
    priority: 7,
    depth: "deep",
    role: "primary",
    section: "Methods",
  });
  const row = sqlite.query(
    "SELECT priority, depth, role, section FROM papers WHERE id='p1'",
  ).get() as { priority: number; depth: string; role: string; section: string };
  expect(row.priority).toBe(7);
  expect(row.depth).toBe("deep");
  expect(row.role).toBe("primary");
  expect(row.section).toBe("Methods");
});

test("scholar.papers.search / update: NO_ACTIVE_CORPUS guards", async () => {
  const sqlite = seededDb();
  const ctx = fakeCtx(sqlite) as unknown as Record<string, unknown>;
  ctx.db = undefined;
  await expect(
    searchPapers(ctx as unknown as Parameters<typeof searchPapers>[0], { q: "x" }),
  ).rejects.toThrow(/NO_ACTIVE_CORPUS/);
  await expect(
    updatePaper(ctx as unknown as Parameters<typeof updatePaper>[0], { paper_id: "p1", status: "reading" }),
  ).rejects.toThrow(/NO_ACTIVE_CORPUS/);
});

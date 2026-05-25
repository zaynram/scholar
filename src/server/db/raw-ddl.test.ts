// src/server/db/raw-ddl.test.ts — extraction cycle 6.5/6.6
//
// Foundation scaffolded runRawDdl as a no-op stub at cycle 6.1; extraction
// fills the body across two cycles (6.5 → chunk_vec, 6.6 → reading_queue view).
// This test file accretes assertions in matching order.
import { test, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openWithPragmas } from "./migrations.ts";
import { runRawDdl } from "./raw-ddl.ts";

// Ensure vec0 path is discoverable by `Database.loadExtension`. The build
// pipeline (foundation's `bun run build:vec`) is expected to land a copy at
// build/vendor/sqlite-vec/vec0.so; in dev we fall back to the npm package's
// platform binary so tests run before that script is wired.
function ensureVec0Path(): string {
  if (!process.env.SCHOLAR_VEC0_PATH) {
    process.env.SCHOLAR_VEC0_PATH = resolve(
      process.cwd(),
      "node_modules/sqlite-vec-linux-x64/vec0.so",
    );
  }
  return process.env.SCHOLAR_VEC0_PATH;
}

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

// ─── foundation-layer baseline (kept from cycle 6.1) ──────────────────────────

test("runRawDdl is callable on a fresh corpus DB without settings (no throw)", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-rawddl-"));
  const db = openWithPragmas(join(dir, "t.db"));
  expect(() => runRawDdl(db)).not.toThrow();
});

// ─── vec0 ABI canary (Task 6.5.1) ─────────────────────────────────────────────

test("vec0 ABI smoke: loadExtension + CREATE VIRTUAL TABLE + insert + read", () => {
  const sqlite = new Database(":memory:");
  sqlite.loadExtension(ensureVec0Path());
  sqlite.run(`CREATE VIRTUAL TABLE chunk_vec USING vec0(
    chunk_id TEXT PRIMARY KEY,
    embedding FLOAT[8]
  )`);
  const emb = new Float32Array(8).fill(0.1);
  sqlite.prepare("INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)").run("c1", emb);
  const rows = sqlite.query("SELECT chunk_id FROM chunk_vec").all();
  expect(rows).toEqual([{ chunk_id: "c1" }]);
});

// ─── cycle 6.5 — chunk_vec materialization via runRawDdl ──────────────────────

function freshExtDb() {
  const sqlite = new Database(":memory:");
  sqlite.loadExtension(ensureVec0Path());
  const db = drizzle(sqlite);
  db.run(sql`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  return { sqlite, db };
}

test("runRawDdl: creates chunk_vec when settings.embed.dim is set and chunk_vec.created='true'", () => {
  const { sqlite, db } = freshExtDb();
  db.run(sql`INSERT INTO settings(key,value) VALUES
    ('embed.model', '"nomic-embed-text:v1.5"'),
    ('embed.dim',   '768'),
    ('chunk_vec.created', 'true')`);
  runRawDdl(db);
  const tables = sqlite.query(
    "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
  ).all() as { name: string }[];
  expect(tables.map((t) => t.name)).toContain("chunk_vec");
});

test("runRawDdl: skips chunk_vec when settings.chunk_vec.created='false' (deferred)", () => {
  const { sqlite, db } = freshExtDb();
  db.run(sql`INSERT INTO settings(key,value) VALUES
    ('embed.dim','768'),
    ('chunk_vec.created','false')`);
  runRawDdl(db);
  const has = sqlite.query("SELECT 1 FROM sqlite_master WHERE name = 'chunk_vec'").get();
  expect(has).toBeNull();
});

test("runRawDdl: idempotent — second call with chunk_vec.created='true' no-ops", () => {
  const { db } = freshExtDb();
  db.run(sql`INSERT INTO settings(key,value) VALUES
    ('embed.dim','768'),
    ('chunk_vec.created','true')`);
  runRawDdl(db);
  expect(() => runRawDdl(db)).not.toThrow();
});

// ─── cycle 6.6 — reading_queue view ───────────────────────────────────────────

function freshReadingQueueDb() {
  const { sqlite, db } = freshExtDb();
  db.run(sql`INSERT INTO settings(key,value) VALUES
    ('embed.dim','768'),
    ('chunk_vec.created','true')`);
  db.run(sql`CREATE TABLE papers (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', priority INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL, status_touched_at TEXT
  )`);
  return { sqlite, db };
}

test("runRawDdl: creates reading_queue view that surfaces only pending+reading papers", () => {
  const { sqlite, db } = freshReadingQueueDb();
  db.run(sql`INSERT INTO papers(id,key,title,status,priority,imported_at) VALUES
    ('p1','foo','Foo','pending',5,'2026-01-01T00:00:00.000Z'),
    ('p2','bar','Bar','reading',1,'2026-05-01T00:00:00.000Z'),
    ('p3','baz','Baz','reviewed',9,'2026-05-01T00:00:00.000Z')`);
  runRawDdl(db);
  const rows = sqlite.query("SELECT id, status FROM reading_queue").all() as { id: string; status: string }[];
  const ids = rows.map((r) => r.id);
  expect(ids).toContain("p1");
  expect(ids).toContain("p2");
  expect(ids).not.toContain("p3");
  // §8.2 ordering: status='reading' DESC, priority DESC, days_since_touch DESC.
  // 'reading' beats 'pending' regardless of priority, so p2 is first.
  expect(rows[0]!.id).toBe("p2");
});

test("runRawDdl: reading_queue is idempotent — second call no-ops", () => {
  const { db } = freshReadingQueueDb();
  runRawDdl(db);
  expect(() => runRawDdl(db)).not.toThrow();
});

test("runRawDdl: chunk_vec from cycle 6.5 still created when reading_queue lands — no regression", () => {
  const { sqlite, db } = freshReadingQueueDb();
  runRawDdl(db);
  const names = (sqlite.query(
    "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
  ).all() as { name: string }[]).map((r) => r.name);
  expect(names).toContain("chunk_vec");
  expect(names).toContain("reading_queue");
});

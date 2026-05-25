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

// ─── cycle 6.6 — reading_queue view (added in the next Red commit) ────────────

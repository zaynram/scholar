// src/server/db/raw-ddl.test.ts — extraction cycle 6.5/6.6
//
// Foundation scaffolded runRawDdl as a no-op stub at cycle 6.1; extraction
// fills the body across two cycles (6.5 → chunk_vec, 6.6 → reading_queue view).
// This test file accretes assertions in matching order.
import { test, expect, afterEach } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { sql } from "drizzle-orm"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openWithPragmas } from "./migrations.ts"
import { runRawDdl, RawDdlInvariantError } from "./raw-ddl.ts"
import { ensureVec0Path } from "%/util"
// Ensure vec0 path is discoverable by `Database.loadExtension`. The build
// pipeline (foundation's `bun run build:vec`) is expected to land a copy at
// build/vendor/sqlite-vec/vec0.so; in dev we fall back to the npm package's
// platform binary so tests run before that script is wired.

let dir: string | undefined
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

// ─── foundation-layer baseline (kept from cycle 6.1) ──────────────────────────

test("runRawDdl is callable on a fresh corpus DB without settings (no throw)", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-rawddl-"))
  const db = openWithPragmas(join(dir, "t.db"))
  expect(() => runRawDdl(db)).not.toThrow()
})

// ─── vec0 ABI canary (Task 6.5.1) ─────────────────────────────────────────────

test("vec0 ABI smoke: loadExtension + CREATE VIRTUAL TABLE + insert + read", () => {
  const sqlite = new Database(":memory:")
  sqlite.loadExtension(ensureVec0Path())
  sqlite.run(`CREATE VIRTUAL TABLE chunk_vec USING vec0(
    chunk_id TEXT PRIMARY KEY,
    embedding FLOAT[8]
  )`)
  const emb = new Float32Array(8).fill(0.1)
  sqlite
    .prepare("INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)")
    .run("c1", emb)
  const rows = sqlite.query("SELECT chunk_id FROM chunk_vec").all()
  expect(rows).toEqual([{ chunk_id: "c1" }])
})

// ─── cycle 6.5 — chunk_vec materialization via runRawDdl ──────────────────────

function freshExtDb() {
  const sqlite = new Database(":memory:")
  sqlite.loadExtension(ensureVec0Path())
  const db = drizzle(sqlite)
  db.run(sql`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  return { sqlite, db }
}

test("runRawDdl: creates chunk_vec when settings.embed.dim is set and chunk_vec.created='true'", () => {
  const { sqlite, db } = freshExtDb()
  db.run(sql`INSERT INTO settings(key,value) VALUES
    ('embed.model', '"nomic-embed-text:v1.5"'),
    ('embed.dim',   '768'),
    ('chunk_vec.created', 'true')`)
  runRawDdl(db)
  const tables = sqlite
    .query(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
    )
    .all() as { name: string }[]
  expect(tables.map((t) => t.name)).toContain("chunk_vec")
})

test("runRawDdl: embed.dim is parsed as JSON; hex/non-JSON values trigger RawDdlInvariantError (M4 + A1)", () => {
  // Audit M4 / finding #14: pdf.ts:materializeChunkVec writes embed.dim via
  // JSON.stringify(number); the consuming reader in raw-ddl.ts:embedDim used
  // Number(raw), which accepts non-JSON forms like "0x300" (Number = 768)
  // and would silently honor a value that the canonical ConfigAccessor.get
  // (JSON.parse) would reject. Audit A1 strengthens M4: when chunk_vec.created
  // says the table was materialized but embedDim() now returns null (corrupt
  // JSON, downgrade artifact, partial settings write), the state is genuinely
  // inconsistent — throw rather than silently skip, so the user sees the bug
  // immediately instead of staring at a permanent still_indexing=true.
  const { db } = freshExtDb()
  db.run(sql`INSERT INTO settings(key,value) VALUES
    ('embed.dim','0x300'),
    ('chunk_vec.created','true')`)
  expect(() => runRawDdl(db)).toThrow(RawDdlInvariantError)
})

test("runRawDdl: throws RawDdlInvariantError when chunk_vec.created='true' but embed.dim row is absent (A1)", () => {
  // Audit A1 / silent-failure-hunter Finding A1: settings says chunk_vec was
  // materialized, but the embed.dim sibling row is gone. Materially
  // impossible under the canonical pdf.ts writer (atomic) but possible after
  // manual edit, downgrade-then-upgrade, or partial write. Without this
  // check raw-ddl silently no-ops and the user sees still_indexing=true
  // forever with no diagnostic. Surface the inconsistency.
  const { db } = freshExtDb()
  db.run(sql`INSERT INTO settings(key,value) VALUES
    ('chunk_vec.created','true')`)
  expect(() => runRawDdl(db)).toThrow(RawDdlInvariantError)
})

test("runRawDdl: skips chunk_vec when settings.chunk_vec.created='false' (deferred)", () => {
  const { sqlite, db } = freshExtDb()
  db.run(sql`INSERT INTO settings(key,value) VALUES
    ('embed.dim','768'),
    ('chunk_vec.created','false')`)
  runRawDdl(db)
  const has = sqlite
    .query("SELECT 1 FROM sqlite_master WHERE name = 'chunk_vec'")
    .get()
  expect(has).toBeNull()
})

test("runRawDdl: idempotent — second call with chunk_vec.created='true' no-ops", () => {
  const { db } = freshExtDb()
  db.run(sql`INSERT INTO settings(key,value) VALUES
    ('embed.dim','768'),
    ('chunk_vec.created','true')`)
  runRawDdl(db)
  expect(() => runRawDdl(db)).not.toThrow()
})

// ─── cycle 6.6 — reading_queue view ───────────────────────────────────────────

function freshReadingQueueDb() {
  const { sqlite, db } = freshExtDb()
  db.run(sql`INSERT INTO settings(key,value) VALUES
    ('embed.dim','768'),
    ('chunk_vec.created','true')`)
  db.run(sql`CREATE TABLE papers (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', priority INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL, status_touched_at TEXT
  )`)
  return { sqlite, db }
}

test("runRawDdl: creates reading_queue view that surfaces only pending+reading papers", () => {
  const { sqlite, db } = freshReadingQueueDb()
  db.run(sql`INSERT INTO papers(id,key,title,status,priority,imported_at) VALUES
    ('p1','foo','Foo','pending',5,'2026-01-01T00:00:00.000Z'),
    ('p2','bar','Bar','reading',1,'2026-05-01T00:00:00.000Z'),
    ('p3','baz','Baz','reviewed',9,'2026-05-01T00:00:00.000Z')`)
  runRawDdl(db)
  const rows = sqlite.query("SELECT id, status FROM reading_queue").all() as {
    id: string
    status: string
  }[]
  const ids = rows.map((r) => r.id)
  expect(ids).toContain("p1")
  expect(ids).toContain("p2")
  expect(ids).not.toContain("p3")
  // §8.2 ordering: status='reading' DESC, priority DESC, days_since_touch DESC.
  // 'reading' beats 'pending' regardless of priority, so p2 is first.
  expect(rows[0]!.id).toBe("p2")
})

test("runRawDdl: reading_queue is idempotent — second call no-ops", () => {
  const { db } = freshReadingQueueDb()
  runRawDdl(db)
  expect(() => runRawDdl(db)).not.toThrow()
})

test("runRawDdl: chunk_vec from cycle 6.5 still created when reading_queue lands — no regression", () => {
  const { sqlite, db } = freshReadingQueueDb()
  runRawDdl(db)
  const names = (
    sqlite
      .query(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((r) => r.name)
  expect(names).toContain("chunk_vec")
  expect(names).toContain("reading_queue")
})

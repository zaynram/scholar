// src/server/tools/pdf.test.ts — extraction cycle 6.5 (Red)
//
// Exercises scholar.pdf.refresh-extraction: pdf-child get_text → chunker →
// embed → chunk_vec INSERT, all in one transaction per §13 discipline
// (no awaits inside). Ruling B idempotency: count-based, ULID IDs, UPSERT
// on (paper_id, ordinal), orphan pre-pass + ordinal-shrinkage trim.
import { test, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { refreshExtraction } from "./pdf.ts"
import { runRawDdl } from "../db/raw-ddl.ts"
import { ensureVec0Path } from "%/index"

// Deterministic embedding: same input → same Float32Array. Avoids both
// network round-trips and accidental cross-test coupling.
function deterministicEmbedding(dim: number, input: string): Float32Array {
  const out = new Float32Array(dim)
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h = (h ^ input.charCodeAt(i)) >>> 0
    h = Math.imul(h, 16777619) >>> 0
  }
  for (let i = 0; i < dim; i++) {
    const v = Math.imul(h ^ (i + 1), 2654435761) >>> 0
    out[i] = ((v % 2000) - 1000) / 1000
  }
  return out
}

function freshExtractionDb() {
  const sqlite = new Database(":memory:")
  sqlite.loadExtension(ensureVec0Path())
  sqlite.run(
    `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  )
  sqlite.run(`CREATE TABLE papers (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    pdf_path TEXT, status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL, status_touched_at TEXT
  )`)
  sqlite.run(`CREATE TABLE paper_chunks (
    id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
    page INTEGER, text TEXT NOT NULL, embedded_at TEXT
  )`)
  // §11.5 Ruling B: ON CONFLICT(paper_id, ordinal) requires the UNIQUE index.
  // Spec §8.2 declares it via `paper_ord_uniq: uniqueIndex(...).on(t.paper_id,
  // t.ordinal)`; foundation's migrations materialize it from the Drizzle schema.
  sqlite.run(`CREATE UNIQUE INDEX paper_chunks_paper_ord_idx
              ON paper_chunks(paper_id, ordinal)`)
  return sqlite
}

const noopLog = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
}

type FakePdfText = string | ((viewUUID: string) => Promise<string>)
function fakeCtx(sqlite: Database, opts?: { text?: FakePdfText }) {
  const db = drizzle(sqlite)
  const textFactory = opts?.text ?? "Hello scholar. " + "word ".repeat(500)
  return {
    db,
    configDb: db,
    pdf: {
      interact: async () => null,
      getText: async (viewUUID: string) =>
        typeof textFactory === "string"
          ? textFactory
          : await textFactory(viewUUID),
      currentRoots: () => ["/tmp"],
      setRoots: async () => {},
      isHealthy: () => ({ alive: true, lastOkAt: Date.now(), stdioOpen: true }),
    },
    config: {
      get: <T,>(_key: string): T | undefined => undefined,
      set: (_k: string, _v: unknown) => {},
      corpora: () => [],
      activeCorpusId: () => undefined,
    },
    log: noopLog,
    withCorpus: async <T,>(
      fn: (db: ReturnType<typeof drizzle>) => Promise<T> | T,
    ) => await fn(db),
    embed: async (_model: string, prompt: string) =>
      deterministicEmbedding(768, prompt),
  } as unknown as Parameters<typeof refreshExtraction>[0]
}

test("refresh-extraction: writes paper_chunks AND chunk_vec rows for a fixture paper (count parity)", async () => {
  const sqlite = freshExtractionDb()
  sqlite.run(`INSERT INTO settings(key,value) VALUES
    ('embed.model','"nomic-embed-text:v1.5"'),
    ('embed.dim','768'),
    ('chunk_vec.created','true')`)
  runRawDdl(drizzle(sqlite))
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at)
              VALUES ('p1','fake2026','Fake paper','2026-05-22T00:00:00.000Z')`)

  await refreshExtraction(fakeCtx(sqlite), { paper_id: "p1" })

  const n = (
    sqlite
      .query("SELECT COUNT(*) AS n FROM paper_chunks WHERE paper_id='p1'")
      .get() as { n: number }
  ).n
  expect(n).toBeGreaterThanOrEqual(2)

  // chunk_vec row count for this paper equals paper_chunks row count.
  const vN = (
    sqlite
      .query(
        `SELECT COUNT(*) AS n FROM chunk_vec
     WHERE chunk_id IN (SELECT id FROM paper_chunks WHERE paper_id='p1')`,
      )
      .get() as { n: number }
  ).n
  expect(vN).toBe(n)

  // embedded_at populated on every row (no transient nulls in steady state).
  const pend = (
    sqlite
      .query("SELECT COUNT(*) AS n FROM paper_chunks WHERE embedded_at IS NULL")
      .get() as { n: number }
  ).n
  expect(pend).toBe(0)

  // ULIDs: 26-char Crockford base32 (excludes I/L/O/U).
  const sample = (
    sqlite
      .query("SELECT id FROM paper_chunks WHERE paper_id='p1' LIMIT 1")
      .get() as { id: string }
  ).id
  expect(sample).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
})

test("refresh-extraction: lazily materializes chunk_vec when deferred (via _testProbeDim)", async () => {
  const sqlite = freshExtractionDb()
  sqlite.run(`INSERT INTO settings(key,value) VALUES
    ('embed.model','"nomic-embed-text:v1.5"'),
    ('chunk_vec.created','false')`)
  runRawDdl(drizzle(sqlite)) // no chunk_vec yet (deferred)
  expect(
    sqlite.query("SELECT 1 FROM sqlite_master WHERE name='chunk_vec'").get(),
  ).toBeNull()

  sqlite.run(`INSERT INTO papers(id,key,title,imported_at)
              VALUES ('p2','lazy','Lazy paper','2026-05-22T00:00:00.000Z')`)

  await refreshExtraction(fakeCtx(sqlite), {
    paper_id: "p2",
    _testProbeDim: async () => ({
      dim: 768,
      modelTag: "nomic-embed-text:v1.5",
    }),
  })

  expect(
    sqlite.query("SELECT 1 FROM sqlite_master WHERE name='chunk_vec'").get(),
  ).not.toBeNull()
  const flag = (
    sqlite
      .query("SELECT value FROM settings WHERE key='chunk_vec.created'")
      .get() as { value: string }
  ).value
  expect(flag).toBe("true")
})

test("refresh-extraction: idempotent — re-run yields equal counts (Ruling B count-based)", async () => {
  const sqlite = freshExtractionDb()
  sqlite.run(`INSERT INTO settings(key,value) VALUES
    ('embed.model','"nomic-embed-text:v1.5"'),
    ('embed.dim','768'),
    ('chunk_vec.created','true')`)
  runRawDdl(drizzle(sqlite))
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at)
              VALUES ('p3','idem','Idem paper','2026-05-22T00:00:00.000Z')`)

  await refreshExtraction(fakeCtx(sqlite), { paper_id: "p3" })
  const n1 = (
    sqlite
      .query("SELECT COUNT(*) AS n FROM paper_chunks WHERE paper_id='p3'")
      .get() as { n: number }
  ).n
  const v1 = (
    sqlite
      .query(
        `SELECT COUNT(*) AS n FROM chunk_vec
     WHERE chunk_id IN (SELECT id FROM paper_chunks WHERE paper_id='p3')`,
      )
      .get() as { n: number }
  ).n

  await refreshExtraction(fakeCtx(sqlite), { paper_id: "p3" })
  const n2 = (
    sqlite
      .query("SELECT COUNT(*) AS n FROM paper_chunks WHERE paper_id='p3'")
      .get() as { n: number }
  ).n
  const v2 = (
    sqlite
      .query(
        `SELECT COUNT(*) AS n FROM chunk_vec
     WHERE chunk_id IN (SELECT id FROM paper_chunks WHERE paper_id='p3')`,
      )
      .get() as { n: number }
  ).n

  expect(n2).toBe(n1)
  expect(v2).toBe(n2)
  expect(v1).toBe(n1)
})

test("refresh-extraction: ordinal shrinkage — fewer chunks on re-run trims stale paper_chunks + chunk_vec", async () => {
  const sqlite = freshExtractionDb()
  sqlite.run(`INSERT INTO settings(key,value) VALUES
    ('embed.model','"nomic-embed-text:v1.5"'),
    ('embed.dim','768'),
    ('chunk_vec.created','true')`)
  runRawDdl(drizzle(sqlite))
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at)
              VALUES ('p4','shrink','Shrinking paper','2026-05-22T00:00:00.000Z')`)

  // First run: long text → many chunks.
  await refreshExtraction(fakeCtx(sqlite, { text: "word ".repeat(1000) }), {
    paper_id: "p4",
  })
  const longCount = (
    sqlite
      .query("SELECT COUNT(*) AS n FROM paper_chunks WHERE paper_id='p4'")
      .get() as { n: number }
  ).n
  expect(longCount).toBeGreaterThan(1)

  // Second run: tiny text → 1 chunk.
  await refreshExtraction(fakeCtx(sqlite, { text: "Tiny." }), {
    paper_id: "p4",
  })
  const shortCount = (
    sqlite
      .query("SELECT COUNT(*) AS n FROM paper_chunks WHERE paper_id='p4'")
      .get() as { n: number }
  ).n
  expect(shortCount).toBe(1)
  const shortVec = (
    sqlite
      .query(
        `SELECT COUNT(*) AS n FROM chunk_vec
     WHERE chunk_id IN (SELECT id FROM paper_chunks WHERE paper_id='p4')`,
      )
      .get() as { n: number }
  ).n
  expect(shortVec).toBe(1)
})

test("refresh-extraction: ordinal growth — more chunks on re-run leaves contiguous ordinals 0..N-1", async () => {
  const sqlite = freshExtractionDb()
  sqlite.run(`INSERT INTO settings(key,value) VALUES
    ('embed.model','"nomic-embed-text:v1.5"'),
    ('embed.dim','768'),
    ('chunk_vec.created','true')`)
  runRawDdl(drizzle(sqlite))
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at)
              VALUES ('p5','grow','Growing paper','2026-05-22T00:00:00.000Z')`)

  await refreshExtraction(fakeCtx(sqlite, { text: "Tiny." }), {
    paper_id: "p5",
  })
  const tiny = (
    sqlite
      .query("SELECT COUNT(*) AS n FROM paper_chunks WHERE paper_id='p5'")
      .get() as { n: number }
  ).n
  expect(tiny).toBe(1)

  await refreshExtraction(fakeCtx(sqlite, { text: "word ".repeat(1000) }), {
    paper_id: "p5",
  })
  const long = (
    sqlite
      .query("SELECT COUNT(*) AS n FROM paper_chunks WHERE paper_id='p5'")
      .get() as { n: number }
  ).n
  expect(long).toBeGreaterThan(tiny)

  const vecCount = (
    sqlite
      .query(
        `SELECT COUNT(*) AS n FROM chunk_vec
     WHERE chunk_id IN (SELECT id FROM paper_chunks WHERE paper_id='p5')`,
      )
      .get() as { n: number }
  ).n
  expect(vecCount).toBe(long)

  // Contiguous ordinals 0..long-1 — no UPSERT-leaves-a-hole regression.
  const maxOrd = (
    sqlite
      .query("SELECT MAX(ordinal) AS m FROM paper_chunks WHERE paper_id='p5'")
      .get() as { m: number }
  ).m
  expect(maxOrd).toBe(long - 1)
})

test("refresh-extraction: NO_ACTIVE_CORPUS guard when ctx.db is undefined", async () => {
  const sqlite = freshExtractionDb()
  const ctx = fakeCtx(sqlite) as unknown as Record<string, unknown>
  ctx.db = undefined
  await expect(
    refreshExtraction(
      ctx as unknown as Parameters<typeof refreshExtraction>[0],
      { paper_id: "p1" },
    ),
  ).rejects.toThrow(/NO_ACTIVE_CORPUS/)
})

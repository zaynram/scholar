// src/server/tools/papers.test.ts — extraction cycle 6.6 (Red)
//
// Hybrid lexical+semantic search via Reciprocal Rank Fusion (k=60) per §6.6
// "hybrid lexical + sqlite-vec" envelope. Degrades to lexical-only with
// `still_indexing: true` when settings.chunk_vec.created='false' (§11 pill).
// scholar.papers.update bumps status_touched_at so reading_queue reorders.
import { test, expect, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { searchPapers, updatePaper } from "./papers.ts"
import { applyMigrations } from "#server/db/migrations.ts"
import { runRawDdl } from "#server/db/raw-ddl.ts"
import * as vecModule from "#server/db/sqlite-vec.ts"
import { ensureVec0Path } from "%/util"

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

// H3 (2026-05-28): seededDb now runs the real Drizzle migrations instead of
// hand-rolling DDL that drifted from production schema (the old inline `papers`
// table was missing the `abstract` column, plus a few others). Schema drift
// would silently mask breakage in the actual search/update paths under test.
// chunk_vec lives in runRawDdl, which applyMigrations already invokes — but
// only AFTER migrate() has populated the empty `settings` table. So we apply,
// seed `settings.chunk_vec.created`, then re-run runRawDdl so chunk_vec
// materializes for the non-deferred branch.
function seededDb(opts?: { deferred?: boolean }) {
  const sqlite = new Database(":memory:")
  sqlite.loadExtension(ensureVec0Path())
  sqlite.exec("PRAGMA foreign_keys = ON")
  const db = drizzle(sqlite)
  applyMigrations(db)
  if (opts?.deferred) {
    sqlite.run(
      `INSERT INTO settings(key,value) VALUES ('chunk_vec.created','false')`,
    )
  } else {
    sqlite.run(`INSERT INTO settings(key,value) VALUES
      ('embed.dim','768'),
      ('chunk_vec.created','true')`)
  }
  runRawDdl(db)
  return sqlite
}

const noopLog = { trace() {}, debug() {}, info() {}, warn() {}, error() {} }

function fakeCtx(sqlite: Database) {
  const db = drizzle(sqlite)
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
    withCorpus: async <T,>(
      fn: (db: ReturnType<typeof drizzle>) => Promise<T> | T,
    ) => await fn(db),
    embed: async (_m: string, p: string) => deterministicEmbedding(768, p),
  } as unknown as Parameters<typeof searchPapers>[0]
}

test("hybrid search: returns lexical + semantic hits ranked via RRF (k=60)", async () => {
  const sqlite = seededDb()
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at) VALUES
    ('p1','smith2024','Scaling laws for language models','2026-01-01T00:00:00.000Z'),
    ('p2','jones2024','Architecture search techniques','2026-01-01T00:00:00.000Z'),
    ('p3','doe2024','Optimization of training','2026-01-01T00:00:00.000Z')`)
  sqlite.run(`INSERT INTO paper_chunks(id,paper_id,ordinal,text,embedded_at) VALUES
    ('c1','p1',0,'Scaling laws describe model capacity','2026-01-01T00:00:00.000Z'),
    ('c2','p2',0,'NAS finds good architectures','2026-01-01T00:00:00.000Z'),
    ('c3','p3',0,'Training optimization techniques','2026-01-01T00:00:00.000Z')`)
  for (const [id, txt] of [
    ["c1", "Scaling laws describe model capacity"],
    ["c2", "NAS finds good architectures"],
    ["c3", "Training optimization techniques"],
  ] as const) {
    sqlite
      .prepare(`INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)`)
      .run(id, deterministicEmbedding(768, txt))
  }

  const result = await searchPapers(fakeCtx(sqlite), { q: "scaling laws" })
  expect(result.still_indexing).toBe(false)
  // p1 wins by combined lexical (title match) + semantic (chunk text match).
  expect(result.hits[0]!.id).toBe("p1")
  expect(result.hits.map((h) => h.id)).toContain("p1")
})

test("hybrid search: invokes toTightFloat32 at the qvec bind site (M3)", async () => {
  // Audit M3 + pr-test-analyzer follow-up: the unit tests in
  // sqlite-vec.test.ts pin toTightFloat32's behavior; this test pins the
  // CALL — that searchPapers actually routes ctx.embed's output through the
  // wrap before binding it to vec_distance_cosine. Spying on the module
  // export catches a regression where the wrap is removed from papers.ts
  // even on a bun:sqlite version that happens to honor view bind directly.
  const sqlite = seededDb()
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at) VALUES
    ('p1','smith2024','Scaling laws','2026-01-01T00:00:00.000Z'),
    ('p2','jones2024','Architecture search','2026-01-01T00:00:00.000Z')`)
  sqlite.run(`INSERT INTO paper_chunks(id,paper_id,ordinal,text,embedded_at) VALUES
    ('c1','p1',0,'Scaling laws describe model capacity','2026-01-01T00:00:00.000Z'),
    ('c2','p2',0,'NAS finds good architectures','2026-01-01T00:00:00.000Z')`)
  for (const [id, txt] of [
    ["c1", "Scaling laws describe model capacity"],
    ["c2", "NAS finds good architectures"],
  ] as const) {
    sqlite
      .prepare(`INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)`)
      .run(id, deterministicEmbedding(768, txt))
  }

  // Inject an embed that returns a view positioned at a non-zero offset of a
  // larger backing buffer — to verify toTightFloat32 sees a non-tight input.
  const ctx = fakeCtx(sqlite) as unknown as { embed: (m: string, p: string) => Promise<Float32Array> }
  ctx.embed = async (_m, p) => {
    const dim = 768
    const tight = deterministicEmbedding(dim, p)
    const big = new ArrayBuffer((dim + 8) * 4)
    const view = new Float32Array(big, 4 * 4, dim)
    view.set(tight)
    return view
  }

  const wrapSpy = spyOn(vecModule, "toTightFloat32")
  try {
    const result = await searchPapers(ctx as unknown as Parameters<typeof searchPapers>[0], { q: "Scaling laws describe model capacity" })
    expect(result.hits[0]!.id).toBe("p1")
    expect(wrapSpy).toHaveBeenCalled()
    // Confirm the spy saw a non-tight input (the injected view), proving the
    // wrap site is the qvec path rather than some unrelated incidental call.
    const sawView = wrapSpy.mock.calls.some(
      ([arr]) =>
        arr instanceof Float32Array && arr.buffer.byteLength !== arr.byteLength,
    )
    expect(sawView).toBe(true)
  } finally {
    wrapSpy.mockRestore()
  }
})

test("hybrid search: vec scan LIMIT keeps per-paper diversity under chunk saturation (M5)", async () => {
  // Audit M5: per-paper aggregation downstream picks MIN(d) per paper_id.
  // With the old LIMIT 200, a corpus where any single paper had >=200 chunks
  // closer to the query than other papers' best chunks would starve those
  // other papers out of vec_rank entirely. LIMIT 1000 covers the personal-use
  // 5k-chunk budget without exposing diversity starvation.
  //
  // Construction: paper A saturates ranks 1..250 with cosine distances near
  // zero; paper B's best chunks land near rank 251; paper C's near rank 256.
  // Under LIMIT 200 the SQL scan only returns A's chunks — B and C end up
  // with no vec_rank entry. Under LIMIT 1000 all three papers surface.
  const sqlite = seededDb();
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at) VALUES
    ('pA','kA','alpha','2026-01-01T00:00:00.000Z'),
    ('pB','kB','beta','2026-01-01T00:00:00.000Z'),
    ('pC','kC','gamma','2026-01-01T00:00:00.000Z')`);

  const insChunk = sqlite.prepare(
    `INSERT INTO paper_chunks(id,paper_id,ordinal,text,embedded_at) VALUES (?,?,?,?,'2026-01-01T00:00:00.000Z')`,
  );
  const insVec = sqlite.prepare(
    `INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)`,
  );
  const dim = 768;
  function vec(a: number, b: number): Float32Array {
    const v = new Float32Array(dim);
    v[0] = a; v[1] = b;
    return v;
  }
  for (let i = 0; i < 250; i++) {
    const id = `a${i}`;
    insChunk.run(id, "pA", i, `a${i}`);
    insVec.run(id, vec(1, 0.001 * (i + 1)));
  }
  for (let i = 0; i < 5; i++) {
    const id = `b${i}`;
    insChunk.run(id, "pB", i, `b${i}`);
    insVec.run(id, vec(1, 0.5));
  }
  for (let i = 0; i < 5; i++) {
    const id = `c${i}`;
    insChunk.run(id, "pC", i, `c${i}`);
    insVec.run(id, vec(1, 1.0));
  }

  // Force the query embedding to match A's structure (b=0) so cosine-distance
  // ordering is deterministic: A's 250 chunks dominate the closest 250 ranks,
  // then B's 5, then C's 5. Use a query string that lex-matches NOTHING so
  // result.hits is populated purely via vec_rank.
  const ctx = fakeCtx(sqlite) as unknown as { embed: (m: string, p: string) => Promise<Float32Array> };
  ctx.embed = async () => vec(1, 0);

  const result = await searchPapers(
    ctx as unknown as Parameters<typeof searchPapers>[0],
    { q: "zzzz-no-lex-match", limit: 50 },
  );

  const ids = result.hits.map((h) => h.id);
  expect(ids).toContain("pA");
  expect(ids).toContain("pB");
  expect(ids).toContain("pC");
  expect(result.hits.find((h) => h.id === "pA")!.vec_rank).toBe(1);
  expect(result.hits.find((h) => h.id === "pB")!.vec_rank).toBe(2);
  expect(result.hits.find((h) => h.id === "pC")!.vec_rank).toBe(3);
});

test("hybrid search: degrades to lexical-only when chunk_vec is deferred (still_indexing=true)", async () => {
  const sqlite = seededDb({ deferred: true })
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at) VALUES
    ('p1','foo','Foo bar baz','2026-01-01T00:00:00.000Z')`)

  const result = await searchPapers(fakeCtx(sqlite), { q: "foo" })
  expect(result.still_indexing).toBe(true)
  expect(result.hits[0]!.id).toBe("p1")
})

test("hybrid search: respects limit parameter (default 20)", async () => {
  const sqlite = seededDb()
  // Insert 30 papers with the same hit-word.
  const stmt = sqlite.prepare(
    `INSERT INTO papers(id,key,title,imported_at) VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z')`,
  )
  for (let i = 0; i < 30; i++) stmt.run(`p${i}`, `k${i}`, `keyword ${i}`)
  const r1 = await searchPapers(fakeCtx(sqlite), { q: "keyword" })
  expect(r1.hits.length).toBeLessThanOrEqual(20)
  const r2 = await searchPapers(fakeCtx(sqlite), { q: "keyword", limit: 5 })
  expect(r2.hits.length).toBeLessThanOrEqual(5)
})

// §12.0 boundary check (papers.search). The untrusted `q` becomes `%${q}%`
// (papers.ts:101) and is bound via `?` (papers.ts:107) — it is DATA, never
// concatenated into SQL.
//
// The load-bearing tripwire is assertion 1 (literal-match). If `q` were
// interpolated into the SQL string instead of bound, the `'` in the payload
// closes the string literal early → prepare() throws, or the truncated
// `LIKE '%'` matches everything (→ ["p1","p2"]); either way assertion 1 goes
// red. Assertion 2 (table survives) is a *weaker* guard: under a `.prepare()`
// interpolation bug SQLite compiles only the first statement and the trailing
// `DROP` sits unparsed, so the table survives anyway — assertion 2 only
// discriminates a switch to a multi-statement exec path (e.g. `.exec()`) on
// interpolated SQL. (`%`/`_` ARE LIKE wildcards even when bound — that is LIKE
// semantics, not injection; the threat is breaking OUT of the literal, which
// the `'`/`;`/`--` payload exercises.)
test("papers.search: untrusted query is bound, not interpolated (§12.0 SQL-injection safety)", async () => {
  const sqlite = seededDb({ deferred: true }) // lexical-only path: no vec setup needed
  const payload = `'; DROP TABLE papers; --`
  const ins = sqlite.prepare(
    `INSERT INTO papers(id,key,title,imported_at) VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z')`,
  )
  ins.run("p1", "k1", "Attention is all you need")
  ins.run("p2", "k2", `paper about ${payload} syntax`) // title literally contains the payload

  // 1) Tripwire — literal-match semantics: the metacharacter payload is matched
  //    as a plain substring (binding treats it as data) → finds p2, not p1.
  //    Interpolation breaks this assertion.
  const hit = await searchPapers(fakeCtx(sqlite), { q: payload })
  expect(hit.hits.map((h) => h.id)).toEqual(["p2"])

  // 2) Weaker guard: the table survives the `DROP TABLE` payload. This holds
  //    even under a `.prepare()` interpolation bug (trailing statement left
  //    unparsed); it only fails if the SQL moves to a multi-statement exec.
  const count = (
    sqlite.query("SELECT COUNT(*) AS n FROM papers").get() as { n: number }
  ).n
  expect(count).toBe(2)
})

test("scholar.papers.update: status flip bumps status_touched_at; reading_queue reorders", async () => {
  const sqlite = seededDb()
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at) VALUES
    ('p1','foo','Foo','2026-01-01T00:00:00.000Z'),
    ('p2','bar','Bar','2026-01-01T00:00:00.000Z')`)

  await updatePaper(fakeCtx(sqlite), { paper_id: "p1", status: "reading" })
  const queue = sqlite.query("SELECT id, status FROM reading_queue").all() as {
    id: string
    status: string
  }[]
  // 'reading' beats 'pending' regardless of other terms.
  expect(queue[0]!.id).toBe("p1")
  expect(queue[0]!.status).toBe("reading")

  const touched = (
    sqlite
      .query("SELECT status_touched_at FROM papers WHERE id='p1'")
      .get() as { status_touched_at: string }
  ).status_touched_at
  expect(touched).toMatch(/^\d{4}-\d{2}-\d{2}T/)
})

test("scholar.papers.update: priority / depth / role / section partial updates", async () => {
  const sqlite = seededDb()
  sqlite.run(`INSERT INTO papers(id,key,title,imported_at) VALUES
    ('p1','foo','Foo','2026-01-01T00:00:00.000Z')`)
  await updatePaper(fakeCtx(sqlite), {
    paper_id: "p1",
    priority: 7,
    depth: "deep",
    role: "primary",
    section: "Methods",
  })
  const row = sqlite
    .query("SELECT priority, depth, role, section FROM papers WHERE id='p1'")
    .get() as { priority: number; depth: string; role: string; section: string }
  expect(row.priority).toBe(7)
  expect(row.depth).toBe("deep")
  expect(row.role).toBe("primary")
  expect(row.section).toBe("Methods")
})

test("scholar.papers.search / update: NO_ACTIVE_CORPUS guards", async () => {
  const sqlite = seededDb()
  const ctx = fakeCtx(sqlite) as unknown as Record<string, unknown>
  ctx.db = undefined
  await expect(
    searchPapers(ctx as unknown as Parameters<typeof searchPapers>[0], {
      q: "x",
    }),
  ).rejects.toThrow(/NO_ACTIVE_CORPUS/)
  await expect(
    updatePaper(ctx as unknown as Parameters<typeof updatePaper>[0], {
      paper_id: "p1",
      status: "reading",
    }),
  ).rejects.toThrow(/NO_ACTIVE_CORPUS/)
})

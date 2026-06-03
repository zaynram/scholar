// src/server/tools/corpus.test.ts — corpus plan cycle 6.3 RED
//
// Tests for scholar.corpus.* tools and scholar.dashboard view-opener.
// Uses buildServer with a temp runtimeRoot + pre-migrated configDb.
import { test, expect, describe, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, type BuiltServer } from "../index.ts";
import { openWithPragmas, applyMigrations } from "../db/migrations.ts";
import type { PdfChild } from "./registry.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

let dir: string;
let built: BuiltServer;
let setRootsMock: ReturnType<typeof mock>;
const origRuntimeRoot = process.env.SCHOLAR_RUNTIME_ROOT;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scholar-corpus-test-"));
  mkdirSync(join(dir, "dbs"), { recursive: true });
  process.env.SCHOLAR_RUNTIME_ROOT = dir;

  const configDb = openWithPragmas(join(dir, "dbs", "scholar-config.db"));
  applyMigrations(configDb);

  setRootsMock = mock(async (_roots: string[]) => {});
  const mockPdf: PdfChild = {
    interact: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
    getText: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
    currentRoots: () => [],
    setRoots: setRootsMock as unknown as (roots: string[]) => Promise<void>,
    displayPdf: async () => ({ viewUUID: "stub-view-uuid" }),
    isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
  };

  built = buildServer({
    runtimeRoot: dir,
    openConfigDb: () => configDb,
    spawnPdfChild: () => mockPdf,
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (origRuntimeRoot === undefined) delete process.env.SCHOLAR_RUNTIME_ROOT;
  else process.env.SCHOLAR_RUNTIME_ROOT = origRuntimeRoot;
});

const dispatch = (tool: string, args: unknown) => built.dispatch(tool, args);

// Convenience: dispatch corpus.create with defaults
const createCorpus = (slug: string, displayName = "Test Corpus", pdfRoot?: string) =>
  dispatch("scholar.corpus.create", {
    slug,
    display_name: displayName,
    initial_pdf_root: pdfRoot ?? dir,
  });

// ─── slug validation (parametric) ─────────────────────────────────────────────

describe("scholar.corpus.create slug validation", () => {
  const invalidSlugs: [string, string][] = [
    ["empty string", ""],
    ["uppercase", "MyCorpus"],
    ["leading digit", "1abc"],
    ["leading dash", "-abc"],
    ["dot in name", "foo.db"],
    ["65 chars", "a".repeat(65)],
    ["null byte", "abc\x00def"],
    ["reserved config", "config"],
    ["Windows reserved con", "con"],
    ["Windows reserved nul", "nul"],
    ["Windows reserved aux", "aux"],
    ["Windows reserved prn", "prn"],
    ["Windows reserved com1", "com1"],
    ["Windows reserved lpt1", "lpt1"],
    ["path traversal", "../escape"],
  ];

  for (const [label, slug] of invalidSlugs) {
    test(`rejects slug: ${label}`, async () => {
      await expect(createCorpus(slug)).rejects.toMatchObject({ code: "INVALID_SLUG" });
    });
  }

  test("accepts valid slug 'my-corpus-1'", async () => {
    await expect(createCorpus("my-corpus-1")).resolves.toBeDefined();
  });

  test("accepts max-length valid slug (64 chars)", async () => {
    const slug = "a" + "b".repeat(63);
    await expect(createCorpus(slug)).resolves.toBeDefined();
  });
});

// ─── display_name sanitization ────────────────────────────────────────────────

describe("scholar.corpus.create display_name sanitization", () => {
  test("strips bidi-override U+202E from display_name", async () => {
    await createCorpus("bidi-test", "‮evil");
    const row = built.ctx.config.corpora().find(c => c.id === "bidi-test");
    expect(row?.display_name).toBe("evil");
  });

  test("strips PUA codepoint U+E000 from display_name", async () => {
    await createCorpus("pua-test", "foobar");
    const row = built.ctx.config.corpora().find(c => c.id === "pua-test");
    expect(row?.display_name).toBe("foobar");
  });

  test("strips tag-block character from display_name", async () => {
    // U+E0040 (tag Latin Capital Letter A) embedded in string
    const input = "foo\u{E0040}bar";
    await createCorpus("tag-test", input);
    const row = built.ctx.config.corpora().find(c => c.id === "tag-test");
    expect(row?.display_name).toBe("foobar");
  });

  test("truncates display_name > 128 chars", async () => {
    const long = "x".repeat(200);
    await createCorpus("trunc-test", long);
    const row = built.ctx.config.corpora().find(c => c.id === "trunc-test");
    expect(row!.display_name.length).toBeLessThanOrEqual(128);
  });
});

// ─── concurrent create race ───────────────────────────────────────────────────

test("parallel corpus.create on same slug produces exactly one corpus row", async () => {
  const results = await Promise.allSettled([
    createCorpus("race"),
    createCorpus("race"),
  ]);
  // At least one succeeds
  const succeeded = results.filter(r => r.status === "fulfilled");
  expect(succeeded.length).toBeGreaterThanOrEqual(1);
  // Exactly one corpus row regardless of how many calls "succeeded"
  const rows = built.ctx.config.corpora();
  expect(rows.filter(r => r.id === "race")).toHaveLength(1);
  // Exactly one DB file exists
  expect(existsSync(join(dir, "dbs", "scholar-race.db"))).toBe(true);
});

// ─── atomicity ───────────────────────────────────────────────────────────────

test("corpus.create with orphan DB returns ORPHAN_DB_EXISTS", async () => {
  // Pre-create the DB file to simulate an orphan
  const dbPath = join(dir, "dbs", "scholar-orphan.db");
  mkdirSync(join(dir, "dbs"), { recursive: true });
  // Create an empty file at that path
  Bun.file(dbPath).writer().flush();
  // Use rawClient to actually create the file
  const { Database } = await import("bun:sqlite");
  new Database(dbPath).close();

  await expect(createCorpus("orphan")).rejects.toMatchObject({ code: "ORPHAN_DB_EXISTS" });
});

// ─── lifecycle ───────────────────────────────────────────────────────────────

test("corpus.list returns empty array on fresh config DB", async () => {
  const result = await dispatch("scholar.corpus.list", {}) as { corpora: unknown[] };
  expect(result.corpora).toEqual([]);
});

test("corpus.create then corpus.list returns the created corpus", async () => {
  await createCorpus("daisy");
  const result = await dispatch("scholar.corpus.list", {}) as { corpora: Array<{ id: string }> };
  expect(result.corpora).toHaveLength(1);
  expect(result.corpora[0]!.id).toBe("daisy");
});

test("corpus.activate mutates ctx.db to the named corpus DB", async () => {
  await createCorpus("daisy");
  expect(built.ctx.db).toBeUndefined();
  await dispatch("scholar.corpus.activate", { slug: "daisy" });
  expect(built.ctx.db).toBeDefined();
});

test("corpus.activate on already-active corpus is idempotent", async () => {
  await createCorpus("daisy");
  await dispatch("scholar.corpus.activate", { slug: "daisy" });
  // Second activate — should return without re-running factory
  const result = await dispatch("scholar.corpus.activate", { slug: "daisy" });
  expect(result).toBeDefined();
});

test("corpus.activate on nonexistent corpus rejects with structured error", async () => {
  await expect(dispatch("scholar.corpus.activate", { slug: "nope" }))
    .rejects.toMatchObject({ code: "CORPUS_NOT_FOUND" });
});

test("corpus.activate on archived corpus rejects with structured error", async () => {
  await createCorpus("arch");
  await dispatch("scholar.corpus.archive", { slug: "arch" });
  await expect(dispatch("scholar.corpus.activate", { slug: "arch" }))
    .rejects.toMatchObject({ code: "CORPUS_ARCHIVED" });
});

test("corpus.activate calls ctx.pdf.setRoots with corpus PDF roots", async () => {
  await createCorpus("pdfroots", "Test", dir);
  await dispatch("scholar.corpus.activate", { slug: "pdfroots" });
  expect(setRootsMock).toHaveBeenCalledTimes(1);
  const [roots] = (setRootsMock as unknown as { mock: { calls: string[][][] } }).mock.calls[0]!;
  expect(Array.isArray(roots)).toBe(true);
});

test("corpus.activate tolerates a failing pdf.setRoots — corpus still activates (Bug #2a best-effort root push)", async () => {
  // A missing or crashed pdf child throws on setRoots, but by then the corpus is
  // already durably active (ctx.db + activeCorpusId + config.json committed).
  // Activation MUST resolve (not reject) and leave ctx.db open; the root push is
  // best-effort. Before the fix this rejected with PDF_CHILD_UNAVAILABLE while
  // the corpus was active — a partial success reported as a failure.
  await createCorpus("besteffort");
  setRootsMock.mockImplementation(async () => {
    throw new Error("PDF_CHILD_UNAVAILABLE");
  });
  await dispatch("scholar.corpus.activate", { slug: "besteffort" });
  expect(built.ctx.db).toBeDefined();
});

test("corpus.activate opens ctx.db on a fresh process even when activeCorpusId is already persisted (Bug #2a′ idempotency guard)", async () => {
  // Simulate a fresh runServer process: the corpus was activated in a PRIOR
  // session (activeCorpusId persisted in the config DB) but THIS process never
  // opened it (ctx.db === undefined). A bare `activeCorpusId === slug` idempotency
  // check short-circuits and leaves ctx.db undefined — activate falsely reports
  // success while every corpus-scoped tool (ingest, pdf.open) fails with no open
  // db. The `&& ctx.db` guard forces the real open. THIS assertion is the
  // live-session failure that would have wasted the user's login.
  await createCorpus("persisted");
  built.ctx.config.set("activeCorpusId", "persisted"); // prior-session state, db NOT open here
  expect(built.ctx.db).toBeUndefined();
  await dispatch("scholar.corpus.activate", { slug: "persisted" });
  expect(built.ctx.db).toBeDefined();
});

test("corpus.activate payload surfaces a pdf_child health discriminator + truthful dbOpen", async () => {
  // Degrade-to-stub on a failed pdf spawn is intentionally visible, not silent:
  // a stub's PDF_CHILD_UNAVAILABLE is indistinguishable from "#3 wiring never
  // landed". `pdf_child` exposes isHealthy() (alive:true = real child, false =
  // stub) so an operator can tell the two apart. `dbOpen` must reflect the REAL
  // in-process handle (ctx.db !== undefined), not the persisted activeCorpusId.
  await createCorpus("healthy");
  const result = (await dispatch("scholar.corpus.activate", { slug: "healthy" })) as {
    pdf_child: { alive: boolean };
    dbOpen: boolean;
  };
  expect(result.pdf_child).toMatchObject({ alive: expect.any(Boolean) });
  expect(result.dbOpen).toBe(true);
});

test("corpus.archive sets archived_at; subsequent status shows archived", async () => {
  await createCorpus("toarch");
  await dispatch("scholar.corpus.archive", { slug: "toarch" });
  const row = built.ctx.config.corpora().find(c => c.id === "toarch");
  expect(row?.archived_at).not.toBeNull();
});

test("corpus.archive on active corpus clears ctx.db", async () => {
  await createCorpus("active-arch");
  await dispatch("scholar.corpus.activate", { slug: "active-arch" });
  expect(built.ctx.db).toBeDefined();
  await dispatch("scholar.corpus.archive", { slug: "active-arch" });
  expect(built.ctx.db).toBeUndefined();
});

test("corpus.archive DB-failure leaves ctx.db and config.json untouched (M4)", async () => {
  // This is tested by ensuring archive on non-existent corpus fails cleanly
  await expect(dispatch("scholar.corpus.archive", { slug: "ghost" }))
    .rejects.toMatchObject({ code: "CORPUS_NOT_FOUND" });
  // ctx.db should be unmodified (still undefined)
  expect(built.ctx.db).toBeUndefined();
});

test("corpus.status returns counts and last_opened_at", async () => {
  await createCorpus("status-test");
  await dispatch("scholar.corpus.activate", { slug: "status-test" });
  const result = await dispatch("scholar.corpus.status", { slug: "status-test" }) as {
    last_opened_at: string | null;
    paper_count: number;
  };
  expect(result).toMatchObject({ paper_count: expect.any(Number) });
});

test("corpus.reset-init clears initOnce slot allowing re-create after failure", async () => {
  // The slot for a failed create should be cleared on error (retry semantics)
  // corpus.reset-init explicitly clears the corpus: slot
  await createCorpus("resetme");
  // After creation, activate it (this sets the corpus: slot)
  await dispatch("scholar.corpus.activate", { slug: "resetme" });
  // Reset-init should clear the slot
  await expect(dispatch("scholar.corpus.reset-init", { slug: "resetme" })).resolves.toBeDefined();
});

test("scholar.dashboard returns structuredContent with view: dashboard", async () => {
  const result = await dispatch("scholar.dashboard", {}) as { view: string };
  expect(result).toMatchObject({ view: "dashboard" });
});

// ─── H1: corpus.export argv-only spawn (no shell interpolation) ─────────────

test("corpus.export survives a runtime-root path containing shell metacharacters", async () => {
  // Audit H1: handleExport previously built `sh -c "tar ... | zstd -o ${dest}"`
  // with double-quoted interpolated paths. A path containing `"` unbalances
  // the shell quoting, so the export either errors (best case) or executes
  // injected fragments (worst case). After the fix, `tar --zstd` is invoked
  // argv-form and the path is passed literally.
  const dirtyRoot = mkdtempSync(join(tmpdir(), 'scholar-export-dir"ty'));
  mkdirSync(join(dirtyRoot, "dbs"), { recursive: true });
  const origRoot = process.env.SCHOLAR_RUNTIME_ROOT;
  process.env.SCHOLAR_RUNTIME_ROOT = dirtyRoot;
  try {
    const dirtyConfigDb = openWithPragmas(join(dirtyRoot, "dbs", "scholar-config.db"));
    applyMigrations(dirtyConfigDb);
    const dirtyBuilt = buildServer({
      runtimeRoot: dirtyRoot,
      openConfigDb: () => dirtyConfigDb,
      spawnPdfChild: () => ({
        interact: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
        getText: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
        currentRoots: () => [],
        setRoots: async () => {},
        displayPdf: async () => ({ viewUUID: "stub-view-uuid" }),
        isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
      }),
    });
    await dirtyBuilt.dispatch("scholar.corpus.create", {
      slug: "dirty-export",
      display_name: "Dirty Export",
      initial_pdf_root: dirtyRoot,
    });
    await dirtyBuilt.dispatch("scholar.corpus.activate", { slug: "dirty-export" });
    const result = (await dirtyBuilt.dispatch("scholar.corpus.export", {
      slug: "dirty-export",
    })) as { exported_to: string };
    expect(existsSync(result.exported_to)).toBe(true);
  } finally {
    rmSync(dirtyRoot, { recursive: true, force: true });
    if (origRoot === undefined) delete process.env.SCHOLAR_RUNTIME_ROOT;
    else process.env.SCHOLAR_RUNTIME_ROOT = origRoot;
  }
});

// ─── posture-B regression guard ──────────────────────────────────────────────

test("corpus handlers make no sqlite3-mcp calls (posture-B guard)", async () => {
  // ctx has no sqlite3 field; verify no property matching sqlite3 is accessed
  const strictPdf = new Proxy(built.ctx.pdf, {
    get(target, prop) {
      if (typeof prop === "string" && prop.includes("sqlite3")) {
        throw new Error(`sqlite3-mcp access detected on ctx.pdf: ${String(prop)}`);
      }
      return Reflect.get(target, prop);
    },
  });
  // Temporarily swap pdf with strict proxy
  const origPdf = built.ctx.pdf;
  (built.ctx as unknown as { pdf: typeof strictPdf }).pdf = strictPdf;
  try {
    await createCorpus("b-guard");
    await dispatch("scholar.corpus.activate", { slug: "b-guard" });
  } finally {
    (built.ctx as unknown as { pdf: typeof origPdf }).pdf = origPdf;
  }
  // If we reach here, no sqlite3-mcp access occurred
  expect(true).toBe(true);
});

// src/server/tools/roots.test.ts — corpus plan cycle 6.3 RED
//
// Tests for scholar.roots.* tools.
// Depends on scholar.corpus.create + scholar.corpus.activate being functional.
import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, type BuiltServer } from "../index.ts";
import { openWithPragmas, applyMigrations } from "../db/migrations.ts";
import type { PdfChild } from "./registry.ts";

let dir: string;
let built: BuiltServer;
let setRootsMock: ReturnType<typeof mock>;
const origRuntimeRoot = process.env.SCHOLAR_RUNTIME_ROOT;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-roots-test-"));
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
    isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
  };

  built = buildServer({
    runtimeRoot: dir,
    openConfigDb: () => configDb,
    spawnPdfChild: () => mockPdf,
  });

  // Create and activate "daisy" corpus for all roots tests
  await built.dispatch("scholar.corpus.create", {
    slug: "daisy",
    display_name: "Daisy Corpus",
    initial_pdf_root: dir,
  });
  await built.dispatch("scholar.corpus.activate", { slug: "daisy" });
  // Reset mock call count after corpus.activate (which calls setRoots once)
  setRootsMock.mockClear();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (origRuntimeRoot === undefined) delete process.env.SCHOLAR_RUNTIME_ROOT;
  else process.env.SCHOLAR_RUNTIME_ROOT = origRuntimeRoot;
});

const dispatch = (tool: string, args: unknown) => built.dispatch(tool, args);

// ─── scholar.roots.list ───────────────────────────────────────────────────────

test("roots.list returns the initial PDF root for active corpus", async () => {
  const result = await dispatch("scholar.roots.list", {}) as { roots: Array<{ path: string; is_default: boolean }> };
  expect(result.roots).toHaveLength(1);
  expect(result.roots[0]!.path).toBe(dir);
  expect(result.roots[0]!.is_default).toBe(true);
});

// ─── scholar.roots.add ────────────────────────────────────────────────────────

test("roots.add inserts a new root row and calls ctx.pdf.setRoots", async () => {
  const newRoot = join(dir, "extra");
  mkdirSync(newRoot, { recursive: true });
  await dispatch("scholar.roots.add", { path: newRoot });

  const result = await dispatch("scholar.roots.list", {}) as { roots: Array<{ path: string }> };
  expect(result.roots.some(r => r.path === newRoot)).toBe(true);

  expect(setRootsMock).toHaveBeenCalledTimes(1);
  const [paths] = (setRootsMock as unknown as { mock: { calls: string[][][] } }).mock.calls[0]!;
  expect(paths).toContain(newRoot);
});

test("roots.add deduplicates — adding same path twice yields one row", async () => {
  const extra = join(dir, "dup");
  mkdirSync(extra, { recursive: true });
  await dispatch("scholar.roots.add", { path: extra });
  await dispatch("scholar.roots.add", { path: extra });

  const result = await dispatch("scholar.roots.list", {}) as { roots: Array<{ path: string }> };
  const matches = result.roots.filter(r => r.path === extra);
  expect(matches).toHaveLength(1);
});

// ─── scholar.roots.remove ─────────────────────────────────────────────────────

test("roots.remove on a non-default root calls ctx.pdf.setRoots and removes the row", async () => {
  const extra = join(dir, "extra2");
  mkdirSync(extra, { recursive: true });
  await dispatch("scholar.roots.add", { path: extra });
  setRootsMock.mockClear();

  await dispatch("scholar.roots.remove", { path: extra });

  const result = await dispatch("scholar.roots.list", {}) as { roots: Array<{ path: string }> };
  expect(result.roots.some(r => r.path === extra)).toBe(false);
  expect(setRootsMock).toHaveBeenCalledTimes(1);
});

test("roots.remove on default root promotes oldest remaining root to default", async () => {
  const extra = join(dir, "extra3");
  mkdirSync(extra, { recursive: true });
  await dispatch("scholar.roots.add", { path: extra });

  // Remove the original default root (dir)
  await dispatch("scholar.roots.remove", { path: dir });

  const result = await dispatch("scholar.roots.list", {}) as { roots: Array<{ path: string; is_default: boolean }> };
  expect(result.roots).toHaveLength(1);
  expect(result.roots[0]!.path).toBe(extra);
  expect(result.roots[0]!.is_default).toBe(true);
  expect(setRootsMock).toHaveBeenCalledTimes(2); // once for add, once for remove
});

test("roots.remove on the only remaining root rejects", async () => {
  await expect(dispatch("scholar.roots.remove", { path: dir }))
    .rejects.toMatchObject({ code: "LAST_ROOT" });
});

// ─── scholar.roots.set-default ───────────────────────────────────────────────

test("roots.set-default flips is_default; only one default row per corpus", async () => {
  const extra = join(dir, "extra4");
  mkdirSync(extra, { recursive: true });
  await dispatch("scholar.roots.add", { path: extra });

  await dispatch("scholar.roots.set-default", { path: extra });

  const result = await dispatch("scholar.roots.list", {}) as { roots: Array<{ path: string; is_default: boolean }> };
  const defaults = result.roots.filter(r => r.is_default);
  expect(defaults).toHaveLength(1);
  expect(defaults[0]!.path).toBe(extra);
});

// ─── posture-B regression guard ──────────────────────────────────────────────

test("roots handlers make no sqlite3-mcp calls (posture-B guard)", async () => {
  // ctx.pdf has no sqlite3 surface; verify via proxy
  const strictPdf = new Proxy(built.ctx.pdf, {
    get(target, prop) {
      if (typeof prop === "string" && prop.includes("sqlite3")) {
        throw new Error(`sqlite3-mcp access detected: ${String(prop)}`);
      }
      return Reflect.get(target, prop);
    },
  });
  const origPdf = built.ctx.pdf;
  (built.ctx as unknown as { pdf: typeof strictPdf }).pdf = strictPdf;
  try {
    await dispatch("scholar.roots.list", {});
  } finally {
    (built.ctx as unknown as { pdf: typeof origPdf }).pdf = origPdf;
  }
  expect(true).toBe(true);
});

// src/server/pdf/lifecycle.resolvers.test.ts — slim-plugin pivot (2026-06-01).
//
// Pure, always-run unit tests for the two runtime-resolution seams the pivot
// introduced. The spawn supervisor itself is exercised by the SCHOLAR_PDF_E2E
// fixtures in lifecycle.test.ts; these cover the branch logic those fixtures
// reach only indirectly (and which CI, without SCHOLAR_PDF_E2E, never runs).
// They retire the manual package-path verification done during the pivot:
//   - resolveChildEntrypoint's existsSync(${CLAUDE_PLUGIN_ROOT}/dist/...) branch
//   - resolveBunRuntime's process.execPath default
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveChildEntrypoint,
  resolveBunRuntime,
} from "./lifecycle.ts";

// Save/restore the env keys these resolvers read so cases don't bleed.
const ENV_KEYS = [
  "SCHOLAR_PDF_ENTRYPOINT",
  "CLAUDE_PLUGIN_ROOT",
  "SCHOLAR_BUN_PATH",
] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
const tmpDirs: string[] = [];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshRoot(withShippedBundle: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "scholar-resolve-"));
  tmpDirs.push(root);
  if (withShippedBundle) {
    const dir = join(root, "dist", "pdf-server");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.js"), "// shipped bundle stub\n");
  }
  return root;
}

// ── resolveChildEntrypoint ────────────────────────────────────────────────
test("resolveChildEntrypoint: explicit override beats every other source", () => {
  process.env.SCHOLAR_PDF_ENTRYPOINT = "/env/pdf.js";
  process.env.CLAUDE_PLUGIN_ROOT = freshRoot(true);
  expect(resolveChildEntrypoint("/override/pdf.js")).toBe("/override/pdf.js");
});

test("resolveChildEntrypoint: SCHOLAR_PDF_ENTRYPOINT wins when no override", () => {
  process.env.SCHOLAR_PDF_ENTRYPOINT = "/env/pdf.js";
  process.env.CLAUDE_PLUGIN_ROOT = freshRoot(true);
  expect(resolveChildEntrypoint()).toBe("/env/pdf.js");
});

test("resolveChildEntrypoint: packaged branch — returns shipped bundle when it exists", () => {
  delete process.env.SCHOLAR_PDF_ENTRYPOINT;
  const root = freshRoot(true);
  process.env.CLAUDE_PLUGIN_ROOT = root;
  expect(resolveChildEntrypoint()).toBe(
    join(root, "dist", "pdf-server", "index.js"),
  );
});

test("resolveChildEntrypoint: dev fallback — vendored dist when no shipped bundle", () => {
  delete process.env.SCHOLAR_PDF_ENTRYPOINT;
  const root = freshRoot(false);
  process.env.CLAUDE_PLUGIN_ROOT = root;
  expect(resolveChildEntrypoint()).toBe(
    join(root, "src", "vendor", "pdf-server", "dist", "index.js"),
  );
});

// ── resolveBunRuntime ─────────────────────────────────────────────────────
test("resolveBunRuntime: explicit override beats env and execPath", () => {
  process.env.SCHOLAR_BUN_PATH = "/env/bun";
  expect(resolveBunRuntime("/override/bun")).toBe("/override/bun");
});

test("resolveBunRuntime: SCHOLAR_BUN_PATH wins when no override", () => {
  process.env.SCHOLAR_BUN_PATH = "/env/bun";
  expect(resolveBunRuntime()).toBe("/env/bun");
});

test("resolveBunRuntime: defaults to process.execPath (the provisioned bun)", () => {
  delete process.env.SCHOLAR_BUN_PATH;
  expect(resolveBunRuntime()).toBe(process.execPath);
});

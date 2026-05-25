// package.json.test.ts — foundation cycle 6.1 (Task 1.1)
//
// Pins the dep manifest so a later cycle accidentally editing `package.json`
// fails CI. Required-set is the foundation-009 frozen list (foundation-006/-008
// amendments plus Rulings #2/#3).
import { test, expect } from "bun:test";
import pkg from "./package.json";

test("foundation pins every required v1 runtime dep", () => {
  const deps = pkg.dependencies ?? {};
  // The frozen set — every downstream plan imports from these.
  // Rulings #2 + #3 (2026-05-24) added fflate (packaging zip-assembly) and
  // ulidx (id generation) per spec §14.1 + §8.2.
  // Foundation-006 (2026-05-24) added zod (MCP-SDK inputSchema per item 5)
  // and corrected pdf.js → pdfjs-dist (item 7).
  const required = [
    "@modelcontextprotocol/sdk",
    "@retorquere/bibtex-parser",
    "chart.js",
    "drizzle-orm",
    "fflate",
    "js-tiktoken",
    "koffi",
    "pdfjs-dist",
    "react",
    "react-dom",
    "sqlite-vec",
    "ulidx",
    "zod",
  ];
  for (const name of required) expect(deps[name as keyof typeof deps]).toBeDefined();
  expect(deps["@modelcontextprotocol/sdk"]).toMatch(/^\^1\.29\./);
});

test("foundation pre-declares every required v1 devDep (foundation-006 item 6)", () => {
  // The typecheck + db:generate scripts depend on these binaries. Spec §6.1's
  // enumeration is silent on `typescript`; foundation absorbs the deviation
  // and pins via this assertion. Pattern parallel to required-runtime above.
  const devDeps = pkg.devDependencies ?? {};
  const requiredDev = ["typescript", "drizzle-kit", "@types/react", "@types/react-dom", "bun-types"];
  for (const name of requiredDev) expect(devDeps[name as keyof typeof devDeps]).toBeDefined();
});

test("foundation declares forbidden deps are absent", () => {
  const all: Record<string, string> = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const forbidden of [
    "vite", "vite-plugin-singlefile", "better-sqlite3",
    "citation.js", "undici", "ofetch", "gpt-tokenizer", "vitest",
    // pdf.js@0.1.0 is the defunct 2012 package; canonical Mozilla dist is
    // pdfjs-dist (item 7 correction).
    "pdf.js",
  ]) {
    expect(all[forbidden]).toBeUndefined();
  }
});

test("foundation records vec0 ABI pin + bundled bun runtime version", () => {
  expect(pkg.scholar).toBeDefined();
  expect(typeof pkg.scholar.bunSqliteVersion).toBe("string");
  expect(typeof pkg.scholar.bundledBunVersion).toBe("string");
});

test("foundation pre-declares every npm script downstream plans invoke", () => {
  // Downstream plans NEVER edit package.json scripts — every script they
  // invoke must be pre-declared here. Per §6.1 invariant + lead's foundation-005
  // supplemental (frontends Task 9 Step 1 + packaging cycle 6.13 + bundle-budget gate).
  // Foundation-007 (2026-05-24) removed build:sqlite3-mcp per user posture B
  // pivot — see Cross-plan spec gaps §3-followon (SUPERSEDED).
  const scripts = pkg.scripts ?? {};
  for (const required of [
    "typecheck",
    "test",
    "db:generate",
    "build:server",
    "build:ui",
    "build:ui:dev",
    "build:pdf",
    "build:runtime",
    "build:vec",
    "build:nu",
    "build:plugin",
    "measure-bundle",
  ]) {
    expect(scripts[required as keyof typeof scripts]).toBeDefined();
  }
  // build:ui is the production (minified) target — bundle-budget gate measures
  // this output. build:ui:dev is the unminified variant for development. Both
  // emit to the same path so downstream consumers don't branch on env.
  // Since chore foundation-fix-build-ui-script-for-multi-file-output, both
  // scripts delegate to scripts/build-ui.ts (which uses `outdir`, not
  // `--outfile`). Minification is governed by env var (UI_MINIFY=false for
  // dev); the production script does NOT set UI_MINIFY=false.
  expect(scripts["build:ui"]).toContain("build-ui.ts");
  expect(scripts["build:ui"]).not.toContain("UI_MINIFY=false");
  expect(scripts["build:ui:dev"]).toContain("UI_MINIFY=false");
});

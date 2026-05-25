# Scholar Plugin — Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---

<!-- plan metadata -->
**Plan ID:** `2026-05-22-scholar-plugin-packaging`
**Plan Group:** `2026-05-22-scholar-plugin`
**Cycles:** [6.13]
**Depends-on:** `frontends`
**Blast-radius:** `scripts/build-plugin.ts`
**Worktree:** not-required
**Tier:** sonnet — single cycle, single file, every step maps directly from §14.1 with no symbol-level design decisions surfacing mid-task; opus headroom not needed.

---

**Goal:** Implement `scripts/build-plugin.ts` — the build orchestrator that runs the seven §14.1 build steps in order and assembles the `scholar.plugin` distributable archive.

**Architecture:** One Bun TypeScript script (`scripts/build-plugin.ts`) invokes seven sequential sub-steps (either `bun run <script>` shell-outs for steps 1–6 or direct Bun FS calls for file copies), assembles a `build/plugin/` staging tree, and zips it to `scholar.plugin`. The script reads from artifacts produced by every upstream plan's cycle (server binary from foundation/corpus/ingest/extraction/annotations; UI bundle, nu module, slash commands `commands/`, and skills `skills/` from frontends) and writes the final distributable. `step1_buildServer` is exported and accepts explicit `(buildRoot, fixture)` params so its sibling-copy branch is testable in isolation. A `BUILD_FIXTURE=1` env flag skips compilation steps and proceeds directly to the assembly/zip stage for integration testing. The companion test lives at `scripts/build-plugin.test.ts` — within the blast-radius because it is a spec-file sibling by project convention (`*.test.ts` co-located with source) even though blast-radius names only `scripts/build-plugin.ts`.

**Tech Stack:** Bun (`Bun.$`, `Bun.file`, `node:fs` compat layer), `fflate` (zip archive assembly — pre-declared by foundation in cycle 6.1 per Ruling #2, 2026-05-24; do NOT `bun add`).

---

## Pre-declaration invariant

Foundation cycle 6.1 pre-declares every v1 npm dependency; no downstream plan runs `bun add` or edits `package.json` / `bun.lock`. The zip assembly step (§14.1 step 7) uses **`fflate`** — added to foundation's §6.1 dep manifest by Ruling #2 (2026-05-24). Import as `import { zipSync } from "fflate"`. `zipSync` takes a `Record<string, Uint8Array>` (relative path → bytes) and returns a `Uint8Array` — exactly the shape step 7 needs.

---

## Release gate (not a cycle 6.13 blocker)

Chore `license-audit-vendored-pdf-server` (chores.xml) must close before the `.plugin` archive is distributed to users. Cycle 6.13 may land in source and pass `bun test` independently. The audit confirms `@modelcontextprotocol/server-pdf@1.7.2`'s upstream license permits vendoring and redistribution under scholar's MIT license. Until the chore is closed, the produced `scholar.plugin` must not be shared beyond the local development machine.

---

## Decisions deferred to cycle 6.13 by the spec

The following open choices in §14.1 are resolved here. Implementers must not relitigate them.

| Deferred decision | Resolution |
|---|---|
| Extension-less `build/scholar` sibling (§14.1 step 1) | **File copy** (`copyFileSync("build/scholar.exe", "build/scholar")`). Simplest mechanism, no Windows-specific `.bat` shim, no hardlink race. |
| Steps 4↔5 Bun version invariant | Script reads `package.json` → `scholar.bundledBunVersion` and `scholar.bunSqliteVersion`; if they differ it aborts with exit code 1 and prints `SCHOLAR_BUILD_MISMATCH: bundledBunVersion (<v>) ≠ bunSqliteVersion (<v>)` to stderr. Both fields are written by foundation in cycle 6.1. |
| Step 5 `vec0` fallback (§14.1 step 5) | **ABI probe then compile fallback (user ruling 2026-05-24, option a).** Script tries to load the prebuilt `vec0.<ext>` via `db.loadExtension()` against Bun's `bun:sqlite` engine. If the probe succeeds, copy prebuilt. If the probe fails (ABI mismatch) or prebuilt is absent, compile `vec0.c` from vendored source against the vendored `sqlite3.h` (headers must match the Bun release's bundled SQLite — foundation's responsibility to vendor them alongside `vec0.c`). Cache the compiled artifact at `runtime/vendor/sqlite-vec/vec0.<ext>` to avoid recompile on subsequent builds. If no C compiler (`CC` env var or `cc`/`gcc`/`clang` on PATH) is found, abort with `SCHOLAR_BUILD_NO_C_TOOLCHAIN`. §16 spec stands as written; C toolchain is a build-environment requirement, not a runtime user dep. |
| Step 7 dual output path | Primary: `%USERPROFILE%\Documents\Cowork\System\scholar.plugin` (Windows) / `~/Documents/Cowork/System/scholar.plugin` (POSIX fallback). Secondary: best-effort copy to Cowork plugin-import staging dir (read from `COWORK_PLUGINS_DIR` env if set). Both paths printed to stdout after successful zip. |

---

## What this plan consumes (not produces)

`scripts/build-plugin.ts` is a *terminal consumer* of every other plan's compiled output. It does not import any source module directly; it invokes `bun run` scripts (which drive `tsc` + `bun build`) and copies files. The upstream artifacts it expects to exist:

| Artifact | Produced by | Expected path (pre-zip) |
|---|---|---|
| Server binary (compiled) | foundation — cycle 6.1, filled out by corpus/ingest/extraction/annotations | `build/scholar.exe` (and `build/scholar` extension-less sibling created by step 1) |
| UI bundle | frontends — cycle 6.9 | `build/ui/app.html` |
| Vendored pdf dist | foundation — cycle 6.2 | `src/vendor/pdf-server/` (source; step 3 copies recursively to `build/vendor/pdf-server/`) |
| Bundled Bun runtime | (Bun install on build host) | `build/runtime/bun.exe` (Windows) / `build/runtime/bun` (POSIX) |
| vec0 shared library | (prebuilt, pinned by foundation) | `build/vendor/sqlite-vec/vec0.dll` (Windows) / `build/vendor/sqlite-vec/vec0.so` (Linux) |
| nu module | frontends — cycle 6.10 | `nu/scholar.nu` |
| Slash commands | frontends — cycle 6.10 | `commands/` (recursive: `ingest.md`, `digest.md`, `status.md`) |
| Skills | frontends — cycle 6.10 | `skills/` (recursive: `scholar-workflow/SKILL.md`, `scholar-ingest/SKILL.md`) |
| sqlite-vec source (build-time only) | chore `vendor-sqlite-vec-source` (lead-filed 2026-05-24, `blocks-plans="packaging"`) | `src/vendor/sqlite-vec/vec0.c` + `src/vendor/sqlite-vec/sqlite3.h` — vendored by the chore; used only if prebuilt ABI probe fails; NOT packed into the archive |
| Plugin manifest | foundation — cycle 6.1 | `.claude-plugin/plugin.json` |
| MCP server config | foundation — cycle 6.1 | `.mcp.json` |

**sqlite3-mcp is NOT packed.** Scholar reimplements the §10 query/backup/inspect surface in-process via `bun:sqlite` per user posture-B ruling (2026-05-24). There is no Python sqlite3-mcp child binary to vendor or ship; its intentional absence from the manifest above is not an oversight.

If `bun run build:server` (step 1) fails because a tool module stub is still a no-op, the failure is upstream — not a packaging bug. Report to the relevant sibling plan owner.

---

## Out of scope (handed to sibling plans)

| Sibling suffix | Cycles owned | Scope boundary |
|---|---|---|
| `foundation` | 6.1, 6.2 | Project scaffolding: `package.json`, `tsconfig.json`, `drizzle.config.ts`, plugin manifest (`.claude-plugin/plugin.json`), `.mcp.json`, server entry (`src/server/index.ts`), Drizzle schema/migrations/sqlite-vec loader, vendored pdf-server dist under `src/vendor/pdf-server/`, pdf lifecycle roots responder (`src/server/pdf/lifecycle.ts`), no-op stub scaffolding for all nine tool modules + `raw-ddl.ts`. Pre-declaration of the complete v1 npm dep set. |
| `corpus` | 6.3, 6.11, 6.12 | Corpus and roots tools (`corpus.ts`, `roots.ts`, `snapshot.ts`), first-run PDF-root wizard (`scripts/first-run.ts`), sqlite3-mcp `register_db` integration, `scholar.dashboard` view-opener. **The first-run wizard is entirely corpus-owned — packaging does not touch `scripts/first-run.ts`.** |
| `ingest` | 6.4 | Ingestion adapters and tools: `@retorquere/bibtex-parser` BibTeX adapter, in-house RIS adapter (`src/server/ingest/bibtex.ts`), CrossRef DOI, arXiv, manual entry; `src/server/tools/ingest.ts`. |
| `extraction` | 6.5, 6.6, 6.8 | Text extraction, chunker, Ollama embeddings, `chunk_vec` + `reading_queue` raw DDL (`src/server/db/raw-ddl.ts`), hybrid search, reading queue, digest and reading-prompts generation; `src/server/ollama/`, `src/server/tools/{pdf,papers,digest,prompts}.ts`. |
| `annotations` | 6.7 | Annotation CRUD with bidirectional pdf-child reconciliation; `src/server/tools/annotations.ts`. §13 phase discipline (reads → MCP I/O → transaction with no awaits) is load-bearing. |
| `frontends` | 6.9, 6.10 | Five-view MCP App UI bundle (`src/ui/`, built via Bun's HTML bundler), nu module (`nu/scholar.nu`), slash commands (`commands/`), skills (`skills/`), `src/server/ui/resource.ts`. Cycle 6.9 emits the per-dep KB measurement that gates §14.1 bundle-budget remediations. |

---

## Cycle 6.13 — Plugin build

### Overview

`scripts/build-plugin.ts` orchestrates the seven §14.1 build steps verbatim, in order. The TDD sequence is:

- **Red** — integration test that runs the script in fixture mode and validates the resulting archive.
- **Green** — implement the script so tests pass.
- **Refactor (optional)** — extract step helpers if the script body exceeds ~150 lines.

---

### Task 1 (Red): Write the failing integration test

**Files:**
- Create: `scripts/build-plugin.test.ts`

The test runs `build-plugin.ts` with `BUILD_FIXTURE=1` (skips real compilation; proceeds directly to assembly + zip). It then inspects the resulting archive.

- [ ] **Step 1.1: Create the test file**

```typescript
// scripts/build-plugin.test.ts
import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync } from "fflate"; // pre-declared by foundation; no CLI dependency

// Fixture root — a temp dir acting as the repo root for the test run
const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), "scholar-build-test-"));
const OUTPUT_DIR   = join(FIXTURE_ROOT, "dist");
const isWin        = process.platform === "win32";

// Paths the build script expects to find (fixture stubs).
// BOTH platform variants for runtime and vec0 are staged so the test suite
// passes on any dev host (Linux/WSL or Windows). step7_assemblePlugin picks
// the platform-appropriate variant at archive assembly time.
// build/scholar (extension-less sibling) is intentionally absent — step1
// creates it from build/scholar.exe even in fixture mode (M1 coverage).
const FIXTURE_FILES: [string, string][] = [
  ["build/scholar.exe",                         '{"stub":"server-binary"}'],
  ["build/ui/app.html",                         "<!DOCTYPE html><html><body>stub</body></html>"],
  ["build/vendor/pdf-server/dist/index.js",     "// stub pdf server"],
  // Both vec0 platform variants (step5 copies from src/ to build/)
  ["src/vendor/sqlite-vec/vec0.dll",            "stub-dll-win"],
  ["build/vendor/sqlite-vec/vec0.dll",          "stub-dll-win"],
  ["src/vendor/sqlite-vec/vec0.so",             "stub-so-linux"],
  ["build/vendor/sqlite-vec/vec0.so",           "stub-so-linux"],
  // sqlite-vec source for compile fallback (build-time only; NOT archived)
  ["src/vendor/sqlite-vec/vec0.c",              "/* stub vec0 source */"],
  ["src/vendor/sqlite-vec/sqlite3.h",           "/* stub sqlite3 header */"],
  // Both Bun runtime platform variants
  ["build/runtime/bun.exe",                     "stub-runtime-win"],
  ["build/runtime/bun",                         "stub-runtime-posix"],
  ["nu/scholar.nu",                             "# stub nu module"],
  // Slash commands — frontends cycle 6.10
  ["commands/ingest.md",                        "# stub ingest command"],
  ["commands/digest.md",                        "# stub digest command"],
  ["commands/status.md",                        "# stub status command"],
  // Skills — frontends cycle 6.10
  ["skills/scholar-workflow/SKILL.md",          "# stub scholar-workflow skill"],
  ["skills/scholar-ingest/SKILL.md",            "# stub scholar-ingest skill"],
  [".claude-plugin/plugin.json", JSON.stringify({
    name: "scholar", version: "0.1.0",
    description: "stub", author: { name: "zayn" },
    keywords: [], license: "MIT"
  })],
  [".mcp.json", JSON.stringify({
    mcpServers: { scholar: { command: "./build/scholar", args: [], env: {} } }
  })],
];

// package.json with matching bundledBunVersion / bunSqliteVersion
const PKG_JSON = {
  name: "scholar",
  version: "0.1.0",
  scripts: {
    "build:server": "echo skip-in-fixture",
    "build:ui":     "echo skip-in-fixture",
    "build:pdf":    "echo skip-in-fixture",
    "build:runtime":"echo skip-in-fixture",
    "build:vec":    "echo skip-in-fixture",
    "build:nu":     "echo skip-in-fixture",
    "build:plugin": "echo skip-in-fixture",
  },
  scholar: {
    bundledBunVersion: "1.2.3",
    bunSqliteVersion:  "1.2.3",
  },
  dependencies: {},
  devDependencies: {},
};

beforeAll(() => {
  for (const [relPath, content] of FIXTURE_FILES) {
    const abs = join(FIXTURE_ROOT, relPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  mkdirSync(join(FIXTURE_ROOT, "scripts"), { recursive: true });
  writeFileSync(join(FIXTURE_ROOT, "package.json"), JSON.stringify(PKG_JSON, null, 2));
  mkdirSync(OUTPUT_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

// Helper: spawn the build script with fixture env, collect exit code + stderr.
async function runBuildScript(buildRoot: string, pluginOut: string, extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", resolve("scripts/build-plugin.ts")], {
    env: {
      ...process.env,
      BUILD_FIXTURE: "1",
      SCHOLAR_BUILD_ROOT: buildRoot,
      SCHOLAR_PLUGIN_OUT: pluginOut,
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
    cwd: process.cwd(),
  });
  const exitCode = await proc.exited;
  const stderr   = await new Response(proc.stderr).text();
  return { exitCode, stderr };
}

// Helper: read archive with fflate — platform-independent, no unzip CLI needed.
function readArchive(archivePath: string): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(readFileSync(archivePath)));
}

test("build-plugin produces a .plugin archive with the required layout", async () => {
  const { exitCode, stderr } = await runBuildScript(FIXTURE_ROOT, OUTPUT_DIR);
  expect(exitCode, `build script exited non-zero:\n${stderr}`).toBe(0);

  const archivePath = join(OUTPUT_DIR, "scholar.plugin");
  expect(existsSync(archivePath)).toBe(true);

  const entries    = readArchive(archivePath);
  const entryNames = Object.keys(entries);

  // Platform-specific variants — step7 picks based on process.platform
  const runtimeEntry = isWin ? "build/runtime/bun.exe" : "build/runtime/bun";
  const vec0Entry    = isWin ? "build/vendor/sqlite-vec/vec0.dll"
                             : "build/vendor/sqlite-vec/vec0.so";

  const requiredEntries = [
    ".claude-plugin/plugin.json",
    ".mcp.json",
    "build/scholar.exe",
    "build/scholar",                              // extension-less sibling (step1)
    "build/ui/app.html",
    "build/vendor/pdf-server/dist/index.js",
    runtimeEntry,
    vec0Entry,
    "nu/scholar.nu",
    // Slash commands (frontends cycle 6.10) — packed recursively via collectDir
    "commands/ingest.md",
    "commands/digest.md",
    "commands/status.md",
    // Skills (frontends cycle 6.10)
    "skills/scholar-workflow/SKILL.md",
    "skills/scholar-ingest/SKILL.md",
  ];

  for (const entry of requiredEntries) {
    expect(entryNames, `Missing archive entry: ${entry}`).toContain(entry);
  }

  // Posture-B preservation guard: sqlite3-mcp must NOT appear in the archive.
  // Scholar reimplements §10 query/backup/inspect in-process via bun:sqlite per
  // user posture-B ruling 2026-05-24; no Python binary is vendored or shipped.
  for (const name of entryNames) {
    expect(name, `sqlite3-mcp artifact found in archive (posture-B violation): ${name}`)
      .not.toMatch(/sqlite3.mcp|server-sqlite3/);
  }
});

test("archive plugin.json is valid JSON matching the scholar manifest schema", async () => {
  const archivePath = join(OUTPUT_DIR, "scholar.plugin");
  const entries = readArchive(archivePath);
  const raw     = new TextDecoder().decode(entries[".claude-plugin/plugin.json"]);
  const parsed  = JSON.parse(raw); // throws if invalid JSON

  expect(parsed.name).toBe("scholar");
  expect(typeof parsed.version).toBe("string");
  expect(parsed.license).toBe("MIT");
});

test("archive .mcp.json is valid JSON and command path is present in archive", async () => {
  const archivePath = join(OUTPUT_DIR, "scholar.plugin");
  const entries  = readArchive(archivePath);
  const raw      = new TextDecoder().decode(entries[".mcp.json"]);
  const parsed   = JSON.parse(raw);

  const serverEntry = Object.values(
    parsed.mcpServers as Record<string, { command: string }>
  )[0];
  expect(serverEntry).toBeDefined();

  // Strip leading ./ and verify the command binary is present in the archive
  const commandRel = serverEntry.command.replace(/^\.\//, "");
  expect(Object.keys(entries), `command path '${commandRel}' not found in archive`)
    .toContain(commandRel);
});

test("step1_buildServer creates extension-less build/scholar sibling (sibling-copy branch coverage)", async () => {
  // Exercises the copyFileSync branch that has zero coverage under the full
  // fixture-mode integration test (which pre-stages build/scholar). Here we
  // deliberately provide only build/scholar.exe and assert step1 produces the sibling.
  const tmpDir = mkdtempSync(join(tmpdir(), "scholar-step1-"));
  try {
    mkdirSync(join(tmpDir, "build"), { recursive: true });
    writeFileSync(join(tmpDir, "build/scholar.exe"), "stub-binary-content");

    // step1_buildServer is exported and accepts (buildRoot, fixture) explicitly
    // so it can be called in isolation without module-level env var coupling.
    const { step1_buildServer } = await import("./build-plugin.ts") as {
      step1_buildServer: (buildRoot: string, fixture: boolean) => Promise<void>;
    };
    await step1_buildServer(tmpDir, /* fixture= */ true); // skips shell-out; runs copy

    const siblingPath = join(tmpDir, "build/scholar");
    expect(existsSync(siblingPath), "extension-less sibling not created by step1").toBe(true);
    expect(readFileSync(siblingPath, "utf8")).toBe("stub-binary-content");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("build-plugin aborts with SCHOLAR_BUILD_MISMATCH when bundledBunVersion ≠ bunSqliteVersion", async () => {
  const mismatchRoot = mkdtempSync(join(tmpdir(), "scholar-build-mismatch-"));
  try {
    for (const [relPath, content] of FIXTURE_FILES) {
      const abs = join(mismatchRoot, relPath);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
    const mismatchPkg = {
      ...PKG_JSON,
      scholar: { bundledBunVersion: "1.2.3", bunSqliteVersion: "1.2.4" }, // mismatch
    };
    writeFileSync(join(mismatchRoot, "package.json"), JSON.stringify(mismatchPkg, null, 2));
    mkdirSync(join(mismatchRoot, "dist"), { recursive: true });

    const { exitCode, stderr } = await runBuildScript(mismatchRoot, join(mismatchRoot, "dist"));
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("SCHOLAR_BUILD_MISMATCH");
  } finally {
    rmSync(mismatchRoot, { recursive: true, force: true });
  }
});

test("build-plugin aborts with SCHOLAR_BUILD_VEC_MISSING when vec0 prebuilt is absent", async () => {
  const noVecRoot = mkdtempSync(join(tmpdir(), "scholar-build-novec-"));
  try {
    for (const [relPath, content] of FIXTURE_FILES) {
      // Omit all src/vendor/sqlite-vec/ entries (both .dll and .so) — the script
      // must detect the platform-appropriate prebuilt is absent and abort.
      if (relPath.startsWith("src/vendor/sqlite-vec/")) continue;
      const abs = join(noVecRoot, relPath);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
    writeFileSync(join(noVecRoot, "package.json"), JSON.stringify(PKG_JSON, null, 2));
    mkdirSync(join(noVecRoot, "dist"), { recursive: true });

    const { exitCode, stderr } = await runBuildScript(noVecRoot, join(noVecRoot, "dist"));
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("SCHOLAR_BUILD_VEC_MISSING");
  } finally {
    rmSync(noVecRoot, { recursive: true, force: true });
  }
});

// ── Compile-fallback tests (I2 ruling) ───────────────────────────────────────
// SCHOLAR_BUILD_VEC_FORCE_COMPILE=1 bypasses the ABI probe and jumps directly
// to compileVec0FromSource, enabling fixture-mode testing of the compile path
// without requiring a real ABI-mismatched binary.

test("probeVec0Abi returns false for a file that is not a valid SQLite extension", async () => {
  // Unit test for the ABI probe helper. probeVec0Abi must be exported.
  const { probeVec0Abi } = await import("./build-plugin.ts") as {
    probeVec0Abi: (extPath: string) => boolean;
  };
  const stubPath = join(FIXTURE_ROOT, "src/vendor/sqlite-vec/vec0.dll");
  // The fixture stub contains plain text ("stub-dll-win"), not a real extension.
  // loadExtension must throw, and probeVec0Abi must return false.
  const result = probeVec0Abi(stubPath);
  expect(result).toBe(false);
});

test("compile fallback produces vec0 artifact when SCHOLAR_BUILD_VEC_FORCE_COMPILE=1", async () => {
  // Verify that compileVec0FromSource is invoked when SCHOLAR_BUILD_VEC_FORCE_COMPILE=1,
  // and that the compiled artifact ends up at build/vendor/sqlite-vec/<libname>.
  //
  // The stub CC script writes dummy bytes to the output path (the -o argument).
  // This validates the compile path mechanics without requiring a real C toolchain.
  const compileRoot = mkdtempSync(join(tmpdir(), "scholar-compile-"));
  try {
    for (const [relPath, content] of FIXTURE_FILES) {
      const abs = join(compileRoot, relPath);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
    writeFileSync(join(compileRoot, "package.json"), JSON.stringify(PKG_JSON, null, 2));
    mkdirSync(join(compileRoot, "dist"), { recursive: true });

    // Cross-platform stub CC: a small Bun script that parses -o <path> from
    // argv and writes stub bytes there. The build script invokes: CC <flags> -o <path>
    const ccStubPath = join(compileRoot, "stub-cc.ts");
    writeFileSync(ccStubPath, `
const args = process.argv.slice(2);
const oIdx = args.indexOf("-o");
if (oIdx !== -1 && args[oIdx + 1]) {
  await Bun.write(args[oIdx + 1], "stub-compiled-vec0");
} else {
  // MSVC /Fe:<path> convention
  const feArg = args.find(a => a.startsWith("/Fe:"));
  if (feArg) await Bun.write(feArg.slice(4), "stub-compiled-vec0");
}
`, "utf8");

    const { exitCode, stderr } = await runBuildScript(
      compileRoot,
      join(compileRoot, "dist"),
      {
        SCHOLAR_BUILD_VEC_FORCE_COMPILE: "1",
        CC: `bun ${ccStubPath}`,
      }
    );

    expect(exitCode, `compile-fallback path exited non-zero:\n${stderr}`).toBe(0);

    // Compiled artifact should exist at build/vendor/sqlite-vec/<libname>
    const libName = isWin ? "vec0.dll" : "vec0.so";
    const compiledPath = join(compileRoot, "build/vendor/sqlite-vec", libName);
    expect(existsSync(compiledPath), `compiled vec0 not found at ${compiledPath}`).toBe(true);
  } finally {
    rmSync(compileRoot, { recursive: true, force: true });
  }
});

test("build-plugin aborts with SCHOLAR_BUILD_NO_C_TOOLCHAIN when no compiler is available", async () => {
  const noCcRoot = mkdtempSync(join(tmpdir(), "scholar-no-cc-"));
  try {
    for (const [relPath, content] of FIXTURE_FILES) {
      const abs = join(noCcRoot, relPath);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
    writeFileSync(join(noCcRoot, "package.json"), JSON.stringify(PKG_JSON, null, 2));
    mkdirSync(join(noCcRoot, "dist"), { recursive: true });

    // CC set to a non-existent binary and PATH cleared of known compilers
    const { exitCode, stderr } = await runBuildScript(
      noCcRoot,
      join(noCcRoot, "dist"),
      {
        SCHOLAR_BUILD_VEC_FORCE_COMPILE: "1",
        CC: "nonexistent-compiler-that-does-not-exist",
        // Override PATH to prevent fallback to system cc/gcc/clang
        PATH: join(noCcRoot, "empty-bin"),
      }
    );

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("SCHOLAR_BUILD_NO_C_TOOLCHAIN");
  } finally {
    rmSync(noCcRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 1.2: Run the test — confirm it fails**

```bash
bun test scripts/build-plugin.test.ts
```

Expected: all tests FAIL with `Cannot find module` or `ENOENT` for `scripts/build-plugin.ts`. If any test passes unexpectedly, re-read the test logic before proceeding.

- [ ] **Step 1.3: Commit the failing test (Red commit)**

```bash
git add scripts/build-plugin.test.ts
git commit -m "test(packaging): red — build-plugin fixture + archive layout + error contract tests"
```

---

### Task 2 (Green): Implement `scripts/build-plugin.ts`

**Files:**
- Create: `scripts/build-plugin.ts`

The script orchestrates the seven §14.1 build steps verbatim. Each step is a labelled function. Steps are skipped in `BUILD_FIXTURE=1` mode except for the assembly + zip (step 7), version assertion (pre-flight), and vec0 presence check (step 5).

> **The seven §14.1 build steps (quoted from spec §14.1, implementer reference):**
>
> 1. `bun run build:server` — `tsc` typecheck + `bun build src/server/index.ts --compile --target=bun-windows-x64 --outfile build/scholar.exe`. Also writes an extension-less sibling at `build/scholar` so the literal path in `.mcp.json` resolves without a runtime extension-search.
> 2. `bun run build:ui` — `bun build src/ui/index.html --target=browser --outfile build/ui/app.html`. Target: ≤ 4.5 MB to stay 90% under the 5 MB iframe-resource cap. Bundle-budget gate is resolved upstream by cycle 6.9 (frontends).
> 3. `bun run build:pdf` — copies the unmodified vendored upstream pdf dist from `src/vendor/pdf-server/` to `build/vendor/pdf-server/`. No transpilation or patch step.
> 4. `bun run build:runtime` — copies the Bun runtime binary (`bun.exe` on Windows, `bun` on POSIX) from the build host's Bun install to `build/runtime/`. The runtime version pinned at build time is recorded in `package.json`'s `scholar.bundledBunVersion` field and must match `scholar.bunSqliteVersion` from step 5 (both read from the same Bun release).
> 5. `bun run build:vec` — produces the `vec0` shared library at `build/vendor/sqlite-vec/`. Default path: ABI-probe the prebuilt `vec0.<ext>` (load via `bun:sqlite` `db.loadExtension()` against an in-memory DB); if the probe passes, copy the prebuilt. If the probe fails (ABI mismatch) or the prebuilt is absent, compile `vec0.c` from vendored source against the vendored `sqlite3.h` header using the host's C toolchain (`CC` env var → `cc`/`gcc`/`clang` on POSIX, `cl` on Windows). Cache the compiled artifact at `runtime/vendor/sqlite-vec/vec0.<ext>` to skip recompile. Abort with `SCHOLAR_BUILD_NO_C_TOOLCHAIN` if no compiler is found. The C toolchain is a build-environment requirement (not a runtime user dep); document in README "Building from source" section.
> 6. `bun run build:nu` — copies `nu/scholar.nu` into the bundle.
> 7. `bun run build:plugin` — assembles a tree at `build/plugin/` matching the installable layout, then zips it as `scholar.plugin` in `%USERPROFILE%\Documents\Cowork\System\` (Windows) / `~/Documents/Cowork/System/` (POSIX fallback), and a best-effort second copy to `COWORK_PLUGINS_DIR` if that env var is set. Both output paths are printed to stdout.

- [ ] **Step 2.1: Implement `scripts/build-plugin.ts`**

`fflate` is the confirmed zip library (Ruling #2, 2026-05-24). It is pre-declared in `package.json` by foundation — do not `bun add`.

```typescript
// scripts/build-plugin.ts
//
// Build orchestrator for scholar.plugin — §14.1 seven-step build pipeline.
// Run: bun scripts/build-plugin.ts
// Fixture mode: BUILD_FIXTURE=1 bun scripts/build-plugin.ts
//   Skips compilation steps (1, 2, 3, 4, 6); validates pre-assembly
//   invariants (version match, vec0 presence) then runs assembly + zip.
//   SCHOLAR_BUILD_ROOT overrides the repo root (for tests).
//   SCHOLAR_PLUGIN_OUT overrides the output directory (for tests).

import { zipSync } from "fflate";
import { Database } from "bun:sqlite";
import { existsSync, copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { $ } from "bun";

// ── Environment ──────────────────────────────────────────────────────────────

const FIXTURE       = process.env.BUILD_FIXTURE === "1";
const FORCE_COMPILE = process.env.SCHOLAR_BUILD_VEC_FORCE_COMPILE === "1";
const BUILD_ROOT    = process.env.SCHOLAR_BUILD_ROOT ?? resolve(".");
const PLUGIN_OUT    = process.env.SCHOLAR_PLUGIN_OUT ?? null; // null → use Cowork path

// ── Helpers ───────────────────────────────────────────────────────────────────

function rel(...parts: string[]): string {
  return join(BUILD_ROOT, ...parts);
}

function abort(code: string, msg: string): never {
  process.stderr.write(`${code}: ${msg}\n`);
  process.exit(1);
}

// ── vec0 ABI probe ────────────────────────────────────────────────────────────
// Exported for unit testing. Returns true if extPath loads cleanly into an
// in-memory bun:sqlite DB (ABI matches Bun's bundled SQLite). Returns false
// on any error (ABI mismatch, corrupt file, missing symbols, etc.).

export function probeVec0Abi(extPath: string): boolean {
  try {
    const db = new Database(":memory:");
    db.loadExtension(extPath);
    db.close();
    return true;
  } catch {
    return false;
  }
}

// ── vec0 compile-from-source fallback ────────────────────────────────────────
// Compiles vec0.c from vendored source against the vendored sqlite3.h header.
// Caches the result at runtime/vendor/sqlite-vec/<libname> to skip recompile.
// Aborts with SCHOLAR_BUILD_NO_C_TOOLCHAIN if no C compiler is found.
//
// C compiler resolution order: CC env var → cc → gcc → clang (POSIX);
// CC env var → cl (Windows). The toolchain is a build-environment requirement,
// not a runtime user dep; document in README "Building from source".

async function compileVec0FromSource(destPath: string): Promise<void> {
  const isWin     = process.platform === "win32";
  const vecSrcDir = rel("src/vendor/sqlite-vec");
  const vec0Src   = join(vecSrcDir, "vec0.c");
  const sqliteH   = join(vecSrcDir, "sqlite3.h");

  if (!existsSync(vec0Src) || !existsSync(sqliteH)) {
    abort(
      "SCHOLAR_BUILD_VEC_SOURCE_MISSING",
      `Vendored sqlite-vec source not found at ${vecSrcDir}. ` +
      "Foundation cycle 6.1 must vendor vec0.c + sqlite3.h alongside the prebuilt. " +
      "See the 'sqlite-vec source' row in the packaging plan's 'What this plan consumes' table."
    );
  }

  // Stable cache location — avoids recompile on subsequent builds
  const cacheDir  = rel("runtime/vendor/sqlite-vec");
  const libName   = basename(destPath);
  const cachedLib = join(cacheDir, libName);
  if (existsSync(cachedLib)) {
    console.log(`Using cached compiled vec0 from ${cachedLib}`);
    copyFileSync(cachedLib, destPath);
    return;
  }

  // Resolve C compiler
  const cc = process.env.CC
    ?? (isWin ? null : await $`which cc`.text().catch(() => "").then(s => s.trim() || null))
    ?? await $`which gcc`.text().catch(() => "").then(s => s.trim() || null)
    ?? await $`which clang`.text().catch(() => "").then(s => s.trim() || null)
    ?? (isWin ? "cl" : null);

  if (!cc) {
    abort(
      "SCHOLAR_BUILD_NO_C_TOOLCHAIN",
      "vec0 prebuilt is ABI-mismatched or absent, and no C compiler " +
      "(cc, gcc, clang, or CC env var) is available. " +
      "Install a C toolchain or provide a matching prebuilt. " +
      "See docs/building-from-source.md for setup instructions."
    );
  }

  console.log(`Compiling vec0 from source using ${cc}...`);
  if (isWin) {
    // MSVC: cl /LD /I<headers> <source> /Fe:<output>
    await $`${cc} /LD /I${vecSrcDir} ${vec0Src} /Fe:${destPath}`.cwd(BUILD_ROOT);
  } else {
    await $`${cc} -shared -fPIC -I${vecSrcDir} ${vec0Src} -o ${destPath}`.cwd(BUILD_ROOT);
  }

  // Cache compiled artifact
  mkdirSync(cacheDir, { recursive: true });
  copyFileSync(destPath, cachedLib);
  console.log(`Compiled vec0 cached at ${cachedLib}`);
}

// ── Pre-flight: version invariant (steps 4 ↔ 5) ─────────────────────────────

function assertVersionInvariant(): void {
  const pkgRaw = readFileSync(rel("package.json"), "utf8");
  const pkg = JSON.parse(pkgRaw) as {
    scholar?: { bundledBunVersion?: string; bunSqliteVersion?: string }
  };
  const bv = pkg.scholar?.bundledBunVersion;
  const sv = pkg.scholar?.bunSqliteVersion;
  if (!bv || !sv) {
    abort("SCHOLAR_BUILD_MISMATCH", "package.json is missing scholar.bundledBunVersion or scholar.bunSqliteVersion — foundation cycle 6.1 must set these fields.");
  }
  if (bv !== sv) {
    abort("SCHOLAR_BUILD_MISMATCH", `bundledBunVersion (${bv}) ≠ bunSqliteVersion (${sv}). Both must be set from the same Bun release.`);
  }
}

// ── Step 1: Build server binary ───────────────────────────────────────────────
// bun run build:server → tsc typecheck + bun build --compile src/server/index.ts
// Also writes extension-less build/scholar sibling (resolved: copy, not shim).
//
// Exported and parameterised so the sibling-copy branch can be unit-tested in
// isolation (M1). fixture=true skips the shell-out but still performs the copy.

export async function step1_buildServer(buildRoot: string, fixture: boolean): Promise<void> {
  if (!fixture) {
    await $`bun run build:server`.cwd(buildRoot);
  }
  // Extension-less sibling — runs in BOTH production and fixture mode.
  // .mcp.json command is "./build/scholar" (no extension); Windows hosts need
  // the sibling for runtime extension-search resolution (§14.1 step 1).
  const exePath = join(buildRoot, "build/scholar.exe");
  const sibPath = join(buildRoot, "build/scholar");
  if (existsSync(exePath)) {
    copyFileSync(exePath, sibPath);
  }
}

// ── Step 2: Build UI bundle ───────────────────────────────────────────────────
// bun build src/ui/index.html --target=browser --outfile build/ui/app.html
// Target ≤ 4.5 MB (bundle-budget gate resolved upstream by frontends cycle 6.9).

async function step2_buildUI(): Promise<void> {
  if (FIXTURE) return;
  mkdirSync(rel("build/ui"), { recursive: true });
  await $`bun run build:ui`.cwd(BUILD_ROOT);
}

// ── Step 3: Copy vendored pdf dist ────────────────────────────────────────────
// Copies src/vendor/pdf-server/ → build/vendor/pdf-server/.
// No transpilation, no patch step (vendor is unmodified per §7.2).

async function step3_copyPdf(): Promise<void> {
  if (FIXTURE) return;
  const src  = rel("src/vendor/pdf-server");
  const dest = rel("build/vendor/pdf-server");
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

// ── Step 4: Copy Bun runtime ──────────────────────────────────────────────────
// Copies bun(.exe) from the build host's Bun install to build/runtime/.
// Required because the compiled scholar binary cannot re-exec arbitrary scripts
// under its embedded runtime (§7.2). The bundled runtime is the pdf-child spawn target.
// Records the version in package.json scholar.bundledBunVersion (done at cycle 6.1 build time).

async function step4_copyRuntime(): Promise<void> {
  if (FIXTURE) return;
  const isWin   = process.platform === "win32";
  const bunName = isWin ? "bun.exe" : "bun";
  // Resolve bun binary from PATH
  const which   = await $`which bun`.text().catch(() => null)
               ?? await $`where bun`.text().catch(() => null);
  if (!which?.trim()) {
    abort("SCHOLAR_BUILD_RUNTIME_MISSING", "Cannot locate bun binary on PATH. Ensure bun is installed on the build host.");
  }
  const bunSrc  = which.trim().split("\n")[0].trim();
  const destDir = rel("build/runtime");
  mkdirSync(destDir, { recursive: true });
  copyFileSync(bunSrc, join(destDir, bunName));
}

// ── Step 5: vec0 shared library — ABI probe then compile fallback ─────────────
// Production: probeVec0Abi on the prebuilt; if ABI matches, copy it; otherwise
//   (or if absent) fall back to compileVec0FromSource (§14.1 step 5 / §16).
// Fixture (no FORCE_COMPILE): skip ABI probe (stubs aren't real extensions);
//   copy stub prebuilt directly. Abort if stub is absent (tests a gap in FIXTURE_FILES).
// Fixture + FORCE_COMPILE: skip prebuilt; exercise compile path with a stub CC.

async function step5_copyVec(): Promise<void> {
  const isWin    = process.platform === "win32";
  const libName  = isWin ? "vec0.dll" : process.platform === "darwin" ? "vec0.dylib" : "vec0.so";
  const prebuilt = rel(`src/vendor/sqlite-vec/${libName}`);
  const destDir  = rel("build/vendor/sqlite-vec");
  mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, libName);

  if (FIXTURE && !FORCE_COMPILE) {
    // Fixture: skip ABI probe; just assert prebuilt stub is staged and copy it.
    if (!existsSync(prebuilt)) {
      abort(
        "SCHOLAR_BUILD_VEC_MISSING",
        `Prebuilt ${libName} not found at ${prebuilt} [fixture mode]. ` +
        "Ensure FIXTURE_FILES stages both vec0.dll and vec0.so."
      );
    }
    copyFileSync(prebuilt, destPath);
    return;
  }

  // Production or FORCE_COMPILE: ABI probe → use prebuilt or compile fallback
  const usePrebuilt = !FORCE_COMPILE && existsSync(prebuilt) && probeVec0Abi(prebuilt);
  if (usePrebuilt) {
    copyFileSync(prebuilt, destPath);
    return;
  }

  if (!FORCE_COMPILE) {
    const reason = !existsSync(prebuilt)
      ? `prebuilt ${libName} not found`
      : "prebuilt ABI probe failed (SQLite version mismatch between vec0 and Bun's bundled engine)";
    console.warn(`vec0 ${reason} — falling back to compile-from-source`);
  }

  await compileVec0FromSource(destPath);
}

// ── Step 6: Copy nu module ────────────────────────────────────────────────────

async function step6_copyNu(): Promise<void> {
  if (FIXTURE) return;
  const src  = rel("nu/scholar.nu");
  const dest = rel("build/nu/scholar.nu");
  mkdirSync(rel("build/nu"), { recursive: true });
  copyFileSync(src, dest);
}

// ── Step 7: Assemble plugin tree + zip ────────────────────────────────────────
// Assembles build/plugin/ staging tree then produces scholar.plugin.
// Uses fflate (Ruling #2, 2026-05-24) — imported at top of file.

async function step7_assemblePlugin(): Promise<void> {
  const stagingDir = rel("build/plugin");
  mkdirSync(stagingDir, { recursive: true });

  // Files to include in the archive, expressed as [src-abs-path, archive-relative-path]
  const isWin = process.platform === "win32";
  const manifest: [string, string][] = [
    [rel(".claude-plugin/plugin.json"),              ".claude-plugin/plugin.json"],
    [rel(".mcp.json"),                               ".mcp.json"],
    [rel("build/scholar.exe"),                       "build/scholar.exe"],
    [rel("build/scholar"),                           "build/scholar"],   // extension-less sibling
    [rel("build/ui/app.html"),                       "build/ui/app.html"],
    [rel("build/runtime/" + (isWin ? "bun.exe" : "bun")),
                                                     "build/runtime/" + (isWin ? "bun.exe" : "bun")],
    [rel("build/vendor/sqlite-vec/" + (isWin ? "vec0.dll" : "vec0.so")),
                                                     "build/vendor/sqlite-vec/" + (isWin ? "vec0.dll" : "vec0.so")],
    [rel("nu/scholar.nu"),                           "nu/scholar.nu"],
  ];

  // Recursively add vendored pdf dist
  function collectDir(srcBase: string, archBase: string): void {
    for (const entry of readdirSync(srcBase, { withFileTypes: true })) {
      const srcPath  = join(srcBase, entry.name);
      const archPath = archBase + "/" + entry.name;
      if (entry.isDirectory()) {
        collectDir(srcPath, archPath);
      } else {
        manifest.push([srcPath, archPath]);
      }
    }
  }
  collectDir(rel("build/vendor/pdf-server"), "build/vendor/pdf-server");
  // Slash commands + skills (frontends cycle 6.10). collectDir is used (not
  // file enumeration) so frontends can add a sixth command or skill without
  // requiring a packaging revision.
  collectDir(rel("commands"), "commands");
  collectDir(rel("skills"), "skills");

  // Validate every source file exists before attempting zip
  for (const [src] of manifest) {
    if (!existsSync(src)) {
      abort("SCHOLAR_BUILD_MISSING_ARTIFACT", `Expected artifact not found: ${src}. Ensure all upstream plans have completed their cycles.`);
    }
  }

  // Build fflate-compatible file map
  const fileMap: Record<string, Uint8Array> = {};
  for (const [src, archPath] of manifest) {
    fileMap[archPath] = new Uint8Array(readFileSync(src));
  }

  const zipped = zipSync(fileMap, { level: 6 });

  // Determine output paths
  const coworkSystemDir = PLUGIN_OUT
    ?? join(homedir(), "Documents", "Cowork", "System");
  mkdirSync(coworkSystemDir, { recursive: true });
  const primaryOut = join(coworkSystemDir, "scholar.plugin");
  await Bun.write(primaryOut, zipped);
  console.log(`scholar.plugin written to: ${primaryOut}`);

  // Best-effort secondary copy to COWORK_PLUGINS_DIR if set
  const stagingEnv = process.env.COWORK_PLUGINS_DIR;
  if (stagingEnv) {
    try {
      mkdirSync(stagingEnv, { recursive: true });
      const secondaryOut = join(stagingEnv, "scholar.plugin");
      await Bun.write(secondaryOut, zipped);
      console.log(`scholar.plugin also copied to staging: ${secondaryOut}`);
    } catch (e) {
      console.warn(`Warning: could not copy to COWORK_PLUGINS_DIR (${stagingEnv}): ${(e as Error).message}`);
    }
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`scholar plugin build — ${FIXTURE ? "FIXTURE MODE" : "production"}`);

  assertVersionInvariant();                        // pre-flight: steps 4 ↔ 5 version match

  await step1_buildServer(BUILD_ROOT, FIXTURE);    // §14.1 step 1
  await step2_buildUI();           // §14.1 step 2
  await step3_copyPdf();           // §14.1 step 3
  await step4_copyRuntime();       // §14.1 step 4
  await step5_copyVec();           // §14.1 step 5 (also runs in fixture for vec0 check)
  await step6_copyNu();            // §14.1 step 6
  await step7_assemblePlugin();    // §14.1 step 7

  console.log("Build complete.");
}

main().catch((e) => {
  process.stderr.write(`Unhandled build error: ${(e as Error).message}\n`);
  process.exit(1);
});
```

- [ ] **Step 2.2: Run the tests — confirm they pass**

```bash
bun test scripts/build-plugin.test.ts
```

Expected output: all 9 tests PASS. If a test fails:
- `SCHOLAR_BUILD_MISMATCH` test failing → check that `assertVersionInvariant()` reads `scholar.bundledBunVersion` / `scholar.bunSqliteVersion` and calls `abort()` on mismatch.
- `SCHOLAR_BUILD_VEC_MISSING` test failing → check that `step5_copyVec()` calls `abort("SCHOLAR_BUILD_VEC_MISSING", ...)` before the `copyFileSync`. The test omits `src/vendor/sqlite-vec/` entries (not `build/`); the prebuilt check is on the source path.
- Layout test failing → verify the `manifest` array in `step7_assemblePlugin()` includes all required paths and that `collectDir` is called for `commands/`, `skills/`, and `build/vendor/pdf-server`.
- Layout test: platform variant wrong → verify `isWin` is computed from `process.platform` in step7 and FIXTURE_FILES stages both `.dll`/`.so` and `bun.exe`/`bun`.
- `step1_buildServer` sibling-copy test failing → confirm `step1_buildServer` is exported and its signature is `(buildRoot: string, fixture: boolean) => Promise<void>`. Confirm the `copyFileSync` call is outside the `if (!fixture)` guard.

- [ ] **Step 2.3: Run the full test suite to verify no regressions**

```bash
bun test
```

Expected: all tests pass (packaging adds no new failures to the suite).

- [ ] **Step 2.4: Commit the Green implementation**

```bash
git add scripts/build-plugin.ts
git commit -m "feat(packaging): implement build-plugin.ts — seven §14.1 steps, fixture mode, version invariant, vec0 guard [cycle 6.13]"
```

---

### Task 3 (Refactor, optional): Extract step helpers

Only execute if the `main()` + `step7_assemblePlugin()` body exceeds ~150 lines and feels unwieldy.

- [ ] **Step 3.1: Extract `collectDir` and `buildManifest` into a `lib/` sibling if warranted**

If the manifest-collection and zip invocation warrant a helper module, extract to `scripts/lib/archive.ts`. Ensure the test still passes after extraction. Do not change external behavior.

- [ ] **Step 3.2 (conditional): Commit the refactor**

```bash
git add scripts/build-plugin.ts scripts/lib/
git commit -m "refactor(packaging): extract archive helpers into scripts/lib/archive.ts"
```

---

## Self-review checklist (run before submitting for approval)

- [ ] **§14.1 coverage:** Every numbered step (1–7) has a corresponding `step<N>_*` function and its label appears in the orchestrator call sequence.
- [ ] **Version invariant:** `assertVersionInvariant()` is called before any step, including in fixture mode.
- [ ] **vec0 ABI probe + compile fallback:** `step5_copyVec()` branches correctly — prebuilt copy in happy path; compile fallback on ABI failure or absence; `SCHOLAR_BUILD_NO_C_TOOLCHAIN` when no compiler found. `SCHOLAR_BUILD_VEC_MISSING` fires only in fixture mode when the stub is absent. `probeVec0Abi` is exported and tested in isolation. `FORCE_COMPILE` flag routes to the compile path without requiring a real ABI mismatch.
- [ ] **Extension-less sibling:** `step1_buildServer` is exported with signature `(buildRoot, fixture)`. The `copyFileSync` sibling-copy runs in BOTH production and fixture mode (not guarded by `fixture`). The dedicated unit test verifies coverage.
- [ ] **Platform variants staged:** FIXTURE_FILES stages both `vec0.dll`/`vec0.so` and `bun.exe`/`bun`; step7 manifest picks the correct variant via `process.platform`. Tests pass on Linux/WSL (the project dev host) and Windows.
- [ ] **commands/ and skills/ packed:** `step7_assemblePlugin` calls `collectDir(rel("commands"), "commands")` and `collectDir(rel("skills"), "skills")`. Both directories appear in layout test assertions.
- [ ] **No sqlite3-mcp packing (posture-B preservation guard):** Archive listing does not contain `sqlite3-mcp` or `server-sqlite3` paths. The layout test asserts this explicitly with `.not.toMatch(/sqlite3.mcp|server-sqlite3/)` over all entry names.
- [ ] **Dual output:** Step 7 writes to the primary Cowork system path and best-effort copies to `COWORK_PLUGINS_DIR` if set.
- [ ] **No `bun add`:** No new deps introduced. `fflate` (imported as `{ zipSync }` and `{ unzipSync }`) is pre-declared by foundation (Ruling #2). No CLI zip tool invoked.
- [ ] **Smoke test completeness:** Archive tests check (a) layout + platform variants + commands/skills + posture-B guard, (b) `plugin.json` shape, (c) `.mcp.json` `command` path present inside archive.
- [ ] **No first-run wizard code:** `scripts/first-run.ts` is not referenced or created here. First-run wizard is owned entirely by the `corpus` sibling plan (cycle 6.3).

### Posture-B regression-guard (deferred)

SKIP — packaging cycle 6.13 has no ctx-access (pure file-system + Bun.build); no
regression-guard surface exists. Verified by grep on `scripts/build-plugin.ts`:
no `ctx.` or `built.ctx` references present. The plan's existing posture-B
coverage is the archive-layout assertion (checklist item "No sqlite3-mcp packing")
which confirms the binary is never packed — not an MCP-touchpoint guard.
Documented post-execution by chore `propagate-proxy-regression-guard-across-plans`
(plan-group `2026-05-22-scholar-plugin` closed at c4f61da on 2026-05-25).
- [ ] **No sibling file edits:** Only `scripts/build-plugin.ts` and `scripts/build-plugin.test.ts` are created. No edits to `package.json`, `bun.lock`, `tsconfig.json`, `.claude/context/`, or any sibling plan's blast-radius files.

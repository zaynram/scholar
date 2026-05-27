// scripts/build-plugin.test.ts
import { test, expect, beforeAll, afterAll } from "bun:test"
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
  mkdtempSync,
  readFileSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { unzipSync } from "fflate" // pre-declared by foundation; no CLI dependency
import util from "^scripts/util"
import env from "^scripts/util/env.ts"
import { getVec0Extension } from "^src/server/db/sqlite-vec.ts"

// Fixture root — a temp dir acting as the repo root for the test run
const FIXTURE_ROOT = mkdtempSync(join(tmpdir(), "scholar-build-test-"))
const OUTPUT_DIR = join(FIXTURE_ROOT, "dist")

// Paths the build script expects to find (fixture stubs).
// BOTH platform variants for runtime and vec0 are staged so the test suite
// passes on any dev host (Linux/WSL or Windows). step7_assemblePlugin picks
// the platform-appropriate variant at archive assembly time.
// build/scholar (extension-less sibling) is intentionally absent — step1
// creates it from build/scholar.exe even in fixture mode (M1 coverage).
const FIXTURE_FILES: [string, string][] = [
  ["build/scholar.exe", '{"stub":"server-binary"}'],
  ["build/ui/app.html", "<!DOCTYPE html><html><body>stub</body></html>"],
  ["build/vendor/pdf-server/dist/index.js", "// stub pdf server"],
  // Both vec0 platform variants (step5 copies from src/ to build/)
  ["runtime/vendor/sqlite-vec/vec0.dll", "stub-dll-win"],
  ["build/vendor/sqlite-vec/vec0.dll", "stub-dll-win"],
  ["runtime/vendor/sqlite-vec/vec0.so", "stub-so-linux"],
  ["build/vendor/sqlite-vec/vec0.so", "stub-so-linux"],
  // sqlite-vec source for compile fallback (build-time only; NOT archived).
  // Source filename is sqlite-vec.c per spec §14.1 step 5 + §7.2.1.
  ["src/vendor/sqlite-vec/sqlite-vec.c", "/* stub sqlite-vec source */"],
  ["src/vendor/sqlite-vec/sqlite3.h", "/* stub sqlite3 header */"],
  // Both Bun runtime platform variants
  ["build/runtime/bun.exe", "stub-runtime-win"],
  ["build/runtime/bun", "stub-runtime-posix"],
  ["nu/scholar.nu", "# stub nu module"],
  // Slash commands — frontends cycle 6.10
  ["commands/ingest.md", "# stub ingest command"],
  ["commands/digest.md", "# stub digest command"],
  ["commands/status.md", "# stub status command"],
  // Skills — frontends cycle 6.10
  ["skills/scholar-workflow/SKILL.md", "# stub scholar-workflow skill"],
  ["skills/scholar-ingest/SKILL.md", "# stub scholar-ingest skill"],
  [
    ".claude-plugin/plugin.json",
    JSON.stringify({
      name: "scholar",
      version: "0.1.0",
      description: "stub",
      author: { name: "zayn" },
      keywords: [],
      license: "MIT",
    }),
  ],
  [
    ".mcp.json",
    JSON.stringify({
      mcpServers: {
        scholar: { command: "./build/scholar", args: [], env: {} },
      },
    }),
  ],
]

// package.json with both version fields populated (intentionally differing values —
// bundledBunVersion records the Bun runtime version, bunSqliteVersion records the
// SQLite library version Bun's bun:sqlite links against; they record different facts
// about the same Bun release and are expected to differ).
const PKG_JSON = {
  name: "scholar",
  version: "0.1.0",
  scripts: {
    "build:server": "echo skip-in-fixture",
    "build:ui": "echo skip-in-fixture",
    "build:pdf": "echo skip-in-fixture",
    "build:runtime": "echo skip-in-fixture",
    "build:vec": "echo skip-in-fixture",
    "build:nu": "echo skip-in-fixture",
    "build:plugin": "echo skip-in-fixture",
  },
  scholar: {
    bundledBunVersion: "1.2.3", // fake Bun runtime version
    bunSqliteVersion: "3.45.0", // fake SQLite library version (intentionally different)
  },
  dependencies: {},
  devDependencies: {},
}

beforeAll(() => {
  for (const [relPath, content] of FIXTURE_FILES) {
    const abs = join(FIXTURE_ROOT, relPath)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, content, "utf8")
  }
  mkdirSync(join(FIXTURE_ROOT, "scripts"), { recursive: true })
  writeFileSync(
    join(FIXTURE_ROOT, "package.json"),
    JSON.stringify(PKG_JSON, null, 2),
  )
  mkdirSync(OUTPUT_DIR, { recursive: true })
})

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
})

// Helper: spawn the build script with fixture env, collect exit code + stderr.
// process.execPath is used instead of "bun" to avoid PATH-resolution failure
// when the SCHOLAR_BUILD_NO_C_TOOLCHAIN test overrides PATH to an empty dir —
// Bun.spawn resolves the executable name from the env-supplied PATH.
async function runBuildScript(
  buildRoot: string,
  pluginOut: string,
  extraEnv: Record<string, string> = {},
) {
  const proc = Bun.spawn(
    [process.execPath, util.subpath("scripts/build-plugin.ts")],
    {
      env: {
        ...process.env,
        SCHOLAR_BUILD_FIXTURE: "1",
        SCHOLAR_ROOT: buildRoot,
        SCHOLAR_PLUGIN_OUT: pluginOut,
        ...extraEnv,
      },
      stdout: "pipe",
      stderr: "pipe",
      cwd: util.subpath(),
    },
  )
  const exitCode = await proc.exited
  const stderr = await new Response(proc.stderr).text()
  return { exitCode, stderr }
}

// Helper: read archive with fflate — platform-independent, no unzip CLI needed.
function readArchive(archivePath: string): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(readFileSync(archivePath)))
}

test("build-plugin produces a .plugin archive with the required layout", async () => {
  const { exitCode, stderr } = await runBuildScript(FIXTURE_ROOT, OUTPUT_DIR)
  expect(exitCode, `build script exited non-zero:\n${stderr}`).toBe(0)

  const archivePath = join(OUTPUT_DIR, "scholar.plugin")
  expect(existsSync(archivePath)).toBe(true)

  const entries = readArchive(archivePath)
  const entryNames = Object.keys(entries)

  // Platform-specific variants — step7 picks based on process.platform
  const runtimeEntry = `build/runtime/bun${env.dynamic({ win32: ".exe", default: "" })}`
  const vec0Entry = `build/vendor/sqlite-vec/vec0.${getVec0Extension()}`
  const requiredEntries = [
    ".claude-plugin/plugin.json",
    ".mcp.json",
    "build/scholar.exe",
    "build/scholar", // extension-less sibling (step1)
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
  ]

  for (const entry of requiredEntries) {
    expect(entryNames, `Missing archive entry: ${entry}`).toContain(entry)
  }

  // Posture-B preservation guard: sqlite3-mcp must NOT appear in the archive.
  // Scholar reimplements §10 query/backup/inspect in-process via bun:sqlite per
  // user posture-B ruling 2026-05-24; no Python binary is vendored or shipped.
  for (const name of entryNames) {
    expect(
      name,
      `sqlite3-mcp artifact found in archive (posture-B violation): ${name}`,
    ).not.toMatch(/sqlite3.mcp|server-sqlite3/)
  }
})

test("archive plugin.json is valid JSON matching the scholar manifest schema", async () => {
  const archivePath = join(OUTPUT_DIR, "scholar.plugin")
  const entries = readArchive(archivePath)
  const raw = new TextDecoder().decode(entries[".claude-plugin/plugin.json"])
  const parsed = JSON.parse(raw) // throws if invalid JSON

  expect(parsed.name).toBe("scholar")
  expect(typeof parsed.version).toBe("string")
  expect(parsed.license).toBe("MIT")
})

test("archive .mcp.json is valid JSON and command path is present in archive", async () => {
  const archivePath = join(OUTPUT_DIR, "scholar.plugin")
  const entries = readArchive(archivePath)
  const raw = new TextDecoder().decode(entries[".mcp.json"])
  const parsed = JSON.parse(raw)

  const serverEntry = Object.values(
    parsed.mcpServers as Record<string, { command: string }>,
  )[0]
  expect(serverEntry).toBeDefined()

  // Strip leading ./ and verify the command binary is present in the archive
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const commandRel = serverEntry!.command.replace(/^\.\//, "")
  expect(
    Object.keys(entries),
    `command path '${commandRel}' not found in archive`,
  ).toContain(commandRel)
})

test("step1_buildServer creates extension-less build/scholar sibling (sibling-copy branch coverage)", async () => {
  // Exercises the copyFileSync branch that has zero coverage under the full
  // fixture-mode integration test (which pre-stages build/scholar). Here we
  // deliberately provide only build/scholar.exe and assert step1 produces the sibling.
  const tmpDir = mkdtempSync(join(tmpdir(), "scholar-step1-"))
  try {
    mkdirSync(join(tmpDir, "build"), { recursive: true })
    writeFileSync(join(tmpDir, "build/scholar.exe"), "stub-binary-content")

    // step1_buildServer is exported and accepts (buildRoot, fixture) explicitly
    // so it can be called in isolation without module-level env var coupling.
    const { step1_buildServer } =
      (await import("^scripts/build-plugin.ts")) as {
        step1_buildServer: (root: string, fixture: boolean) => Promise<void>
      }
    await step1_buildServer(tmpDir, true) // fixture=true skips shell-out; runs copy

    const siblingPath = join(tmpDir, "build/scholar")
    expect(
      existsSync(siblingPath),
      "extension-less sibling not created by step1",
    ).toBe(true)
    expect(readFileSync(siblingPath, "utf8")).toBe("stub-binary-content")
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test("build-plugin aborts with SCHOLAR_BUILD_MISMATCH when bundledBunVersion is missing", async () => {
  // scholar.bundledBunVersion omitted entirely — the invariant is that BOTH fields
  // must be populated and non-empty (they record different facts about the same Bun
  // release; string-equality is NOT required).
  const missingBvRoot = mkdtempSync(
    join(tmpdir(), "scholar-build-mismatch-bv-"),
  )
  try {
    for (const [relPath, content] of FIXTURE_FILES) {
      const abs = join(missingBvRoot, relPath)
      mkdirSync(join(abs, ".."), { recursive: true })
      writeFileSync(abs, content, "utf8")
    }
    const missingBvPkg = {
      ...PKG_JSON,
      scholar: { bunSqliteVersion: "3.45.0" }, // bundledBunVersion absent
    }
    writeFileSync(
      join(missingBvRoot, "package.json"),
      JSON.stringify(missingBvPkg, null, 2),
    )
    mkdirSync(join(missingBvRoot, "dist"), { recursive: true })

    const { exitCode, stderr } = await runBuildScript(
      missingBvRoot,
      join(missingBvRoot, "dist"),
    )
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain("SCHOLAR_BUILD_MISMATCH")
  } finally {
    rmSync(missingBvRoot, { recursive: true, force: true })
  }
})

test("build-plugin aborts with SCHOLAR_BUILD_MISMATCH when bunSqliteVersion is empty", async () => {
  // scholar.bunSqliteVersion present but empty string — the invariant catches
  // both missing and empty-string values.
  const emptySvRoot = mkdtempSync(join(tmpdir(), "scholar-build-mismatch-sv-"))
  try {
    for (const [relPath, content] of FIXTURE_FILES) {
      const abs = join(emptySvRoot, relPath)
      mkdirSync(join(abs, ".."), { recursive: true })
      writeFileSync(abs, content, "utf8")
    }
    const emptySvPkg = {
      ...PKG_JSON,
      scholar: { bundledBunVersion: "1.2.3", bunSqliteVersion: "" }, // empty string
    }
    writeFileSync(
      join(emptySvRoot, "package.json"),
      JSON.stringify(emptySvPkg, null, 2),
    )
    mkdirSync(join(emptySvRoot, "dist"), { recursive: true })

    const { exitCode, stderr } = await runBuildScript(
      emptySvRoot,
      join(emptySvRoot, "dist"),
    )
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain("SCHOLAR_BUILD_MISMATCH")
  } finally {
    rmSync(emptySvRoot, { recursive: true, force: true })
  }
})

test("build-plugin aborts with SCHOLAR_BUILD_VEC_MISSING when vec0 prebuilt is absent", async () => {
  const noVecRoot = mkdtempSync(join(tmpdir(), "scholar-build-novec-"))
  try {
    for (const [relPath, content] of FIXTURE_FILES) {
      // Omit all src/vendor/sqlite-vec/ entries (both .dll and .so) — the script
      // must detect the platform-appropriate prebuilt is absent and abort.
      if (relPath.startsWith("runtime/vendor/sqlite-vec/")) continue
      const abs = join(noVecRoot, relPath)
      mkdirSync(join(abs, ".."), { recursive: true })
      writeFileSync(abs, content, "utf8")
    }
    writeFileSync(
      join(noVecRoot, "package.json"),
      JSON.stringify(PKG_JSON, null, 2),
    )
    mkdirSync(join(noVecRoot, "dist"), { recursive: true })

    const { exitCode, stderr } = await runBuildScript(
      noVecRoot,
      join(noVecRoot, "dist"),
    )
    expect(exitCode).not.toBe(0)
    expect(stderr).toContain("SCHOLAR_BUILD_VEC_MISSING")
  } finally {
    rmSync(noVecRoot, { recursive: true, force: true })
  }
})

// ── Compile-fallback tests (I2 ruling) ───────────────────────────────────────
// SCHOLAR_BUILD_VEC_FORCE_COMPILE=1 bypasses the ABI probe and jumps directly
// to compileVec0FromSource, enabling fixture-mode testing of the compile path
// without requiring a real ABI-mismatched binary.

test("probeVec0Abi returns false for a file that is not a valid SQLite extension", async () => {
  // Unit test for the ABI probe helper. probeVec0Abi must be exported.
  const { probeVec0Abi } = (await import("^scripts/build-vec0.ts")) as {
    probeVec0Abi: (extPath: string) => boolean
  }
  const stubPath = join(FIXTURE_ROOT, "runtime/vendor/sqlite-vec/vec0.dll")
  // The fixture stub contains plain text ("stub-dll-win"), not a real extension.
  // loadExtension must throw, and probeVec0Abi must return false.
  const result = probeVec0Abi(stubPath)
  expect(result).toBe(false)
})

test("compile fallback produces vec0 artifact when SCHOLAR_BUILD_VEC_FORCE_COMPILE=1", async () => {
  // Verify that compileVec0FromSource is invoked when SCHOLAR_BUILD_VEC_FORCE_COMPILE=1,
  // and that the compiled artifact ends up at build/vendor/sqlite-vec/<libname>.
  //
  // The stub CC script writes dummy bytes to the output path (the -o argument).
  // This validates the compile path mechanics without requiring a real C toolchain.
  const compileRoot = mkdtempSync(join(tmpdir(), "scholar-compile-"))
  try {
    for (const [relPath, content] of FIXTURE_FILES) {
      // Skip both the runtime/ cache and the build/ destination so the compile
      // path actually fires: compileVec0FromSource short-circuits on a cached
      // artifact at runtime/vendor/sqlite-vec/, and a pre-staged destination
      // would make existsSync(compiledPath) pass without the stub CC running.
      if (relPath.startsWith("runtime/vendor/sqlite-vec/")) continue
      if (relPath.startsWith("build/vendor/sqlite-vec/")) continue
      const abs = join(compileRoot, relPath)
      mkdirSync(join(abs, ".."), { recursive: true })
      writeFileSync(abs, content, "utf8")
    }
    writeFileSync(
      join(compileRoot, "package.json"),
      JSON.stringify(PKG_JSON, null, 2),
    )
    mkdirSync(join(compileRoot, "dist"), { recursive: true })

    // Cross-platform stub CC: a small Bun script that parses -o <path> from
    // argv and writes stub bytes there. The build script invokes: CC <flags> -o <path>
    const ccStubPath = join(compileRoot, "stub-cc.ts")
    writeFileSync(
      ccStubPath,
      `
const args = process.argv.slice(2);
const oIdx = args.indexOf("-o");
if (oIdx !== -1 && args[oIdx + 1]) {
  await Bun.write(args[oIdx + 1], "stub-compiled-vec0");
} else {
  // MSVC /Fe:<path> convention
  const feArg = args.find(a => a.startsWith("/Fe:"));
  if (feArg) await Bun.write(feArg.slice(4), "stub-compiled-vec0");
}
`,
      "utf8",
    )

    const { exitCode, stderr } = await runBuildScript(
      compileRoot,
      join(compileRoot, "dist"),
      {
        SCHOLAR_BUILD_VEC_FORCE_COMPILE: "1",
        CC: `bun ${ccStubPath}`,
      },
    )

    expect(exitCode, `compile-fallback path exited non-zero:\n${stderr}`).toBe(
      0,
    )

    // Compiled artifact should exist at build/vendor/sqlite-vec/<libname>
    // AND contain the stub CC's output — proves the compile path actually ran
    // rather than copying a pre-staged stub.
    const libName = `vec0.${getVec0Extension()}`
    const compiledPath = join(compileRoot, "build/vendor/sqlite-vec", libName)
    expect(
      existsSync(compiledPath),
      `compiled vec0 not found at ${compiledPath}`,
    ).toBe(true)
    expect(readFileSync(compiledPath, "utf8")).toBe("stub-compiled-vec0")
  } finally {
    rmSync(compileRoot, { recursive: true, force: true })
  }
})

test("build-plugin aborts with SCHOLAR_BUILD_NO_C_TOOLCHAIN when no compiler is available", async () => {
  const noCcRoot = mkdtempSync(join(tmpdir(), "scholar-no-cc-"))
  try {
    for (const [relPath, content] of FIXTURE_FILES) {
      if (relPath.startsWith("runtime/vendor/sqlite-vec/")) continue
      const abs = join(noCcRoot, relPath)
      mkdirSync(join(abs, ".."), { recursive: true })
      writeFileSync(abs, content, "utf8")
    }
    writeFileSync(
      join(noCcRoot, "package.json"),
      JSON.stringify(PKG_JSON, null, 2),
    )
    mkdirSync(join(noCcRoot, "dist"), { recursive: true })

    // CC set to a non-existent binary and PATH cleared of known compilers
    const { exitCode, stderr } = await runBuildScript(
      noCcRoot,
      join(noCcRoot, "dist"),
      {
        SCHOLAR_BUILD_VEC_FORCE_COMPILE: "1",
        CC: "nonexistent-compiler-that-does-not-exist",
        // Override PATH to prevent fallback to system cc/gcc/clang
        PATH: join(noCcRoot, "empty-bin"),
      },
    )

    expect(exitCode).not.toBe(0)
    expect(stderr).toContain("SCHOLAR_BUILD_NO_C_TOOLCHAIN")
  } finally {
    rmSync(noCcRoot, { recursive: true, force: true })
  }
})

// scripts/build-plugin.ts
//
// Build orchestrator for scholar.plugin — §14.1 seven-step build pipeline.
// Run: bun scripts/build-plugin.ts
// Fixture mode: BUILD_FIXTURE=1 bun scripts/build-plugin.ts
//   Skips compilation steps (1, 2, 3, 4, 6); validates pre-assembly
//   invariants (version match, vec0 presence) then runs assembly + zip.
//   SCHOLAR_BUILD_ROOT overrides the repo root (for tests).
//   SCHOLAR_PLUGIN_OUT overrides the output directory (for tests).

import { zipSync } from "fflate"
import {
  existsSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { $ } from "bun"
import { rel, err, paths, flags } from "."
import { compileVec0FromSource, probeVec0Abi } from "./build-vec0"
import { getVec0Extension } from "^src/server/db/sqlite-vec"

// ── Pre-flight: version invariant (steps 4 ↔ 5) ─────────────────────────────
// Reads scholar.bundledBunVersion and scholar.bunSqliteVersion from package.json
// and aborts with SCHOLAR_BUILD_MISMATCH if either is missing or empty.
//
// These two fields record DIFFERENT facts about the same Bun release:
//   - bundledBunVersion: the Bun runtime version (value of `bun --version` at build time)
//   - bunSqliteVersion:  the SQLite library version Bun's bun:sqlite statically links against
// Their string values are expected to differ (e.g. "1.3.11" vs "3.51.2").
// The invariant is that BOTH are populated and non-empty — not that they are equal.
// Both fields must be set from the same Bun release by foundation cycle 6.1.

function assertVersionInvariant(): void {
  const pkgRaw = readFileSync(rel("package.json"), "utf8")
  const pkg = JSON.parse(pkgRaw) as {
    scholar?: { bundledBunVersion?: string; bunSqliteVersion?: string }
  }
  const bv = pkg.scholar?.bundledBunVersion
  const sv = pkg.scholar?.bunSqliteVersion
  if (!bv || !bv.trim() || !sv || !sv.trim()) {
    err(
      "SCHOLAR_BUILD_MISMATCH",
      "package.json is missing scholar.bundledBunVersion or scholar.bunSqliteVersion " +
        "(both record different facts about the same Bun release; both must be populated). " +
        `Got bundledBunVersion=${JSON.stringify(bv)}, bunSqliteVersion=${JSON.stringify(sv)}.`,
    )
  }
  // No string-equality check: bundledBunVersion (Bun runtime version) and
  // bunSqliteVersion (SQLite library version) record different facts about
  // the same Bun release and are expected to differ.
}

// ── Step 1: Build server binary ───────────────────────────────────────────────
// bun run build:server → tsc typecheck + bun build --compile src/server/index.ts
// Also writes extension-less build/scholar sibling (resolved: copy, not shim).
//
// Exported and parameterised so the sibling-copy branch can be unit-tested in
// isolation. fixture=true skips the shell-out but still performs the copy.

export async function step1_buildServer(
  buildRoot: string,
  fixture: boolean,
): Promise<void> {
  if (!fixture) {
    await $`bun run build:server`.cwd(buildRoot)
  }
  // Extension-less sibling — runs in BOTH production and fixture mode.
  // .mcp.json command is "./build/scholar" (no extension); Windows hosts need
  // the sibling for runtime extension-search resolution (§14.1 step 1).
  const exePath = join(buildRoot, "build/scholar.exe")
  const sibPath = join(buildRoot, "build/scholar")
  if (existsSync(exePath)) {
    copyFileSync(exePath, sibPath)
  }
}

// ── Step 2: Build UI bundle ───────────────────────────────────────────────────
// bun build src/ui/index.html --target=browser --outfile build/ui/app.html
// Target ≤ 4.5 MB (bundle-budget gate resolved upstream by frontends cycle 6.9).

async function step2_buildUI(): Promise<void> {
  if (flags.FIXTURE) return
  mkdirSync(rel("build/ui"), { recursive: true })
  await $`bun run build:ui`.cwd(paths.ROOT)
}

// ── Step 3: Copy vendored pdf dist ────────────────────────────────────────────
// Copies src/vendor/pdf-server/ → build/vendor/pdf-server/.
// No transpilation, no patch step (vendor is unmodified per §7.2).

async function step3_copyPdf(): Promise<void> {
  if (flags.FIXTURE) return
  const src = rel("src/vendor/pdf-server")
  const dest = rel("build/vendor/pdf-server")
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true })
}

// ── Step 4: Copy Bun runtime ──────────────────────────────────────────────────
// Copies bun(.exe) from the build host's Bun install to build/runtime/.
// The bundled runtime is the pdf-child spawn target.

async function step4_copyRuntime(): Promise<void> {
  if (flags.FIXTURE) return
  const isWin = process.platform === "win32"
  const bunName = isWin ? "bun.exe" : "bun"
  const which = (
    (await $`which bun`.text().catch(() => null)) ??
    (await $`where bun`.text().catch(() => null))
  )?.trim()

  if (!which)
    return err(
      "SCHOLAR_BUILD_RUNTIME_MISSING",
      "Cannot locate bun binary on PATH. Ensure bun is installed on the build host.",
    )

  const [firstLine = ""] = which.split("\n")
  const bunSrc = firstLine.trim()
  const destDir = rel("build/runtime")
  mkdirSync(destDir, { recursive: true })
  copyFileSync(bunSrc, join(destDir, bunName))
}

// ── Step 5: vec0 shared library — ABI probe then compile fallback ─────────────
// Production: probeVec0Abi on the prebuilt; if ABI matches, copy it; otherwise
//   (or if absent) fall back to compileVec0FromSource (§14.1 step 5 / §16).
// Fixture (no FORCE_COMPILE): skip ABI probe (stubs aren't real extensions);
//   copy stub prebuilt directly. Abort if stub is absent.
// Fixture + FORCE_COMPILE: skip prebuilt; exercise compile path with a stub CC.

async function step5_copyVec(): Promise<void> {
  const libName = `vec0.${getVec0Extension()}`
  const prebuilt = rel(`runtime/vendor/sqlite-vec/${libName}`)
  const destDir = rel("build/vendor/sqlite-vec")
  mkdirSync(destDir, { recursive: true })
  const destPath = join(destDir, libName)

  if (flags.FIXTURE && !flags.COMPILE)
    if (!existsSync(prebuilt))
      // Fixture: skip ABI probe; just assert prebuilt stub is staged and copy it.
      err(
        "SCHOLAR_BUILD_VEC_MISSING",
        `Prebuilt ${libName} not found at ${prebuilt} [fixture mode]. ` +
          "Ensure FIXTURE_FILES stages both vec0.dll and vec0.so.",
      )
    else copyFileSync(prebuilt, destPath)

  // Production or FORCE_COMPILE: ABI probe → use prebuilt or compile fallback.
  const usePrebuilt =
    !flags.COMPILE && existsSync(prebuilt) && probeVec0Abi(prebuilt)
  if (usePrebuilt) {
    copyFileSync(prebuilt, destPath)
    return
  }

  if (!flags.COMPILE) {
    const reason = !existsSync(prebuilt)
      ? `prebuilt ${libName} not found`
      : "prebuilt ABI probe failed (SQLite version mismatch between vec0 and Bun's bundled engine)"
    console.warn(`vec0 ${reason} — falling back to compile-from-source`)
  }

  await compileVec0FromSource(destPath)
}

// ── Step 6: Copy nu module ────────────────────────────────────────────────────

async function step6_copyNu(): Promise<void> {
  if (flags.FIXTURE) return
  const src = rel("nu/scholar.nu")
  const dest = rel("build/nu/scholar.nu")
  mkdirSync(rel("build/nu"), { recursive: true })
  copyFileSync(src, dest)
}

// ── Step 7: Assemble plugin tree + zip ────────────────────────────────────────
// Assembles the complete file map then produces scholar.plugin via fflate.
// Uses fflate (Ruling #2, 2026-05-24) — imported at top of file.

async function step7_assemblePlugin(): Promise<void> {
  // Files to include in the archive: [src-abs-path, archive-relative-path]
  const isWin = process.platform === "win32"

  const manifest: [string, string][] = [
    [rel(".claude-plugin/plugin.json"), ".claude-plugin/plugin.json"],
    [rel(".mcp.json"), ".mcp.json"],
    [rel("build/scholar.exe"), "build/scholar.exe"],
    [rel("build/scholar"), "build/scholar"], // extension-less sibling
    [rel("build/ui/app.html"), "build/ui/app.html"],
    [
      rel("build/runtime/" + (isWin ? "bun.exe" : "bun")),
      "build/runtime/" + (isWin ? "bun.exe" : "bun"),
    ],
    [
      rel("build/vendor/sqlite-vec/" + (isWin ? "vec0.dll" : "vec0.so")),
      "build/vendor/sqlite-vec/" + (isWin ? "vec0.dll" : "vec0.so"),
    ],
    [rel("nu/scholar.nu"), "nu/scholar.nu"],
  ]

  // Recursively collect all files from a directory into the manifest.
  // Used for pdf dist, slash commands, and skills — so frontends can add
  // a file without requiring a packaging revision.
  function collectDir(srcBase: string, archBase: string): void {
    if (!existsSync(srcBase)) return // gracefully skip absent optional dirs
    for (const entry of readdirSync(srcBase, { withFileTypes: true })) {
      const srcPath = join(srcBase, entry.name)
      const archPath = archBase + "/" + entry.name
      if (entry.isDirectory()) {
        collectDir(srcPath, archPath)
      } else {
        manifest.push([srcPath, archPath])
      }
    }
  }

  collectDir(rel("build/vendor/pdf-server"), "build/vendor/pdf-server")
  // Slash commands + skills (frontends cycle 6.10).
  collectDir(rel("commands"), "commands")
  collectDir(rel("skills"), "skills")

  // Validate every source file exists before attempting zip.
  const missing = manifest.map(([src]) => src).filter((src) => !existsSync(src))
  if (missing.length > 0)
    return err(
      "SCHOLAR_BUILD_MISSING_ARTIFACT",
      `Expected artifact(s) not found: ${missing.join(", ")}. ` +
        "Ensure all upstream plans have completed their cycles.",
    )

  // Build fflate-compatible file map.
  const fileMap: Record<string, Uint8Array> = {}
  for (const [src, archPath] of manifest) {
    fileMap[archPath] = new Uint8Array(readFileSync(src))
  }

  const zipped = zipSync(fileMap, { level: 6 })

  // Determine output paths.
  const coworkSystemDir =
    paths.OUTPUT ?? join(homedir(), "Documents", "Cowork", "System")
  mkdirSync(coworkSystemDir, { recursive: true })
  const primaryOut = join(coworkSystemDir, "scholar.plugin")
  await Bun.write(primaryOut, zipped)
  console.log(`scholar.plugin written to: ${primaryOut}`)

  // Best-effort secondary copy to COWORK_PLUGINS_DIR if set.
  const stagingEnv = process.env.COWORK_PLUGINS_DIR
  if (stagingEnv) {
    try {
      mkdirSync(stagingEnv, { recursive: true })
      const secondaryOut = join(stagingEnv, "scholar.plugin")
      await Bun.write(secondaryOut, zipped)
      console.log(`scholar.plugin also copied to staging: ${secondaryOut}`)
    } catch (e) {
      console.warn(
        `Warning: could not copy to COWORK_PLUGINS_DIR (${stagingEnv}): ` +
          `${(e as Error).message}`,
      )
    }
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    `scholar plugin build — ${flags.FIXTURE ? "FIXTURE MODE" : "production"}`,
  )

  assertVersionInvariant() // pre-flight: steps 4 ↔ 5 version match

  await step1_buildServer(paths.ROOT, flags.FIXTURE) // §14.1 step 1
  await step2_buildUI() // §14.1 step 2
  await step3_copyPdf() // §14.1 step 3
  await step4_copyRuntime() // §14.1 step 4
  await step5_copyVec() // §14.1 step 5 (also runs in fixture for vec0 check)
  await step6_copyNu() // §14.1 step 6
  await step7_assemblePlugin() // §14.1 step 7

  console.log("Build complete.")
}

// Guard main() so the module can be imported by tests without triggering the
// build pipeline. import.meta.main is true only when this file is the entry point.
if (import.meta.main) {
  main().catch((e) => {
    process.stderr.write(`Unhandled build error: ${(e as Error).message}\n`)
    process.exit(1)
  })
}

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
import path, { join } from "node:path"
import { compileVec0FromSource, probeVec0Abi } from "./build-vec0"
import { getVec0Extension } from "^src/server/db/sqlite-vec"
import util, { OUTPUT, FIXTURE } from "./util"
import env from "./util/env"

const VEC0 = `vec0.${getVec0Extension()}`

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
  const pkgRaw = readFileSync(util.subpath("package.json"), "utf8")
  const pkg = JSON.parse(pkgRaw) as {
    scholar?: { bundledBunVersion?: string; bunSqliteVersion?: string }
  }
  const bv = pkg.scholar?.bundledBunVersion
  const sv = pkg.scholar?.bunSqliteVersion
  if (!bv || !bv.trim() || !sv || !sv.trim()) {
    util.abort(
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
  root?: string,
  fixture: boolean = FIXTURE,
): Promise<void> {
  function dynResolve(name: string) {
    return root ? path.join(root, "build", name) : util.subpath("build", name)
  }
  // Explicit `fixture` parameter (default: env-derived FIXTURE) lets the
  // sibling-copy branch be unit-tested without spawning the real build:server.
  // Don't use the util.onfixture combinator here — sync-defaults-around-async
  // is the same footgun that produced the prior step5 incident.
  if (!fixture) {
    await util.sh`bun run build:server`
  }
  const binaries = {
    src: dynResolve("scholar.exe"),
    dst: dynResolve("scholar"),
  } as const
  if (existsSync(binaries.src)) copyFileSync(binaries.src, binaries.dst)
}

// ── Step 2: Build UI bundle ───────────────────────────────────────────────────
// bun build src/ui/index.html --target=browser --outfile build/ui/app.html
// Target ≤ 4.5 MB (bundle-budget gate resolved upstream by frontends cycle 6.9).

async function step2_buildUI(): Promise<void> {
  await util.onfixture(util.noop, {
    async default() {
      mkdirSync(util.subpath("build", "ui"), { recursive: true })
      await util.sh`bun run build:ui`
    },
  })
}

// ── Step 3: Copy vendored pdf dist ────────────────────────────────────────────
// Copies src/vendor/pdf-server/ → build/vendor/pdf-server/.
// No transpilation, no patch step (vendor is unmodified per §7.2).

async function step3_copyPdf(): Promise<void> {
  await util.onfixture(util.noop, {
    default() {
      const src = util.subpath("src/vendor/pdf-server")
      const dest = util.subpath("build/vendor/pdf-server")
      mkdirSync(dest, { recursive: true })
      cpSync(src, dest, { recursive: true })
    },
  })
}

// ── Step 4: Copy Bun runtime ──────────────────────────────────────────────────
// Copies bun(.exe) from the build host's Bun install to build/runtime/.
// The bundled runtime is the pdf-child spawn target.

async function step4_copyRuntime(): Promise<void> {
  await util.onfixture(util.noop, {
    default() {
      const name = env.dynamic({ win32: "bun.exe", default: "bun" })
      const path = Bun.which(name)
      if (!path)
        return util.abort(
          "SCHOLAR_BUILD_RUNTIME_MISSING",
          "Cannot locate bun binary on PATH. Ensure bun is installed on the build host.",
        )
      const [firstLine = ""] = path.split("\n")
      const bunSrc = firstLine.trim()
      const destDir = util.subpath("build/runtime")
      mkdirSync(destDir, { recursive: true })
      copyFileSync(bunSrc, join(destDir, name))
    },
  })
}

// ── Step 5: vec0 shared library — ABI probe then compile fallback ─────────────
// Production: probeVec0Abi on the prebuilt; if ABI matches, copy it; otherwise
//   (or if absent) fall back to compileVec0FromSource (§14.1 step 5 / §16).
// Fixture (no FORCE_COMPILE): skip ABI probe (stubs aren't real extensions);
//   copy stub prebuilt directly. Abort if stub is absent.
// Fixture + FORCE_COMPILE: skip prebuilt; exercise compile path with a stub CC.

async function step5_copyVec(): Promise<void> {
  const libName = `vec0.${getVec0Extension()}`
  const prebuilt = util.subpath(`runtime/vendor/sqlite-vec/${libName}`)
  const destDir = util.subpath("build/vendor/sqlite-vec")
  mkdirSync(destDir, { recursive: true })
  const destPath = join(destDir, libName)

  await util.onfixture(
    () =>
      util.oncompile(() => compileVec0FromSource(destPath), {
        default() {
          if (!existsSync(prebuilt))
            // Fixture: skip ABI probe; just assert prebuilt stub is staged and copy it.
            util.abort(
              "SCHOLAR_BUILD_VEC_MISSING",
              `Prebuilt ${libName} not found at ${prebuilt} [fixture mode]. ` +
                "Ensure FIXTURE_FILES stages both vec0.dll and vec0.so.",
            )
          else copyFileSync(prebuilt, destPath)
        },
      }),
    {
      async default() {
        await util.oncompile(() => compileVec0FromSource(destPath), {
          async default() {
            if (existsSync(prebuilt) && probeVec0Abi(prebuilt)) {
              copyFileSync(prebuilt, destPath)
              return
            }
            const reason = existsSync(prebuilt)
              ? "prebuilt ABI probe failed (SQLite version mismatch between vec0 and Bun's bundled engine)"
              : `prebuilt ${libName} not found`
            console.warn(`vec0 ${reason} — falling back to source compilation`)
            await compileVec0FromSource(destPath)
          },
        })
      },
    },
  )
}

// ── Step 6: Copy nu module ────────────────────────────────────────────────────

async function step6_copyNu(): Promise<void> {
  await util.onfixture(util.noop, {
    default() {
      const src = util.subpath("nu/scholar.nu")
      const dest = util.subpath("build/nu/scholar.nu")
      mkdirSync(util.subpath("build/nu"), { recursive: true })
      copyFileSync(src, dest)
    },
  })
}

// ── Step 7: Assemble plugin tree + zip ────────────────────────────────────────
// Assembles the complete file map then produces scholar.plugin via fflate.
// Uses fflate (Ruling #2, 2026-05-24) — imported at top of file.

async function step7_assemblePlugin(): Promise<void> {
  // Files to include in the archive: [src-abs-path, archive-relative-path]

  const manifest: [string, string][] = [
    ".claude-plugin/plugin.json",
    ".mcp.json",
    "build/scholar.exe",
    "build/scholar",
    "build/ui/app.html",
    `build/runtime/bun${env.dynamic({ win32: ".exe", default: "" })}`,
    `build/vendor/sqlite-vec/${VEC0}`,
    "nu/scholar.nu",
  ].map((p) => [util.subpath(p), p] as const)

  // Recursively collect all files from a directory into the manifest.
  // Used for pdf dist, slash commands, and skills — so frontends can add
  // a file without requiring a packaging revision.
  function collect(archBase: string): void {
    const srcBase = util.subpath(archBase)
    if (!existsSync(srcBase)) return // gracefully skip absent optional dirs
    for (const entry of readdirSync(srcBase, { withFileTypes: true })) {
      const srcPath = join(srcBase, entry.name)
      const archPath = archBase + "/" + entry.name
      if (entry.isDirectory()) {
        collect(archPath)
      } else {
        manifest.push([srcPath, archPath])
      }
    }
  }

  collect("build/vendor/pdf-server")
  // Slash commands + skills (frontends cycle 6.10).
  collect("commands")
  collect("skills")

  // Validate every source file exists before attempting zip.
  const missing = manifest.map(([src]) => src).filter((src) => !existsSync(src))
  if (missing.length > 0)
    return util.abort(
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
  mkdirSync(OUTPUT, { recursive: true })
  const primaryOut = join(OUTPUT, "scholar.plugin")
  await Bun.write(primaryOut, zipped)
  console.log(`scholar.plugin written to: ${primaryOut}`)

  // Best-effort secondary copy to COWORK_PLUGINS_DIR if set.
  const stagingEnv = env.static("COWORK_PLUGINS_DIR")

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
  const tag = `[${util.onfixture(() => "scholar-fixture", {
    default: () => "scholar",
  })}]`
  console.log(`${tag} plugin build`)
  assertVersionInvariant() // pre-flight: steps 4 ↔ 5 version match
  await step1_buildServer() // §14.1 step 1
  await step2_buildUI() // §14.1 step 2
  await step3_copyPdf() // §14.1 step 3
  await step4_copyRuntime() // §14.1 step 4
  await step5_copyVec() // §14.1 step 5 (also runs in fixture for vec0 check)
  await step6_copyNu() // §14.1 step 6
  await step7_assemblePlugin() // §14.1 step 7
  console.log(`${tag} build complete.`)
}

// Guard main() so the module can be imported by tests without triggering the
// build pipeline. import.meta.main is true only when this file is the entry point.
if (import.meta.main) {
  main().catch((e) => {
    process.stderr.write(`Unhandled build error: ${(e as Error).message}\n`)
    process.exit(1)
  })
}

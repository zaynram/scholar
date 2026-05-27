import { $ } from "bun"
import { Database } from "bun:sqlite"
import { join, basename } from "node:path"
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import util, { ROOT } from "./util"
import env from "./util/env"

const CC = env.static("CC")

// ── vec0 ABI probe ────────────────────────────────────────────────────────────
// Exported for unit testing. Returns true if extPath loads cleanly into an
// in-memory bun:sqlite DB (ABI matches Bun's bundled SQLite). Returns false
// on any error (ABI mismatch, corrupt file, missing symbols, etc.).

export function probeVec0Abi(extPath: string): boolean {
  try {
    const db = new Database(":memory:")
    db.loadExtension(extPath)
    db.close()
    return true
  } catch {
    return false
  }
}

// ── Compiler resolution ───────────────────────────────────────────────────────
// Resolves the C compiler to use for vec0 compile fallback. Handles both
// multi-word commands (e.g. "bun /path/to/stub.ts") and single-word binaries.
//
// Resolution order: CC env var → cc → gcc → clang (POSIX); CC env var → cl (Windows).
// Single-word CC values are verified with `which`; multi-word CC values (containing
// a space) are assumed to be script-based stub commands and used as-is without
// PATH verification — this supports test fixtures like CC="bun /path/to/stub-cc.ts".
//
// Returns { bin, args } or null if no compiler is found.

async function resolveCompiler(): Promise<{
  bin: string
  args: string[]
} | null> {
  if (CC) {
    // Destructuring ensures `bin` is `string` (not `string | undefined`).
    const [bin = "", ...prefixArgs] = CC.split(/\s+/)

    if (prefixArgs.length > 0) {
      // Multi-word CC (e.g., "bun /path/to/stub-cc.ts"): use as-is without which check.
      // This enables test fixtures that use Bun script stubs instead of a real C compiler.
      return { bin, args: prefixArgs }
    }

    // Single-word CC: verify the binary is findable on PATH before using it.
    const found = await $`which ${bin}`
      .text()
      .catch(() => "")
      .then((s: string) => s.trim())
    if (found) return { bin, args: [] }
    // CC is set but the binary wasn't found on PATH — fall through to system compilers.
  }

  async function inner(candidates: string[]) {
    for (const bin of candidates) {
      const found = await $`which ${bin}`
        .text()
        .catch(() => "")
        .then((s: string) => s.trim())
      if (found) return found
    }
  }

  const bin = env.dynamic({
    win32: await inner(["cc", "gcc", "clang"]),
    default: await inner(["cl"]),
  })

  return bin ? { bin, args: [] } : null
}

// ── vec0 compile-from-source fallback ────────────────────────────────────────
// Compiles sqlite-vec.c (the vendored amalgamation source, §7.2.1) against
// the vendored sqlite3.h + sqlite3ext.h pinned to Bun's bundled SQLite version.
// Caches the result at runtime/vendor/sqlite-vec/<libname> to skip recompile.
// Aborts with SCHOLAR_BUILD_NO_C_TOOLCHAIN if no C compiler is found.

export async function compileVec0FromSource(destPath: string): Promise<void> {
  const vecSrcDir = util.subpath("src/vendor/sqlite-vec")
  const vecSrc = join(vecSrcDir, "sqlite-vec.c")
  const sqliteH = join(vecSrcDir, "sqlite3.h")

  if (!existsSync(vecSrc) || !existsSync(sqliteH)) {
    util.abort(
      "SCHOLAR_BUILD_VEC_SOURCE_MISSING",
      `Vendored sqlite-vec source not found at ${vecSrcDir}. ` +
        "Foundation must vendor sqlite-vec.c + sqlite3.h alongside the prebuilt. " +
        "See the 'sqlite-vec source' row in the packaging plan's 'What this plan consumes' table.",
    )
  }

  // Stable cache location — avoids recompile on subsequent builds.
  const cacheDir = util.subpath("runtime/vendor/sqlite-vec")
  const libName = basename(destPath)
  const cachedLib = join(cacheDir, libName)
  if (existsSync(cachedLib)) {
    console.log(`Using cached compiled vec0 from ${cachedLib}`)
    copyFileSync(cachedLib, destPath)
    return
  }

  const compiler = await resolveCompiler()

  if (!compiler)
    return util.abort(
      "SCHOLAR_BUILD_NO_C_TOOLCHAIN",
      "vec0 prebuilt is ABI-mismatched or absent, and no C compiler " +
        "(cc, gcc, clang, or CC env var) is available. " +
        "Install a C toolchain or provide a matching prebuilt. " +
        "See docs/building-from-source.md for setup instructions.",
    )

  const { bin, args: prefixArgs } = compiler
  console.log(`Compiling vec0 from source using ${bin}...`)

  // Use Bun.spawn (not $`...`) so multi-word CC commands (bin + prefixArgs)
  // are passed as a proper argv array — $`${cc} -flag` treats the whole
  // interpolated string as a single argument (no shell word-splitting).
  const compileArgs = prefixArgs.concat(
    env
      .dynamic({
        win32: `/LD /I${vecSrcDir} ${vecSrc} /Fe:${destPath}`,
        default: `-shared -fPIC -I${vecSrcDir} ${vecSrc} -o ${destPath}`,
      })
      .split(` `),
  )

  const proc = Bun.spawn([bin, ...compileArgs], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const errText = await new Response(proc.stderr).text()
    util.abort(
      "SCHOLAR_BUILD_VEC_COMPILE_FAILED",
      `Compiling sqlite-vec.c failed (exit ${exitCode}):\n${errText}`,
    )
  }

  // Cache compiled artifact for subsequent builds.
  mkdirSync(cacheDir, { recursive: true })
  copyFileSync(destPath, cachedLib)
  console.log(`Compiled vec0 cached at ${cachedLib}`)
}

if (import.meta.main)
  compileVec0FromSource(util.subpath("build/vendor/sqlite-vec")).catch((e) => {
    const error =
      e instanceof Error ? `Unhandled compile error: ${e.message}\n` : String(e)
    process.stderr.write(error)
    process.exit(1)
  })

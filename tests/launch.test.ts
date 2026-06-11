// tests/launch.test.ts — launcher entry-resolution regression guard (Guard 3b).
//
// The committed source-sync manifest runs `bun ${CLAUDE_PLUGIN_ROOT}/bin/launch.mjs`
// on every OS. A source-sync install ships NO dist/, so the launcher MUST fall
// through to the TS entrypoint (src/server/index.ts) and let bun run it directly;
// a built bundle ships dist/server.js and the launcher must prefer it. If that
// fallback ever regressed (e.g. someone hard-coded dist/server.js), a no-dist
// install would die "provisioned bun not found"/"cannot find module" and never
// boot — the exact "source-sync launchable on Windows" guard the field pass needs.
//
// resolveEntry is pure and exported; the side-effectful launch sequence is gated
// by `import.meta.main` in launch.mjs, so importing it here does NOT trigger the
// provisioner or a server spawn. (That this import does not process.exit on the
// unset CLAUDE_PLUGIN_ROOT/DATA env is itself proof the guard holds.)
import { test, expect } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveEntry } from "../bin/launch.mjs"

test("resolveEntry: prefers dist/server.js when the built bundle is present", () => {
  const root = mkdtempSync(join(tmpdir(), "scholar-launch-dist-"))
  try {
    mkdirSync(join(root, "dist"), { recursive: true })
    writeFileSync(join(root, "dist", "server.js"), "// built bundle\n")
    expect(resolveEntry(root)).toBe(join(root, "dist", "server.js"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("resolveEntry: falls through to src/server/index.ts when no dist/ (source-sync install)", () => {
  const root = mkdtempSync(join(tmpdir(), "scholar-launch-src-"))
  try {
    // No dist/ — the source-sync ship tree. The launcher must hand bun the TS
    // entrypoint so it boots from source (auto-installing the import graph).
    expect(resolveEntry(root)).toBe(join(root, "src", "server", "index.ts"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

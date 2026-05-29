// src/server/db/sqlite-vec.test.ts — foundation cycle 6.1 (Task 1.3)
//
// Resolves the absolute path to the bundled vec0 shared library. Loading is the
// caller's responsibility — see loadVecAndProbeDim in primitives.ts.
import { test, expect } from "bun:test"
import { tmpdir } from "node:os"
import { resolveVec0Path } from "./sqlite-vec.ts"

test("resolveVec0Path returns absolute path with platform-correct extension", () => {
  const p = resolveVec0Path()
  expect(p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)).toBe(true)
  if (process.platform === "win32") expect(p).toMatch(/vec0\.dll$/)
  else if (process.platform === "darwin") expect(p).toMatch(/vec0\.dylib$/)
  else expect(p).toMatch(/vec0\.(so|dylib|dll)$/)
})

test("resolveVec0Path honors SCHOLAR_VEC0_PATH override when set", () => {
  process.env.SCHOLAR_VEC0_PATH = "/tmp/custom/vec0.so"
  try {
    expect(resolveVec0Path()).toBe("/tmp/custom/vec0.so")
  } finally {
    delete process.env.SCHOLAR_VEC0_PATH
  }
})

test("resolveVec0Path is independent of process.cwd() in dev mode", () => {
  // Audit H4: the dev fallback used to be process.cwd(), which meant tests or
  // server launches from anywhere other than the repo root resolved the wrong
  // (non-existent) path. The fix anchors to `import.meta.dir` so the path
  // depends on the source-file location, not the launch directory.
  delete process.env.SCHOLAR_VEC0_PATH
  const origPluginRoot = process.env.CLAUDE_PLUGIN_ROOT
  delete process.env.CLAUDE_PLUGIN_ROOT
  const origCwd = process.cwd()
  try {
    const before = resolveVec0Path()
    process.chdir(tmpdir())
    const after = resolveVec0Path()
    expect(after).toBe(before)
  } finally {
    process.chdir(origCwd)
    if (origPluginRoot !== undefined) process.env.CLAUDE_PLUGIN_ROOT = origPluginRoot
  }
})

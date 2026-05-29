// src/server/db/sqlite-vec.test.ts — foundation cycle 6.1 (Task 1.3)
//
// Resolves the absolute path to the bundled vec0 shared library. Loading is the
// caller's responsibility — see loadVecAndProbeDim in primitives.ts.
import { test, expect } from "bun:test"
import { tmpdir } from "node:os"
import { resolveVec0Path, toTightFloat32 } from "./sqlite-vec.ts"

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

test("toTightFloat32 returns tightly-packed input as-is (no copy) (M3)", () => {
  const tight = new Float32Array(4)
  tight[0] = 1
  expect(toTightFloat32(tight)).toBe(tight) // identity — no copy
})

test("toTightFloat32 copies view-over-larger-buffer into a fresh array (M3)", () => {
  // Audit M3: bun:sqlite binds the underlying ArrayBuffer for typed-array blobs,
  // so a view that's a slice of a larger buffer would otherwise bind the wrong
  // bytes. Verify the helper detects this and rebuilds a tight view.
  const big = new ArrayBuffer(16 * 4) // 16 floats backing
  const view = new Float32Array(big, 4 * 4, 4) // 4 floats starting at offset 16 bytes
  view[0] = 9
  view[1] = 8
  view[2] = 7
  view[3] = 6
  const tight = toTightFloat32(view)
  expect(tight).not.toBe(view)
  expect(tight.buffer.byteLength).toBe(tight.byteLength) // tightly packed now
  expect(Array.from(tight)).toEqual([9, 8, 7, 6])
})

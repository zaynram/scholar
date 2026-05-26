// src/server/db/sqlite-vec.test.ts — foundation cycle 6.1 (Task 1.3)
//
// Resolves the absolute path to the bundled vec0 shared library. Loading is the
// caller's responsibility — see loadVecAndProbeDim in primitives.ts.
import { test, expect } from "bun:test"
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

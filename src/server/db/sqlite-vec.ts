// src/server/db/sqlite-vec.ts — foundation cycle 6.1 (Task 1.3)
//
// Returns the absolute path to the bundled vec0 shared library. Loading is the
// caller's responsibility — see loadVecAndProbeDim in src/server/ingest/primitives.ts.
import { join } from "path"

export function getVec0Extension() {
  switch (process.platform) {
    case "win32":
      return "dll"
    case "darwin":
      return "dylib"
    default:
      return "so"
  }
}

/**
 * Resolution order:
 *   1. SCHOLAR_VEC0_PATH env override (test/CI/operator escape hatch)
 *   2. ${CLAUDE_PLUGIN_ROOT}/build/vendor/sqlite-vec/vec0.{dll,dylib,so}  (packaged)
 *   3. <repo>/build/vendor/sqlite-vec/vec0.{dll,dylib,so}                  (dev)
 */
export const resolveVec0Path = (): string =>
  process.env.SCHOLAR_VEC0_PATH ??
  join(
    process.env.SCHOLAR_VEC0_PATH ?? process.cwd(),
    "build",
    "vendor",
    "sqlite-vec",
    `vec0.${getVec0Extension()}`,
  )

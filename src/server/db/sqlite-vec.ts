// src/server/db/sqlite-vec.ts — foundation cycle 6.1 (Task 1.3)
//
// Returns the absolute path to the bundled vec0 shared library. Loading is the
// caller's responsibility — see loadVecAndProbeDim in src/server/ingest/primitives.ts.
import { join, resolve } from "node:path";

/**
 * Resolution order:
 *   1. SCHOLAR_VEC0_PATH env override (test/CI/operator escape hatch)
 *   2. ${CLAUDE_PLUGIN_ROOT}/build/vendor/sqlite-vec/vec0.{dll,dylib,so}  (packaged)
 *   3. <repo>/build/vendor/sqlite-vec/vec0.{dll,dylib,so}                  (dev)
 */
export function resolveVec0Path(): string {
  const override = process.env.SCHOLAR_VEC0_PATH;
  if (override) return override;
  const ext = process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so";
  const filename = `vec0.${ext}`;
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) return join(pluginRoot, "build", "vendor", "sqlite-vec", filename);
  // Dev layout: walk up from this file to repo root.
  return resolve(import.meta.dir, "..", "..", "..", "build", "vendor", "sqlite-vec", filename);
}

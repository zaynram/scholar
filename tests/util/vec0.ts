import { resolveVec0Path, getVec0Extension } from "#server/db/sqlite-vec"
import util from "^scripts/util"
import { existsSync } from "node:fs"

const ext = getVec0Extension()
const pkgPlatform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux'

// Resolves the vec0 binary for tests. Resolution order:
//   1. resolveVec0Path() — env override → build/vendor/ (provisioned or build script)
//   2. node_modules/sqlite-vec-{platform}-x64/ — available after `bun install`, before build
export const ensureVec0Path = (): string => {
  const resolved = resolveVec0Path()
  if (existsSync(resolved)) return resolved
  return util.subpath("node_modules", `sqlite-vec-${pkgPlatform}-x64`, `vec0.${ext}`)
}

import { getVec0Extension } from "#server/db/sqlite-vec"
import util from "^scripts/util"
export const ensureVec0Path = (): string =>
  process.env.SCHOLAR_VEC0_PATH ??
  util.subpath("runtime", "vendor", "sqlite-vec", `vec0.${getVec0Extension()}`)

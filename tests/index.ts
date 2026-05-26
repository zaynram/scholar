import { getVec0Extension } from "#server/db/sqlite-vec"
import { rel } from "&/"

export const ensureVec0Path = (): string =>
  process.env.SCHOLAR_VEC0_PATH ??
  rel("runtime", "vendor", "sqlite-vec", `vec0.${getVec0Extension()}`)

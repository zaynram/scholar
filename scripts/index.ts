import path from "node:path"
import { homedir } from "node:os"

const ROOT =
  process.env.CLAUDE_PLUGIN_ROOT ?? process.env.SCHOLAR_ROOT ?? process.cwd()

/** Prefix the parts with the project root and return the combined path. */
export const rel = (...parts: string[]): string => path.join(ROOT, ...parts)
/** Write an error message to stderr and exit with code 1. */
export const err = (code: string, msg: string): never => {
  process.stderr.write(`${code}: ${msg}\n`)
  process.exit(1)
}

export const flags = {
  FIXTURE: process.env.SCHOLAR_BUILD_FIXTURE === "1",
  COMPILE: process.env.SCHOLAR_VEC_FORCE_COMPILE === "1",
}

export const env = {
  WIN: process.platform === "win32",
  CC: process.env.CC?.trim(),
}

export const paths = {
  ROOT,
  OUTPUT:
    process.env.SCHOLAR_PLUGIN_OUT ??
    (env.WIN
      ? path.join(homedir(), "Documents", "Cowork", "System")
      : rel("out")),
}

export default { ...flags, ...paths, ...env }

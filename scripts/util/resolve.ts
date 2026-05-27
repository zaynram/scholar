import { existsSync } from "node:fs"
import path from "node:path"

let ROOT: string | null =
  process.env.CLAUDE_PLUGIN_ROOT ??
  process.env.SCHOLAR_ROOT ??
  process.env.__dirname ??
  null

export function resolveRoot(): string {
  if (!ROOT) {
    const segments: string[] = []
    function advance() {
      const target = path.resolve(...segments, ".git")
      segments.push("..")
      return target
    }

    function shouldContinue(p: string) {
      const parsed = path.parse(p)
      return parsed.dir !== parsed.root
    }

    let test = advance()
    while (shouldContinue(test)) {
      if (existsSync(test)) {
        ROOT = path.dirname(test)
        break
      }
      test = advance()
      if (process.env.DEBUG) console.log(`test=${test}`)
    }
  }
  if (!ROOT) throw Error("unable to resolve project root")
  else return ROOT
}

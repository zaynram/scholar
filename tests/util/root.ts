import { existsSync } from "node:fs"
import path from "node:path"

const segments: string[] = [".."]
function advance() {
  segments.push("..")
  return path.resolve(...segments, ".git")
}
function shouldContinue(p: string) {
  const parsed = path.parse(p)
  return parsed.dir !== parsed.root
}
export let root: string | null = null
let test = advance()
while (shouldContinue(test)) {
  if (existsSync(test)) {
    root = path.dirname(test)
    break
  }
  test = advance()
  console.log(`test=${test}`)
}
if (!root) throw Error("unable to resolve project root")

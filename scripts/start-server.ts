import util from "./util"
import env from "./util/env"

async function main() {
  const bin = util.subpath(
    "build",
    `scholar${env.dynamic({ win32: ".exe", default: "" })}`,
  )
  const child = Bun.spawn([bin, ...process.argv.slice(2)], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  // Forward SIGINT so the child gets a chance to clean up; the parent then
  // mirrors whatever exit code the child reports (130 for an untrapped
  // signal, or any explicit code the child sets). The pre-S2 wrapper
  // exited 0 here, masking the child's status on Ctrl-C.
  process.on("SIGINT", () => child.kill("SIGINT"))
  process.exit(await child.exited)
}

if (import.meta.main)
  main().catch((e) => {
    process.stderr.write(
      `server exited with errors: ${e instanceof Error ? e.message : String(e)}`,
    )
    process.exit(1)
  })

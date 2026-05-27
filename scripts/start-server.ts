import util from "./util"
import env from "./util/env"

async function main() {
  process.on("SIGINT", () => process.exit(0))
  const bin = util.subpath(
    "build",
    `scholar${env.dynamic({ win32L: ".exe", default: "" })}`,
  )
  await Bun.$`${bin}`.nothrow()
}

if (import.meta.main)
  main().catch((e) =>
    process.stderr.write(
      `server exited with errors: ${e instanceof Error ? e.message : String(e)}`,
    ),
  )

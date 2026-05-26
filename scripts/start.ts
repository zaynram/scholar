import { rel, env } from "&/"

async function main() {
  process.on("SIGINT", () => process.exit(0))
  const bin = rel("build", `scholar${env.WIN ? ".exe" : ""}`)
  process.stdout.write(`$ ${bin}\n`)
  await Bun.$`${bin}`.nothrow()
}

if (import.meta.main) main()

// scripts/vendor-pdf-server.ts — foundation cycle 6.2 (Task 2.1)
//
// Re-vendor helper. Installs `@modelcontextprotocol/server-pdf@<VERSION>` into
// an isolated staging project, then copies dist/ + package.json into
// src/vendor/pdf-server/ UNMODIFIED. PRESERVES UPSTREAM-LICENSE (created by
// chore license-audit-vendored-pdf-server, commit 340ceb1).
//
// `bun pm pack` packs the CURRENT project, not an external package, so this
// helper uses `bun add` in a throwaway staging dir instead.
import { $ } from "bun";
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "1.7.2";
const REPO_ROOT = join(import.meta.dir, "..");
const DEST = join(REPO_ROOT, "src", "vendor", "pdf-server");

async function main(): Promise<void> {
  const tmp = join(REPO_ROOT, "build", "_vendor-stage");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  // Seed a minimal package.json so `bun add` has something to write to.
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({ name: "_vendor-stage", version: "0.0.0", type: "module", dependencies: {} }, null, 2),
  );

  await $`bun add @modelcontextprotocol/server-pdf@${VERSION}`.cwd(tmp).quiet();

  const stagedPkg = join(tmp, "node_modules", "@modelcontextprotocol", "server-pdf");
  if (!existsSync(stagedPkg)) {
    throw new Error(`bun add did not produce ${stagedPkg}`);
  }

  // PRESERVE UPSTREAM-LICENSE (from chore license-audit-vendored-pdf-server,
  // commit 340ceb1). Clean dist/ + package.json only; leave the license intact.
  rmSync(join(DEST, "dist"), { recursive: true, force: true });
  rmSync(join(DEST, "package.json"), { force: true });
  mkdirSync(DEST, { recursive: true });
  cpSync(join(stagedPkg, "dist"), join(DEST, "dist"), { recursive: true });
  cpSync(join(stagedPkg, "package.json"), join(DEST, "package.json"));

  console.log(`vendored @modelcontextprotocol/server-pdf@${VERSION} → ${DEST}`);
  console.log("now run: bun test src/server/pdf/lifecycle.test.ts");
}

main();

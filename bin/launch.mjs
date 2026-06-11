// bin/launch.mjs — cross-OS MCP launcher for the source-sync (cowork-marketplace)
// install AND the built per-OS .plugin/.mcpb bundles (one launcher, all targets).
//
// The marketplace installs by copy-only and serves ONE committed manifest to
// every OS, so the launcher cannot be a per-OS shell script — it must invoke a
// single command present on all hosts. `bun` is that command: the rest of these
// servers already depend on a system-wide bun install, so requiring it here is
// consistent with that convention (and it sidesteps the "use bundled node"
// Claude Desktop option that has since been removed from settings). bun runs
// this `.mjs` directly under its node-compat runtime (process.argv,
// process.platform, node:child_process all work).
//
// KEYSTONE ASSUMPTION: `bun` must be on PATH at MCP spawn. On POSIX the host's
// execvp resolves a bare `bun` against PATH; on Windows, CreateProcess does NOT
// search PATH the same way, so a bare `bun` resolves only if the host passes a
// PATH-aware environment to the spawn. The Claude Desktop spawn env is the most
// locked-down, so bun-on-PATH at Desktop MCP spawn is the dominant unproven risk
// and must be validated on Windows hardware.
//
// The on-PATH bun that runs THIS shim need NOT be the pinned ABI version: it
// only executes launch.mjs. The shim then PROVISIONS the pinned bun (vec0-ABI
// matched, see ensure-bun) and SPAWNS *that* bun as a child with stdio:"inherit"
// to run the server. The MCP JSON-RPC stream therefore flows client <-> pinned
// bun directly on fd 0/1; the launcher bun never touches the protocol bytes. The
// F1 graceful-teardown invariant (makeServerTeardown: stdin-EOF / SIGINT /
// SIGTERM) holds on the PRIMARY path because the child inherits fd0 and sees the
// client's stdin-close EOF itself. The signal forwarding below is a secondary
// net (Windows has no catchable SIGTERM; graceful shutdown there rides the
// stdin-EOF path, and a hard kill only leaves a pidfile reclaimed on next start
// via pid-liveness).
//
// Modes:
//   bun launch.mjs                  provision bun, then run the server
//   bun launch.mjs --provision-only pre-warm bun and exit (SessionStart hook)
//
// STRUCTURE: the side-effectful launch sequence (env reads, provision, spawn) is
// wrapped in `main()` and gated by `import.meta.main`, so launch.test.ts can
// `import { resolveEntry }` to assert entry resolution WITHOUT triggering the
// provisioner or a server spawn. When the host runs `bun bin/launch.mjs`,
// launch.mjs IS the entry → import.meta.main is true → main() runs unchanged.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const isWin = process.platform === "win32";
const die = (msg) => {
  process.stderr.write(`launch.mjs: ${msg}\n`);
  process.exit(1);
};

// Resolve the server entrypoint. The built bundle (dist/server.js) wins if
// present; source-sync has no dist/, so it falls through to the TS entrypoint
// bun runs directly (auto-installing the reached import graph into BUN_INSTALL's
// cache on first call). Pure (no env, no spawn, no exit) so it is unit-testable
// in isolation — the side-effectful sequence lives in main(), below.
export function resolveEntry(root) {
  return existsSync(join(root, "dist", "server.js"))
    ? join(root, "dist", "server.js")
    : join(root, "src", "server", "index.ts");
}

function main() {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  const data = process.env.CLAUDE_PLUGIN_DATA;
  if (!root) die("CLAUDE_PLUGIN_ROOT is unset");
  if (!data) die("CLAUDE_PLUGIN_DATA is unset");

  // ── 1. Provision the pinned bun runtime (synchronous correctness gate) ─────
  // Delegates to the same ensure-bun.{sh,ps1} the built bundles use. ALL of the
  // provisioner's output is mapped to OUR stderr (the stdio integer `2` shares
  // the parent's fd 2): stdout (fd 1) stays clean for the JSON-RPC stream the
  // child bun will own.
  const provision = isWin
    ? spawnSync(
        "powershell",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "bin", "ensure-bun.ps1")],
        { stdio: ["ignore", 2, 2], windowsHide: true },
      )
    : spawnSync("sh", [join(root, "bin", "ensure-bun.sh")], { stdio: ["ignore", 2, 2] });
  if (provision.error) die(`failed to launch provisioner: ${provision.error.message}`);
  if (provision.status !== 0) die(`provisioner exited with status ${provision.status}`);

  if (process.argv.includes("--provision-only")) process.exit(0);

  // ── 2. Resolve bun + the server entrypoint ─────────────────────────────────
  const bun = join(data, "bun", isWin ? "bun.exe" : "bun");
  if (!existsSync(bun)) die(`provisioned bun not found at ${bun}`);
  const entry = resolveEntry(root);

  // ── 3. Cross-OS env defaults derived from the REAL env var ─────────────────
  // CLAUDE_PLUGIN_DATA persists across plugin updates and is set on every host,
  // so it is the correct cross-OS anchor for both the bun auto-install cache and
  // runtime state. We derive these in JS (not via manifest ${...} interpolation)
  // so the manifest needs no CLAUDE_PLUGIN_DATA expansion. An already-set value
  // (manifest env or user shell) wins.
  const env = { ...process.env };
  if (!env.BUN_INSTALL) env.BUN_INSTALL = join(data, "bun-cache");
  if (!env.SCHOLAR_RUNTIME_ROOT) env.SCHOLAR_RUNTIME_ROOT = join(data, "runtime");

  // ── 4. Spawn bun. stdio:"inherit" → client <-> bun own fd 0/1 directly. ────
  const passthrough = process.argv.slice(2).filter((a) => a !== "--provision-only");
  const child = spawn(bun, [entry, ...passthrough], {
    stdio: "inherit",
    cwd: root,
    env,
    windowsHide: true,
  });

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      try {
        child.kill(sig);
      } catch {
        /* child already gone */
      }
    });
  }
  child.on("error", (err) => die(`failed to spawn bun: ${err.message}`));
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}

if (import.meta.main) main();

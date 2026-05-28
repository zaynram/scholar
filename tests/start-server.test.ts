// tests/start-server.test.ts — S2 roadmap batch
//
// Two regressions in scripts/start-server.ts the audit caught:
//   1. argv is NOT forwarded to the compiled binary, so `scholar --help`
//      and every other CLI flag silently degrade to stdio-server mode.
//   2. The SIGINT handler exits 0 before the child observes the signal,
//      masking the child's exit code on Ctrl-C.
//
// Both tests spawn scripts/start-server.ts against a fixture SCHOLAR_ROOT
// containing a stub `build/scholar` binary (a chmod +x bun script). The
// stub is the regression-mock equivalent of the real compiled binary:
// it lives one layer below the defect (it observes argv + signals so the
// wrapper's bugs are visible at the test boundary).
import { test, expect, beforeAll, afterAll } from "bun:test"
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import util from "^scripts/util"

// Stub binary: a self-contained bun script the OS execs via shebang.
// - `--help` exits 0 with a marker on stdout (proves argv was forwarded).
// - `--block` installs a SIGINT handler that exits 42, prints READY so
//   the test can race-safely wait until the handler is installed, then
//   blocks forever via setInterval until SIGINT arrives.
const STUB_BINARY = `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args.includes("--help")) {
  process.stdout.write("scholar --help stub\\n");
  process.exit(0);
}
if (args.includes("--block")) {
  process.on("SIGINT", () => process.exit(42));
  process.stdout.write("READY\\n");
  setInterval(() => {}, 60_000);
} else {
  process.exit(0);
}
`

let FIXTURE_ROOT: string

beforeAll(() => {
  FIXTURE_ROOT = mkdtempSync(join(tmpdir(), "scholar-start-server-"))
  mkdirSync(join(FIXTURE_ROOT, "build"), { recursive: true })
  // The wrapper resolves the binary as build/scholar (POSIX) / build/scholar.exe (win32).
  // This test fixture targets POSIX; Windows uses a different binary suffix and
  // does not honor shebangs, so the suite is implicitly POSIX-only.
  const binPath = join(FIXTURE_ROOT, "build/scholar")
  writeFileSync(binPath, STUB_BINARY)
  chmodSync(binPath, 0o755)
})

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
})

function spawnStartServer(args: string[]) {
  return Bun.spawn(
    [process.execPath, util.subpath("scripts/start-server.ts"), ...args],
    {
      env: {
        ...process.env,
        SCHOLAR_ROOT: FIXTURE_ROOT,
        CLAUDE_PLUGIN_ROOT: FIXTURE_ROOT,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
}

test("start-server forwards argv to the child binary (--help reaches the child)", async () => {
  const proc = spawnStartServer(["--help"])
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  expect(exitCode, `non-zero exit\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(
    0,
  )
  expect(
    stdout,
    "expected the stub binary's --help marker on stdout; got empty/wrong output, meaning argv didn't reach the child",
  ).toContain("scholar --help stub")
})

test("start-server propagates the child's exit code on SIGINT (not 0)", async () => {
  const proc = spawnStartServer(["--block"])
  // Race-safe: wait for the stub to print READY before sending SIGINT.
  // Otherwise SIGINT may land before the stub installs its handler, and
  // the child exits with the default 130 instead of the asserted 42.
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let ready = false
  while (!ready) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    if (buf.includes("READY")) ready = true
  }
  reader.releaseLock()
  expect(ready, "stub never printed READY — start-server failed to spawn it").toBe(true)

  proc.kill("SIGINT")
  const exitCode = await proc.exited
  expect(
    exitCode,
    "expected the parent to propagate the child's exit code 42; got 0 means the wrapper swallowed SIGINT",
  ).toBe(42)
})

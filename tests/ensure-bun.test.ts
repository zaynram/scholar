// tests/ensure-bun.test.ts — Windows provisioner regression guard.
//
// PRIMARY BUG (Cowork Windows field finding, 2026-06-10): bin/ensure-bun.ps1's
// version probe used the PowerShell call operator `& $BunBin --version`. Under
// launch.mjs's detached/no-console spawn (bin/launch.mjs:56-61 —
// spawnSync("powershell", ["-NoProfile","-ExecutionPolicy","Bypass","-File",ps1],
// { stdio:["ignore",2,2], windowsHide:true })) PowerShell refuses to activate a
// native .exe in the pipeline (CantActivateDocumentInPipeline) and `& $BunBin`
// yields EMPTY. So Test-Ok reported "not provisioned" even for a VALID pinned
// bun, and every launch re-downloaded ~110 MB — overrunning the 30 s MCP connect
// budget ("connection timed out after 30000ms"). The --provision-only
// SessionStart pre-warm shares the same script and is fixed by the same change.
// Fix: route the version probe AND the success-log through `cmd /c`, which
// invokes the exe via the command interpreter (no activation restriction). POSIX
// ensure-bun.sh uses $(...) capture and is unaffected (Windows-only bug).
import { test, expect } from "bun:test"
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const PS1 = join(import.meta.dir, "..", "bin", "ensure-bun.ps1")
const PIN = "1.3.11" // keep in sync with package.json scholar.bundledBunVersion

// ── Static guard — runs on EVERY host (incl. the Linux dev box / CI) ──────────
// The behavioral test below only runs on win32 hardware, so this content guard
// is the load-bearing, Linux-verifiable assertion. It pins the FORM of the fix:
// no bun invocation may use the bare PS call operator `& $BunBin` (the defect),
// and every --version read must route through `cmd /c`.
test("ensure-bun.ps1 reads bun --version via `cmd /c`, never the PS call operator `& $BunBin` (detached-spawn empty-probe regression)", () => {
  const src = readFileSync(PS1, "utf8")
  // Strip full-line PS comments (`#...`) before asserting: the doc comments
  // legitimately NAME the defect form (`& $BunBin`) to explain why the fix
  // exists, so the guard must target executable code, not prose.
  const code = src
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n")
  // Assert the DEFECT form is ABSENT from code. More robust than merely
  // asserting `cmd /c` is present: it fails if a future edit reintroduces an
  // `& $BunBin ...` invocation — the probe (Test-Ok) OR the success-log line.
  expect(code).not.toMatch(/&\s*\$BunBin/)
  // And positively: every bun version read goes through the cmd interpreter.
  expect(code).toMatch(/cmd \/c .*\$BunBin.*--version/)
})

// ── Behavioral guard — win32 ONLY (skipped on the Linux dev host / CI) ─────────
// Reproduces the field repro at the real entry path: a VALID pinned bun is
// present, yet the host's detached spawn re-launches the provisioner. On the
// buggy probe Test-Ok falsely returns false → it re-provisions (prints
// "provisioning bun", re-downloads, slow). On the fixed probe Test-Ok returns
// true → exit 0, fast, no provisioning. UNEXECUTED on this Linux host — it is a
// guard for Windows hardware / CI only.
function bunVersionViaCmd(exe: string): string | null {
  // Mirror Test-Ok's FIXED probe exactly: invoke via cmd /c (works detached).
  const r = spawnSync("cmd", ["/c", `"${exe}" --version`], { encoding: "utf8" })
  if (r.status !== 0) return null
  return (r.stdout ?? "").trim().split(/\r?\n/)[0] ?? null
}

function runProvisionerDetached(dataDir: string) {
  // EXACT mirror of launch.mjs's host spawn (bin/launch.mjs:56-61): no console,
  // stdin ignored, windowsHide — the precise condition that emptied the probe.
  // stdout/stderr are PIPEd (vs the host's fd 2) only so the test can assert on
  // stderr; the console-attachment state the bug depends on is unchanged.
  return spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PS1],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir },
      encoding: "utf8",
    },
  )
}

test.skipIf(process.platform !== "win32")(
  "ensure-bun.ps1: valid pinned bun present → detached re-launch exits 0 in <5s and does NOT re-provision",
  () => {
    const dataDir = mkdtempSync(join(tmpdir(), "scholar-ensure-bun-"))
    try {
      const bunDir = join(dataDir, "bun")
      mkdirSync(bunDir, { recursive: true })
      const stagedBun = join(bunDir, "bun.exe")

      // Seed a valid pinned bun. Prefer copying the host-provisioned one to skip
      // a 110 MB download; otherwise let a one-time warm-up run provision it.
      const hostData = process.env.CLAUDE_PLUGIN_DATA
      const hostBun = hostData ? join(hostData, "bun", "bun.exe") : undefined
      if (hostBun && existsSync(hostBun) && bunVersionViaCmd(hostBun) === PIN) {
        copyFileSync(hostBun, stagedBun)
      } else {
        const warm = runProvisionerDetached(dataDir)
        expect(warm.status).toBe(0) // first run provisions (may download)
      }
      // Precondition: a valid pinned bun is now present at the expected path.
      expect(bunVersionViaCmd(stagedBun)).toBe(PIN)

      // MEASURED run: the host's exact detached spawn with the pinned bun in
      // place. Buggy probe → re-provisions (slow + "provisioning bun"); fixed
      // probe → Test-Ok true → exit 0 fast, silent.
      const t0 = performance.now()
      const r = runProvisionerDetached(dataDir)
      const elapsedMs = performance.now() - t0

      expect(r.status).toBe(0)
      // 5 s, not 2 s: a no-op probe on Windows CI (cold process spawn + AV scan +
      // slower FS) can blow past 2 s without re-downloading. A real re-provision
      // pulls ~110 MB — far above 5 s — so the bound still positively distinguishes
      // "Test-Ok true, fast exit" from "Test-Ok false, re-download", and stays well
      // under the 30 s MCP connect budget the fix exists to protect.
      expect(elapsedMs).toBeLessThan(5000)
      expect(String(r.stderr ?? "")).not.toContain("provisioning bun")
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  },
)

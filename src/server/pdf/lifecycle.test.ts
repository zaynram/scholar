// src/server/pdf/lifecycle.test.ts — foundation cycle 6.2 (Task 2.2)
//
// The drift-canary fixture suite per §16. Gating is by COST, not by importance:
//
//   • Fixtures 1–3 (spawn → roots/list → list_changed) are protocol-shape: they
//     start the child and exercise the roots responder + mutation path WITHOUT
//     opening a PDF. Cheap and deterministic, so they ALWAYS run (local + CI).
//   • Fixtures 4 + 6 do a real PDF round-trip (display_pdf) / a SIGKILL+respawn
//     timing window. Heavier and spawn-flakier, so they gate behind
//     SCHOLAR_PDF_E2E=1 — kept out of the fast default `bun test`, run in CI's
//     dedicated e2e job. NB: fixture 4 asserts viewUUID survival via
//     interact({navigate}), NOT get_text — get_text needs a live browser viewer
//     and hangs headless (see lifecycle.contract.test.ts "Why no C3 for get_text?").
//   • Fixture 5 (Windows Job Object) is a test.todo pending a Win32 CI rig.
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  spawnPdfChild,
  sanitizeRoots,
  buildClientCapabilities,
  type PdfChildHandle,
} from "./lifecycle.ts";
import { makeFixtureRoot } from "%/util/pdf-fixture";

let handle: PdfChildHandle | undefined;
let tmpRoot: string | undefined;

afterEach(async () => {
  if (handle) {
    await handle.shutdown();
    handle = undefined;
  }
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  }
});

function makeTempPdfRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "scholar-pdf-root-"));
  mkdirSync(join(dir, "papers"), { recursive: true });
  // Tiny valid PDF — single-page magic + header. The fixture only needs the
  // upstream to see a discoverable file; full PDF parsing is the child's job.
  writeFileSync(join(dir, "papers", "fixture.pdf"), Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
  return dir;
}

const E2E = process.env.SCHOLAR_PDF_E2E === "1";

// =========================================================================
// PURE-LOGIC FIXTURES (no spawn — always run)
// =========================================================================

test("buildClientCapabilities advertises roots.listChanged=true (load-bearing per §7.2)", () => {
  const caps = buildClientCapabilities();
  expect(caps.roots).toBeDefined();
  expect(caps.roots!.listChanged).toBe(true);
});

test("sanitizeRoots dedupes, resolves symlinks, and drops missing paths", () => {
  const a = mkdtempSync(join(tmpdir(), "scholar-srt-a-"));
  const b = mkdtempSync(join(tmpdir(), "scholar-srt-b-"));
  try {
    // Duplicate, non-absolute, missing — all should be filtered.
    const out = sanitizeRoots([a, a, b, "relative/path", "/does/not/exist-xyz"]);
    expect(out).toEqual([realpathSync(a), realpathSync(b)]);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

// =========================================================================
// FIXTURE 1: Spawn lifecycle — child starts, initializes, exposes a healthy handle.
// =========================================================================
test("FIXTURE 1 — spawn lifecycle: child initializes and reports healthy", async () => {
  tmpRoot = makeTempPdfRoot();
  handle = await spawnPdfChild({ initialRoots: [tmpRoot] });
  const health = handle.isHealthy();
  expect(health.alive).toBe(true);
  expect(health.stdioOpen).toBe(true);
});

// =========================================================================
// FIXTURE 2: roots/list responder — scholar replies with currentRoots as file:// URIs.
// =========================================================================
test(
  "FIXTURE 2 — roots/list responder: returns currentRoots as file:// URIs on demand",
  async () => {
    tmpRoot = makeTempPdfRoot();
    handle = await spawnPdfChild({ initialRoots: [tmpRoot] });
    await handle.refreshChildRoots();
    expect(handle.currentRoots()).toEqual([realpathSync(tmpRoot)]);
  },
);

// =========================================================================
// FIXTURE 3: list_changed round-trip — setRoots mutates without respawn.
// =========================================================================
test("FIXTURE 3 — list_changed round-trip: setRoots mutates without respawn", async () => {
  tmpRoot = makeTempPdfRoot();
  const secondRoot = mkdtempSync(join(tmpdir(), "scholar-pdf-root2-"));
  try {
    handle = await spawnPdfChild({ initialRoots: [tmpRoot] });
    const pidBefore = handle.childPid();
    await handle.setRoots([tmpRoot, secondRoot]);
    const pidAfter = handle.childPid();
    expect(pidAfter).toBe(pidBefore); // NO respawn
    expect(handle.currentRoots().sort()).toEqual(
      [realpathSync(tmpRoot), realpathSync(secondRoot)].sort(),
    );
  } finally {
    rmSync(secondRoot, { recursive: true, force: true });
  }
});

// =========================================================================
// FIXTURE 4: viewUUID survival across root mutation (heavy — E2E only).
// =========================================================================
test.skipIf(!E2E)("FIXTURE 4 — viewUUID survives across a root mutation", async () => {
  // Open a real PDF, mutate the root set, then prove the original viewUUID is
  // still addressable. Survival is asserted via interact({navigate}) — a
  // fire-and-ack wire op that round-trips headless. The earlier form called
  // handle.getText(), which requires a live browser viewer to answer; headless
  // it enqueues to the vendor's poll queue and never returns, so the test hung
  // to its timeout (see lifecycle.contract.test.ts "Why no C3 for get_text?").
  // Uses a VALID minimal PDF (makeFixtureRoot) — the vendor's display_pdf
  // rejects the synthetic header blob the spawn-only fixtures use.
  const fix = makeFixtureRoot();
  tmpRoot = fix.root;
  handle = await spawnPdfChild({ initialRoots: [fix.root] });

  // §13 v1.1 wire envelope: display_pdf is a separate vendor tool, NOT an
  // interact action. Use handle.displayPdf() — the dedicated method.
  const { viewUUID } = await handle.displayPdf(fix.pdf);
  expect(typeof viewUUID).toBe("string");

  const secondRoot = mkdtempSync(join(tmpdir(), "scholar-pdf-root3-"));
  try {
    await handle.setRoots([fix.root, secondRoot]);
    // The root mutation must not drop the open view: a navigate against the
    // pre-mutation viewUUID still round-trips (vendor returns null on success).
    await expect(
      handle.interact({ type: "navigate", page: 1 }, { viewUUID }),
    ).resolves.toBeDefined();
  } finally {
    rmSync(secondRoot, { recursive: true, force: true });
  }
});

// =========================================================================
// FIXTURE 5: Job Object kills child when scholar dies (Windows only).
// =========================================================================
// test.todo, NOT a passing placeholder: the prior `expect(true).toBe(true)` on
// win32 reported a vacuous green for a behavior that is never actually verified.
// Implement once a Win32 CI rig exists — spawn under attachJobObject, SIGKILL
// the parent, then assert the child is gone (process.kill(childPid, 0) throws
// ESRCH). Tracked in docs/audits/ROADMAP.md.
test.todo("FIXTURE 5 — Job Object reaps the orphan child on parent SIGKILL (win32)", () => {});

// =========================================================================
// FIXTURE 6: Supervised respawn (heavy — E2E only).
// =========================================================================
test.skipIf(!E2E)(
  "FIXTURE 6 — supervised respawn: setRoots survives a child SIGKILL",
  async () => {
    tmpRoot = makeTempPdfRoot();
    handle = await spawnPdfChild({ initialRoots: [tmpRoot] });
    const pidBefore = handle.childPid();
    expect(pidBefore).toBeDefined();
    process.kill(pidBefore!, "SIGKILL");

    // Respawn is asynchronous and has NO fixed duration: the supervisor waits
    // BACKOFF_MS[0]=1s after onclose, then spawns a fresh child AND completes an
    // MCP re-handshake before activePid flips (lifecycle.ts childPid → activePid).
    // That total (1s backoff + spawn + handshake) intermittently exceeds a fixed
    // sleep and varies with bun version / host load — a 1.5s sleep flaked 2-of-3
    // under the CI-pinned bun 1.3.11. Poll for the new PID instead of guessing a
    // duration; the explicit test timeout below (not bun's 5s default) bounds a
    // genuine hang.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const pid = handle.childPid();
      if (pid !== undefined && pid !== pidBefore && handle.isHealthy().alive) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(handle.currentRoots()).toEqual([realpathSync(tmpRoot)]);
    const h = handle.isHealthy();
    expect(h.alive).toBe(true);
    expect(handle.childPid()).not.toBe(pidBefore);
  },
  20_000,
);

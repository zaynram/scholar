// src/server/session-lock.test.ts — "single active session" invariant (INV-1).
//
// acquireSessionLock guards runServer ONLY (runCli is intentionally lock-free —
// Bug #2b runs many concurrent `--call` processes). These tests pin the function
// contract directly; the runServer wiring (process-exit cleanup, host-close
// release) is exercised by reasoning + the suite staying green, since a live
// stdio server can't be driven in-process.
//
// The paths that actually matter (per design review) are the dead-pid stale
// reclaim — the SIGKILL-leak recovery path — and idempotent release, NOT the
// trivial fresh-acquire/contended-throws cases.
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireSessionLock, SESSION_LOCK_FILENAME } from "./session-lock.ts";

function withTmp(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "scholar-lock-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("acquires on a fresh runtime root and records our pid", () => {
  withTmp((dir) => {
    const release = acquireSessionLock(dir);
    try {
      const lockPath = join(dir, SESSION_LOCK_FILENAME);
      expect(existsSync(lockPath)).toBe(true);
      expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
    } finally {
      release();
    }
  });
});

test("a second acquire while held throws SCHOLAR_LOCKED with an actionable message", () => {
  withTmp((dir) => {
    const release = acquireSessionLock(dir);
    try {
      let caught: (Error & { errorCode?: string }) | undefined;
      try {
        acquireSessionLock(dir);
      } catch (e) {
        caught = e as Error & { errorCode?: string };
      }
      expect(caught?.errorCode).toBe("SCHOLAR_LOCKED");
      // pid-reuse remediation: the message must name the file and how to recover.
      expect(caught?.message).toContain(join(dir, SESSION_LOCK_FILENAME));
      expect(caught?.message).toMatch(/remove/i);
    } finally {
      release();
    }
  });
});

test("release frees the lock and is idempotent; re-acquire succeeds", () => {
  withTmp((dir) => {
    const release = acquireSessionLock(dir);
    release();
    expect(existsSync(join(dir, SESSION_LOCK_FILENAME))).toBe(false);
    release(); // second call must not throw
    // Lock is free again.
    const release2 = acquireSessionLock(dir);
    release2();
  });
});

test("reclaims a stale lock whose recorded pid is dead", () => {
  withTmp((dir) => {
    const lockPath = join(dir, SESSION_LOCK_FILENAME);
    // 2147483646 is effectively never a live pid → kill(pid,0) → ESRCH (dead).
    writeFileSync(lockPath, "2147483646\n");
    const release = acquireSessionLock(dir);
    try {
      expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
    } finally {
      release();
    }
  });
});

test("treats an unparseable lockfile as stale and reclaims", () => {
  withTmp((dir) => {
    const lockPath = join(dir, SESSION_LOCK_FILENAME);
    writeFileSync(lockPath, "not-a-pid\n");
    const release = acquireSessionLock(dir);
    try {
      expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
    } finally {
      release();
    }
  });
});

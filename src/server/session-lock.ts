// src/server/session-lock.ts — "single active session" invariant (INV-1).
//
// The long-lived stdio server must be the only one holding a given runtime root
// (it opens corpus DBs in WAL, spawns the pdf child, owns the lock file). This
// guards runServer ONLY — runCli (`--call`) is single-shot and intentionally
// allows many concurrent processes (Bug #2b reopens the persisted corpus per
// call), so it never takes this lock.
//
// MECHANISM FORK (made explicit per design review): the spec's literal word is
// "flock", and bin/ensure-bun.sh uses flock(1) for its *provisioning* guard. An
// flock held by the launcher would auto-release on death — fd close, even on
// SIGKILL — eliminating stale recovery entirely. We instead use a TS pidfile
// because:
//   - a dev `bun run src/server/index.ts` bypasses the shell launcher;
//   - win32 (a shipped target) has no flock — ensure-bun.ps1 already falls back
//     to an atomic lock-dir for the same reason.
// The cost we knowingly take on is hand-rolled stale-reclaim: a pidfile does NOT
// auto-release on SIGKILL, so a crashed server leaves the file behind. We
// reclaim it by probing the recorded pid's liveness. The residual hazard is pid
// reuse (a dead holder's pid recycled to an unrelated live process reads as
// "alive" → refuse to start). That trade is only net-positive because the
// SCHOLAR_LOCKED error is self-rescuing: it names the file and how to recover.
import { mkdirSync, openSync, writeSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const SESSION_LOCK_FILENAME = "scholar.lock";

function lockPathFor(runtimeRoot: string): string {
  return join(runtimeRoot, SESSION_LOCK_FILENAME);
}

/** True if `pid` names a process we can see (i.e. a live holder). */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false; // unparseable/invalid → dead
  try {
    process.kill(pid, 0); // signal 0: existence probe, delivers nothing
    return true;
  } catch (e) {
    // ESRCH → no such process (dead, reclaim it). EPERM → exists but not ours (live).
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function lockedError(path: string, holder: string): Error & { errorCode: string } {
  const err = new Error(
    `SCHOLAR_LOCKED: another scholar session holds ${path} (pid ${holder}). ` +
      `If no scholar server is running, remove that file to recover.`,
  ) as Error & { errorCode: string };
  err.errorCode = "SCHOLAR_LOCKED";
  return err;
}

/**
 * Acquire the single-active-session lock for `runtimeRoot`. Non-blocking: fails
 * fast rather than waiting for the holder to exit. Returns an idempotent release
 * function (safe to register on multiple exit paths). Throws an error carrying
 * `errorCode: "SCHOLAR_LOCKED"` when a LIVE process already holds the lock; a
 * lock left by a dead process (e.g. SIGKILL) is reclaimed automatically.
 */
export function acquireSessionLock(runtimeRoot: string): () => void {
  mkdirSync(runtimeRoot, { recursive: true });
  const path = lockPathFor(runtimeRoot);

  // Bounded retry: reclaiming a stale lock can race a peer reclaiming the same
  // file. A persistent EEXIST after the budget means a live holder won → locked.
  for (let attempt = 0; attempt < 5; attempt++) {
    let fd: number;
    try {
      fd = openSync(path, "wx"); // O_CREAT|O_EXCL|O_WRONLY — atomic create-if-absent
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      // Someone holds the file. Reclaim only if the recorded pid is dead.
      let holder: string;
      try {
        holder = readFileSync(path, "utf8").trim();
      } catch {
        holder = ""; // vanished between open and read → retry the create
      }
      if (holder !== "" && pidAlive(Number.parseInt(holder, 10))) {
        throw lockedError(path, holder);
      }
      // Stale (dead / unparseable / empty) → remove and retry. unlink races are benign.
      try {
        unlinkSync(path);
      } catch {
        /* already gone — a peer reclaimed first; retry */
      }
      continue;
    }
    // We own the file. The pid is advisory metadata for reclaim + the error message.
    writeSync(fd, `${process.pid}\n`);
    closeSync(fd);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      try {
        unlinkSync(path); // best-effort; single-user tool
      } catch {
        /* already gone */
      }
    };
  }
  throw lockedError(path, "contended");
}

// src/server/tools/backup.ts — extraction cycle 6.14 (Green)
//
// scholar.backup — WAL-safe online backup of the active corpus DB.
//
// Implementation (foundation-confirmed 2026-05-24, post extraction-002):
//   - Sole shipped impl is SQLite-native `VACUUM INTO '<escaped-path>'`.
//     bun:sqlite does NOT expose a `.backup()` method (foundation verified
//     the API surface). VACUUM INTO is atomic to disk, WAL-safe, writes a
//     fully-vacuumed copy.
//   - Before VACUUM INTO, run `PRAGMA wal_checkpoint(TRUNCATE)` so the
//     copy reflects a consistent snapshot without WAL-frame replay. Under
//     concurrent readers, busy_timeout governs how long we wait; failure
//     surfaces as the structured WAL_CHECKPOINT_TIMEOUT error.
//
// §12.0 path discipline: dest is composed under the configured backupRoot
// then routed through resolveUnderRoot for the symlink-leaf + realpath
// confinement checks. Lexical containment is verified BEFORE any file
// creation so a path-traversal payload never produces a stray empty file.

import { z } from "zod";
import path from "node:path";
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { rawClient } from "../db/raw-client.ts";
import { resolveUnderRoot } from "../ingest/primitives.ts";
import type { RegisterTools, ServerContext } from "./registry.ts";

// ─── error ────────────────────────────────────────────────────────────────────

export class BackupToolError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "BackupToolError";
  }
}

// ─── shapes ───────────────────────────────────────────────────────────────────

export type BackupArgs = { dest: string };
export type BackupResult = { dest: string; size_bytes: number };

// ─── helpers ──────────────────────────────────────────────────────────────────

function ensureContained(candidate: string, root: string): void {
  // Lexical-then-realpath containment. The lexical check runs before any
  // filesystem mutation so traversal payloads (`../../etc/passwd`) cannot
  // create a stray empty file inside resolveUnderRoot's "must exist" gate.
  const realRoot = realpathSync(root);
  const lexical = path.resolve(candidate);
  if (!lexical.startsWith(realRoot + path.sep) || lexical === realRoot) {
    throw new BackupToolError(
      "BACKUP_PATH_ESCAPE",
      `BACKUP_PATH_ESCAPE: dest resolves outside backupRoot (${realRoot}): ${lexical}`,
    );
  }
}

// ─── handler ──────────────────────────────────────────────────────────────────

export async function runBackup(
  ctx: ServerContext,
  args: BackupArgs,
): Promise<BackupResult> {
  const db = ctx.db; // §7.6 snapshot-at-entry
  if (!db) {
    throw new BackupToolError(
      "NO_ACTIVE_CORPUS",
      "NO_ACTIVE_CORPUS: scholar.backup requires an active corpus.",
    );
  }
  const backupRoot = ctx.config.get<string>("backupRoot");
  if (!backupRoot || typeof backupRoot !== "string") {
    throw new BackupToolError(
      "BACKUP_ROOT_UNCONFIGURED",
      "BACKUP_ROOT_UNCONFIGURED: scholar.backup requires a configured backupRoot. " +
        "Set it via scholar.config (key=backupRoot, value=<absolute path>).",
    );
  }
  if (!existsSync(backupRoot) || !statSync(backupRoot).isDirectory()) {
    throw new BackupToolError(
      "BACKUP_ROOT_UNCONFIGURED",
      `BACKUP_ROOT_UNCONFIGURED: backupRoot does not exist or is not a directory: ${backupRoot}`,
    );
  }

  // Compose the candidate path under backupRoot (lexical) and reject any
  // traversal payload BEFORE touching the filesystem.
  const candidatePath = path.resolve(path.join(backupRoot, args.dest));
  ensureContained(candidatePath, backupRoot);

  // Run §12.0 resolveUnderRoot for the symlink-leaf + realpath checks. The
  // primitive requires the leaf to exist as a regular file — if the user is
  // backing up to a fresh path, we skip the strict check (lexical containment
  // already guarantees safety). If the file exists, the symlink-leaf gate
  // catches operator-laid traps.
  if (existsSync(candidatePath)) {
    try {
      resolveUnderRoot(candidatePath, backupRoot);
    } catch (err) {
      throw new BackupToolError(
        "BACKUP_PATH_ESCAPE",
        `BACKUP_PATH_ESCAPE: ${(err as Error).message}`,
      );
    }
  } else {
    // Ensure the parent dir exists so VACUUM INTO can write the new file.
    mkdirSync(path.dirname(candidatePath), { recursive: true });
  }

  const raw = rawClient(db);

  // WAL discipline — TRUNCATE checkpoint moves WAL contents into the main file
  // so the backup captures a consistent snapshot. busy_timeout (set elsewhere)
  // governs the wait under concurrent readers; if the checkpoint cannot
  // proceed, we surface a structured WAL_CHECKPOINT_TIMEOUT and DO NOT run
  // VACUUM INTO. The test deterministically forces this path via
  // PRAGMA busy_timeout=0 + a held reader snapshot on a second connection.
  try {
    const ck = raw.query("PRAGMA wal_checkpoint(TRUNCATE)").get() as
      | { busy: number; log: number; checkpointed: number }
      | undefined;
    if (ck && ck.busy === 1) {
      throw new BackupToolError(
        "WAL_CHECKPOINT_TIMEOUT",
        `WAL_CHECKPOINT_TIMEOUT: wal_checkpoint(TRUNCATE) could not acquire the WAL lock (busy=1 under concurrent readers).`,
      );
    }
  } catch (err) {
    if (err instanceof BackupToolError) throw err;
    throw new BackupToolError(
      "WAL_CHECKPOINT_TIMEOUT",
      `WAL_CHECKPOINT_TIMEOUT: ${(err as Error).message}`,
    );
  }

  // VACUUM INTO is the canonical SQLite backup mechanism. Path is already
  // confined; the single-quote doubling is defense-in-depth against any
  // future relaxation of the containment primitive's contract. bun:sqlite's
  // `exec` does not accept bound parameters, and VACUUM INTO cannot run
  // inside an implicit transaction — string composition is the safe pattern.
  const escapedDest = candidatePath.replace(/'/g, "''");
  raw.exec(`VACUUM INTO '${escapedDest}'`);

  const size_bytes = statSync(candidatePath).size;
  return { dest: candidatePath, size_bytes };
}

// ─── registerTools ────────────────────────────────────────────────────────────

export const registerTools: RegisterTools = (_server, ctx, _register) => {
  _register(
    "scholar.backup",
    {
      description:
        "WAL-safe online backup of the active corpus DB to a destination under " +
        "the configured backupRoot. Uses SQLite-native VACUUM INTO; surfaces " +
        "structured BACKUP_ROOT_UNCONFIGURED / BACKUP_PATH_ESCAPE / " +
        "WAL_CHECKPOINT_TIMEOUT errors.",
      inputSchema: z.object({
        dest: z.string().min(1).describe("Path relative to backupRoot (or absolute under backupRoot)."),
      }),
    },
    async (args) => await runBackup(ctx, (args ?? {}) as BackupArgs),
  );
};

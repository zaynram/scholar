// src/server/util/runtime-config.ts — foundation cross-plan helper (filled by
// chore foundation-fill-corpus-prereqs 2026-05-25 to unblock corpus wave 2).
//
// Atomic JSON state at `${runtimeRoot}/config.json` for cross-process / cross-
// session persistence. Atomicity invariant: a crash mid-write must NEVER leave
// config.json in a partial state — readers either see the prior value or the
// new one. Implementation: write to a tmp file, fdatasync the tmp's contents,
// rename over the target (POSIX rename is atomic for same-filesystem targets).
import { open, mkdir, rename, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface RuntimeConfig {
  /** Slug of the currently-active corpus, or null if first-run wizard has not run. */
  activeCorpusId: string | null;
}

const CONFIG_FILENAME = "config.json";

function configPath(runtimeRoot: string): string {
  return join(runtimeRoot, CONFIG_FILENAME);
}

export async function writeRuntimeConfig(data: RuntimeConfig, runtimeRoot: string): Promise<void> {
  await mkdir(runtimeRoot, { recursive: true });
  const target = configPath(runtimeRoot);
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  const body = JSON.stringify(data, null, 2) + "\n";
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(body);
    await handle.datasync();
  } finally {
    await handle.close();
  }
  // POSIX rename is atomic on the same filesystem. If rename fails (cross-
  // device, permission, etc.) the tmp file is removed to keep runtimeRoot
  // clean; the prior config.json remains untouched.
  try {
    await rename(tmp, target);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      // tmp may already be gone; swallow.
    }
    throw err;
  }
}

export async function readRuntimeConfig(runtimeRoot: string): Promise<RuntimeConfig | null> {
  const target = configPath(runtimeRoot);
  if (!existsSync(target)) return null;
  const body = await readFile(target, "utf8");
  return JSON.parse(body) as RuntimeConfig;
}

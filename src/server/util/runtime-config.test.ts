// src/server/util/runtime-config.test.ts — chore foundation-fill-corpus-prereqs 2026-05-25
//
// Tests for the atomic JSON config persistence helpers: writeRuntimeConfig +
// readRuntimeConfig. Atomicity invariant: no partial-write tmp file survives
// a successful write.
import { test, expect, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, constants as fsConstants } from "node:fs";
import * as fsp from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeRuntimeConfig, readRuntimeConfig } from "./runtime-config.ts";

// Maintain a set of temp dirs to clean up after each test.
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "scholar-runtime-config-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
});

test("write-then-read roundtrip returns the written value", async () => {
  const runtimeRoot = makeTempDir();
  await writeRuntimeConfig({ activeCorpusId: "demo" }, runtimeRoot);
  const result = await readRuntimeConfig(runtimeRoot);
  expect(result).toEqual({ activeCorpusId: "demo" });
});

test("readRuntimeConfig returns null when config.json is absent", async () => {
  const runtimeRoot = makeTempDir();
  const result = await readRuntimeConfig(runtimeRoot);
  expect(result).toBeNull();
});

test("readRuntimeConfig returns null when runtime dir does not exist", async () => {
  const runtimeRoot = join(tmpdir(), `scholar-nonexistent-${Date.now()}`);
  // Must not throw even when the directory doesn't exist.
  const result = await readRuntimeConfig(runtimeRoot);
  expect(result).toBeNull();
});

test("no orphan tmp files remain after a successful write", async () => {
  const runtimeRoot = makeTempDir();
  await writeRuntimeConfig({ activeCorpusId: "alpha" }, runtimeRoot);
  const entries = readdirSync(runtimeRoot);
  const tmpFiles = entries.filter((e) => e.startsWith("config.json.tmp."));
  expect(tmpFiles).toHaveLength(0);
  // config.json itself should be there.
  expect(entries).toContain("config.json");
});

test("sequential overwrites: last writer wins", async () => {
  const runtimeRoot = makeTempDir();
  await writeRuntimeConfig({ activeCorpusId: "first" }, runtimeRoot);
  await writeRuntimeConfig({ activeCorpusId: "second" }, runtimeRoot);
  const result = await readRuntimeConfig(runtimeRoot);
  expect(result).toEqual({ activeCorpusId: "second" });
});

test("writeRuntimeConfig fsyncs the parent directory after rename (M1)", async () => {
  // Audit M1 + pr-test-analyzer follow-up: POSIX rename is atomic for content
  // but the directory entry isn't durable until the parent directory is
  // fsync'd. The original test only spied on fsp.open and asserted an
  // O_DIRECTORY open occurred — removing the await dir.sync() call would
  // have left it green (the open still happens). Pin the load-bearing op:
  // wrap each FileHandle returned from a directory-flagged open and assert
  // .sync() was invoked on at least one of them before the function returns.
  if (process.platform === "win32") return; // no directory fsync on Win32
  const runtimeRoot = makeTempDir();
  const realOpen = fsp.open.bind(fsp) as typeof fsp.open;
  const dirSyncSpies: Array<ReturnType<typeof spyOn>> = [];
  const openSpy = spyOn(fsp, "open").mockImplementation(
    (async (
      path: Parameters<typeof realOpen>[0],
      flags?: Parameters<typeof realOpen>[1],
      mode?: Parameters<typeof realOpen>[2],
    ) => {
      const handle = await realOpen(path, flags, mode);
      if (
        path === runtimeRoot &&
        typeof flags === "number" &&
        (flags & fsConstants.O_DIRECTORY) !== 0
      ) {
        dirSyncSpies.push(spyOn(handle, "sync"));
      }
      return handle;
    }) as typeof fsp.open,
  );
  try {
    await writeRuntimeConfig({ activeCorpusId: "fsync-me" }, runtimeRoot);
    expect(dirSyncSpies.length).toBeGreaterThanOrEqual(1);
    const synced = dirSyncSpies.some((s) => s.mock.calls.length >= 1);
    expect(synced).toBe(true);
  } finally {
    openSpy.mockRestore();
  }
});

test("null activeCorpusId round-trips as null (not missing key)", async () => {
  const runtimeRoot = makeTempDir();
  await writeRuntimeConfig({ activeCorpusId: null }, runtimeRoot);
  const result = await readRuntimeConfig(runtimeRoot);
  expect(result).not.toBeNull();
  expect(result!.activeCorpusId).toBeNull();
  // Confirm the key is actually present in the result object.
  expect(Object.prototype.hasOwnProperty.call(result, "activeCorpusId")).toBe(true);
});

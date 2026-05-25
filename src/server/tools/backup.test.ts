// src/server/tools/backup.test.ts — extraction cycle 6.14 (Red)
//
// scholar.backup: WAL-safe online backup via SQLite-native VACUUM INTO.
// Routes args.dest through resolveUnderRoot(backupRoot, dest) (§12.0).
// BACKUP_ROOT_UNCONFIGURED structured error if backupRoot is unset.
// WAL_CHECKPOINT_TIMEOUT structured error when checkpoint times out under
// concurrent readers (per lead's explicit Red-test requirement).
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdtempSync, existsSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runBackup } from "./backup.ts";

const noopLog = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

function mkConfig(values: Record<string, unknown>) {
  return {
    get<T>(key: string): T | undefined {
      return key in values ? (values[key] as T) : undefined;
    },
    set(_k: string, _v: unknown) {},
    corpora: () => [],
    activeCorpusId: () => undefined,
  };
}

function fakeCtx(sqlite: Database, config: ReturnType<typeof mkConfig>) {
  const db = drizzle(sqlite);
  return {
    db, configDb: db,
    pdf: {
      interact: async () => null,
      getText: async () => "",
      currentRoots: () => [],
      setRoots: async () => {},
      isHealthy: () => ({ alive: true, lastOkAt: 0, stdioOpen: true }),
    },
    config,
    log: noopLog,
    withCorpus: async <T,>(fn: (db: ReturnType<typeof drizzle>) => Promise<T> | T) => await fn(db),
  } as unknown as Parameters<typeof runBackup>[0];
}

function freshFileDb(dir: string) {
  const dbPath = path.join(dir, "corpus.db");
  const sqlite = new Database(dbPath);
  sqlite.run(`PRAGMA journal_mode = WAL`);
  sqlite.run(`PRAGMA busy_timeout = 1000`);
  sqlite.run(`CREATE TABLE papers (id TEXT PRIMARY KEY, title TEXT NOT NULL)`);
  sqlite.run(`INSERT INTO papers(id, title) VALUES ('p1', 'Alpha')`);
  return { sqlite, dbPath };
}

test("scholar.backup: happy path — VACUUM INTO writes a valid SQLite file under backupRoot", async () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), "scholar-backup-src-"));
  const backupRoot = mkdtempSync(path.join(tmpdir(), "scholar-backup-dest-"));
  try {
    const { sqlite } = freshFileDb(dbDir);
    // Pre-create the destination file so resolveUnderRoot doesn't fail on
    // "does not exist". VACUUM INTO will overwrite it.
    const destRel = "snapshot.db";
    const destAbs = path.join(backupRoot, destRel);
    Bun.write(destAbs, "");

    const result = await runBackup(
      fakeCtx(sqlite, mkConfig({ backupRoot })),
      { dest: destRel },
    );
    expect(result.dest).toBe(destAbs);
    expect(existsSync(destAbs)).toBe(true);
    expect(statSync(destAbs).size).toBeGreaterThan(0);

    // Backup is a valid SQLite DB carrying the expected row.
    const restored = new Database(destAbs);
    const row = restored.query("SELECT title FROM papers WHERE id='p1'").get() as { title: string };
    expect(row.title).toBe("Alpha");
    restored.close();
    sqlite.close();
  } finally {
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  }
});

test("scholar.backup: BACKUP_ROOT_UNCONFIGURED when backupRoot is unset", async () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), "scholar-backup-src-"));
  try {
    const { sqlite } = freshFileDb(dbDir);
    await expect(
      runBackup(fakeCtx(sqlite, mkConfig({})), { dest: "x.db" }),
    ).rejects.toThrow(/BACKUP_ROOT_UNCONFIGURED/);
    sqlite.close();
  } finally {
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test("scholar.backup: path-traversal payload rejected by resolveUnderRoot (§12.0)", async () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), "scholar-backup-src-"));
  const backupRoot = mkdtempSync(path.join(tmpdir(), "scholar-backup-dest-"));
  try {
    const { sqlite } = freshFileDb(dbDir);
    await expect(
      runBackup(
        fakeCtx(sqlite, mkConfig({ backupRoot })),
        { dest: "../../../../etc/passwd" },
      ),
    ).rejects.toThrow(/escape|root|traversal|does not exist|symlink/i);
    sqlite.close();
  } finally {
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  }
});

test("scholar.backup: wal_checkpoint(TRUNCATE) timeout under concurrent reader → WAL_CHECKPOINT_TIMEOUT (deterministic)", async () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), "scholar-backup-wal-"));
  const dbPath = path.join(dbDir, "corpus.db");
  const primary = new Database(dbPath);
  primary.run(`PRAGMA journal_mode = WAL`);
  primary.run(`PRAGMA busy_timeout = 0`); // FAIL FAST — deterministic
  primary.run(`CREATE TABLE t (n INTEGER)`);
  primary.run(`INSERT INTO t(n) VALUES (1)`);

  const reader = new Database(dbPath, { readonly: true });
  reader.run("BEGIN");
  reader.query("SELECT n FROM t").get(); // grab a read snapshot, hold open

  const backupRoot = mkdtempSync(path.join(tmpdir(), "scholar-backup-dest-"));
  try {
    const destRel = "concurrent.db";
    Bun.write(path.join(backupRoot, destRel), "");
    await expect(
      runBackup(
        fakeCtx(primary, mkConfig({ backupRoot })),
        { dest: destRel },
      ),
    ).rejects.toThrow(/WAL_CHECKPOINT_TIMEOUT/);
    // No new partial backup file should have been written (we pre-seeded
    // an empty file; assert size still zero — the failed checkpoint must
    // not have triggered VACUUM INTO).
    expect(statSync(path.join(backupRoot, destRel)).size).toBe(0);
  } finally {
    reader.run("ROLLBACK");
    reader.close();
    primary.close();
    rmSync(backupRoot, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test("scholar.backup: NO_ACTIVE_CORPUS guard", async () => {
  const dbDir = mkdtempSync(path.join(tmpdir(), "scholar-backup-src-"));
  const backupRoot = mkdtempSync(path.join(tmpdir(), "scholar-backup-dest-"));
  try {
    const { sqlite } = freshFileDb(dbDir);
    const ctx = fakeCtx(sqlite, mkConfig({ backupRoot })) as unknown as Record<string, unknown>;
    ctx.db = undefined;
    await expect(
      runBackup(
        ctx as unknown as Parameters<typeof runBackup>[0],
        { dest: "x.db" },
      ),
    ).rejects.toThrow(/NO_ACTIVE_CORPUS/);
    sqlite.close();
  } finally {
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(backupRoot, { recursive: true, force: true });
  }
});

// src/server/db/migrations.ts — foundation cycle 6.1 (Task 1.2)
//
// Sole entry point for opening either the config DB or a per-corpus DB.
// PRAGMA foreign_keys = ON is per-connection; this is the only place that
// pragma is set, so the §8 onDelete: "cascade" clauses are load-bearing.
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { join } from "node:path";
import { runRawDdl } from "./raw-ddl.ts";
import { rawClient } from "./raw-client.ts";

/**
 * Sole entry point for opening either the config DB or a per-corpus DB.
 * PRAGMA foreign_keys = ON is per-connection; the §8 onDelete: "cascade"
 * clauses depend on this. PRAGMA journal_mode = WAL is set once at open;
 * SQLite persists the journal-mode choice in the DB header.
 */
export function openWithPragmas(path: string): BunSQLiteDatabase {
  const client = new Database(path);
  client.exec("PRAGMA foreign_keys = ON");
  client.exec("PRAGMA journal_mode = WAL");
  return drizzle(client);
}

/**
 * Plugin-upgrade compatibility guard (per §5.3 behavior 3). Reads
 * __drizzle_migrations and aborts if the DB was written by a newer plugin.
 */
export class DbFromNewerPluginError extends Error {
  override name = "DbFromNewerPluginError";
}

/**
 * Replays unapplied migrations, then calls runRawDdl(db). The raw-DDL hook
 * (stub from cycle 6.1; filled by extraction at 6.5/6.6) creates chunk_vec
 * and reading_queue. Foundation tests must NOT assert on those two objects.
 */
export function applyMigrations(
  db: BunSQLiteDatabase,
  migrationsFolder: string = join(import.meta.dir, "migrations"),
): void {
  // Compatibility guard runs BEFORE migrate() so a newer-schema DB aborts
  // before any modification.
  const recorded = readMaxAppliedId(db);
  const bundled = countBundledMigrations(migrationsFolder);
  if (recorded !== null && recorded > bundled) {
    throw new DbFromNewerPluginError(
      `DB has migration id ${recorded} but plugin ships only ${bundled}; ` +
        "downgrade the plugin or run scholar.corpus.export.",
    );
  }
  migrate(db, { migrationsFolder });
  runRawDdl(db);
}

function readMaxAppliedId(db: BunSQLiteDatabase): number | null {
  try {
    const r = rawClient(db)
      .query("SELECT MAX(id) AS m FROM __drizzle_migrations")
      .get() as { m: number | null } | undefined;
    return r?.m ?? null;
  } catch {
    return null; // table doesn't exist yet — first open
  }
}

function countBundledMigrations(folder: string): number {
  // Count files matching NNNN_*.sql in folder. Foundation ships an empty journal
  // initially (no migrations until schema lands in Task 1.4); count returns 0.
  // Drizzle migrate() handles the empty-journal case without error.
  try {
    return Array.from(new Bun.Glob("*.sql").scanSync({ cwd: folder })).length;
  } catch {
    return 0;
  }
}

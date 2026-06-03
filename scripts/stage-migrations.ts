// scripts/stage-migrations.ts
//
// Bug #5 (found 2026-06-03 driving the dist bundle): the drizzle migrations were
// never staged next to the bundled server. `applyMigrations` resolves
// `migrationsFolder = join(import.meta.dir, "migrations")`, and in the bundle
// `import.meta.dir` is the dist/ directory — so it needs `<dist>/migrations/`.
// Without it the packaged/bundled server dies on the FIRST DB open with
// "Can't find meta/_journal.json" (every config-DB + per-corpus migrate).
//
// This stages `src/server/db/migrations` (the .sql files + meta/_journal.json)
// into a target dist directory. Used by both `build:server` (repo dist, dev
// checkout run as the plugin) and build-plugin.ts (the zipped staging tree).
//
// Usage: bun scripts/stage-migrations.ts <distDir>   (default: dist)
import { cpSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export function stageMigrations(distDir: string): string {
  const src = resolve(import.meta.dir, "..", "src", "server", "db", "migrations");
  if (!existsSync(join(src, "meta", "_journal.json"))) {
    throw new Error(`stage-migrations: source migrations (with meta/_journal.json) not found at ${src}`);
  }
  const dest = join(resolve(distDir), "migrations");
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  return dest;
}

if (import.meta.main) {
  const dest = stageMigrations(process.argv[2] ?? "dist");
  process.stdout.write(`staged migrations -> ${dest}\n`);
}

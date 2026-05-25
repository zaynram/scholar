// src/server/db/migrations.test.ts — foundation cycle 6.1 (Task 1.2)
//
// Pins openWithPragmas semantics: PRAGMA foreign_keys = ON per connection,
// distinct files map to distinct databases. The full applyMigrations end-to-end
// path is exercised by schema.test.ts (Task 1.4).
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWithPragmas } from "./migrations.ts";

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test("openWithPragmas sets PRAGMA foreign_keys = ON on every open", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-mig-"));
  const db = openWithPragmas(join(dir, "t.db"));
  const row = (db.$client as { query: (sql: string) => { get: () => unknown } })
    .query("PRAGMA foreign_keys")
    .get() as { foreign_keys: number };
  expect(row.foreign_keys).toBe(1);
});

test("openWithPragmas opens distinct paths to distinct files", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-mig-"));
  const a = openWithPragmas(join(dir, "a.db"));
  const b = openWithPragmas(join(dir, "b.db"));
  (a.$client as { exec: (sql: string) => void }).exec("CREATE TABLE t (k TEXT)");
  // b must not see the table — distinct files.
  expect(() =>
    (b.$client as { query: (sql: string) => { all: () => unknown } }).query("SELECT * FROM t").all(),
  ).toThrow();
});

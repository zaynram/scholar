// src/server/db/raw-client.test.ts — foundation cycle 6.1 (Task 1.4b)
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openWithPragmas } from "./migrations.ts";
import { rawClient } from "./raw-client.ts";

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test("rawClient returns the bun:sqlite Database backing a BunSQLiteDatabase", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-rawclient-"));
  const db = openWithPragmas(join(dir, "t.db"));
  const raw = rawClient(db);
  expect(raw).toBeInstanceOf(Database);
  // The raw client must observe writes through the drizzle wrapper.
  raw.exec("CREATE TABLE k (v INTEGER)");
  raw.exec("INSERT INTO k VALUES (42)");
  const row = raw.query("SELECT v FROM k").get() as { v: number };
  expect(row.v).toBe(42);
});

// src/server/db/raw-ddl.test.ts — foundation cycle 6.1 (Task 1.8)
//
// Foundation test-scoping rule (per §7.6): the runRawDdl stub is exercised at
// the foundation layer only for "call succeeds, no throw". Extraction at
// cycles 6.5 (chunk_vec) + 6.6 (reading_queue) fills the body and adds its
// own assertions; foundation MUST NOT assert chunk_vec or reading_queue exist.
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWithPragmas } from "./migrations.ts";
import { runRawDdl } from "./raw-ddl.ts";

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test("runRawDdl is a no-op at the foundation layer (extraction fills the body)", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-rawddl-"));
  const db = openWithPragmas(join(dir, "t.db"));
  // No throw, no return value.
  expect(() => runRawDdl(db)).not.toThrow();
  // Foundation MUST NOT assert chunk_vec or reading_queue exist — that's
  // extraction's contract (cycles 6.5 / 6.6).
});

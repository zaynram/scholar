// src/server/tools/snapshot.test.ts — corpus plan cycle 6.11 RED
//
// Tests for scholar.snapshot.take per §5.13, §8.2.
// Requires an active corpus (ctx.db must be set). Uses buildServer with a
// pre-migrated configDb; activates a corpus before seeding papers.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, type BuiltServer } from "../index.ts";
import { openWithPragmas, applyMigrations } from "../db/migrations.ts";
import { rawClient } from "../db/raw-client.ts";
import { nowIso, ulid } from "../db/nowIso.ts";
import type { PdfChild } from "./registry.ts";
import type { SnapshotPayload } from "../db/schema.ts";

let dir: string;
let built: BuiltServer;
const origRuntimeRoot = process.env.SCHOLAR_RUNTIME_ROOT;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-snapshot-test-"));
  mkdirSync(join(dir, "dbs"), { recursive: true });
  process.env.SCHOLAR_RUNTIME_ROOT = dir;

  const configDb = openWithPragmas(join(dir, "dbs", "scholar-config.db"));
  applyMigrations(configDb);

  const mockPdf: PdfChild = {
    interact: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
    getText: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
    currentRoots: () => [],
    setRoots: async () => {},
    displayPdf: async () => ({ viewUUID: "stub-view-uuid" }),
    isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
  };

  built = buildServer({
    runtimeRoot: dir,
    openConfigDb: () => configDb,
    spawnPdfChild: () => mockPdf,
  });

  // Create + activate a corpus so ctx.db is set
  await built.dispatch("scholar.corpus.create", {
    slug: "snap-corpus",
    display_name: "Snapshot Test",
    initial_pdf_root: dir,
  });
  await built.dispatch("scholar.corpus.activate", { slug: "snap-corpus" });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (origRuntimeRoot === undefined) delete process.env.SCHOLAR_RUNTIME_ROOT;
  else process.env.SCHOLAR_RUNTIME_ROOT = origRuntimeRoot;
});

/** Seed n papers into the active corpus DB with given statuses. */
function seedPapers(papers: Array<{ status: "pending" | "reading" | "reviewed" | "skip"; priority?: number }>) {
  const db = built.ctx.db!;
  const client = rawClient(db);
  const now = nowIso();
  const insertedIds: string[] = [];
  for (const p of papers) {
    const id = ulid();
    insertedIds.push(id);
    client
      .query(
        "INSERT INTO papers (id, key, title, status, priority, imported_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, `key-${id}`, `Paper ${id.slice(0, 8)}`, p.status, p.priority ?? 0, now);
  }
  return insertedIds;
}

// ─── scholar.snapshot.take ────────────────────────────────────────────────────

test("snapshot.take('manual') inserts a row with trigger='manual' and recent taken_at", async () => {
  const before = nowIso();
  const result = await built.dispatch("scholar.snapshot.take", { trigger: "manual" }) as {
    id: string;
    taken_at: string;
    trigger: string;
  };
  expect(result.trigger).toBe("manual");
  expect(result.taken_at >= before).toBe(true);
  expect(result.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID format
});

test("snapshot.take('open') inserts a row with trigger='open'", async () => {
  const result = await built.dispatch("scholar.snapshot.take", { trigger: "open" }) as {
    trigger: string;
  };
  expect(result.trigger).toBe("open");
});

test("snapshot.take payload parses back to valid SnapshotPayload shape", async () => {
  seedPapers([
    { status: "pending" },
    { status: "reading", priority: 5 },
    { status: "reviewed" },
  ]);

  const result = await built.dispatch("scholar.snapshot.take", { trigger: "manual" }) as {
    payload: SnapshotPayload;
  };
  const p = result.payload;

  expect(Array.isArray(p.paper_ids)).toBe(true);
  expect(typeof p.statuses).toBe("object");
  expect(typeof p.priorities).toBe("object");
  expect(typeof p.counts).toBe("object");
  expect(typeof p.counts.total).toBe("number");
  expect(typeof p.counts.pending).toBe("number");
  expect(typeof p.counts.reading).toBe("number");
  expect(typeof p.counts.reviewed).toBe("number");
  expect(typeof p.counts.skip).toBe("number");
});

test("snapshot.take counts totals match seeded paper count", async () => {
  seedPapers([
    { status: "pending" },
    { status: "pending" },
    { status: "reading" },
    { status: "reviewed" },
    { status: "skip" },
  ]);

  const result = await built.dispatch("scholar.snapshot.take", { trigger: "manual" }) as {
    payload: SnapshotPayload;
  };
  const { counts } = result.payload;

  expect(counts.total).toBe(5);
  expect(counts.pending).toBe(2);
  expect(counts.reading).toBe(1);
  expect(counts.reviewed).toBe(1);
  expect(counts.skip).toBe(1);
});

test("snapshot.take statuses keys match paper_ids", async () => {
  const ids = seedPapers([{ status: "pending" }, { status: "reading" }]);

  const result = await built.dispatch("scholar.snapshot.take", { trigger: "manual" }) as {
    payload: SnapshotPayload;
  };
  const { paper_ids, statuses } = result.payload;

  for (const id of ids) {
    expect(paper_ids).toContain(id);
    expect(statuses[id]).toBeDefined();
  }
  expect(Object.keys(statuses)).toHaveLength(paper_ids.length);
});

test("snapshot.take priorities keys match paper_ids", async () => {
  seedPapers([{ status: "pending", priority: 3 }, { status: "reading", priority: 7 }]);

  const result = await built.dispatch("scholar.snapshot.take", { trigger: "manual" }) as {
    payload: SnapshotPayload;
  };
  const { paper_ids, priorities } = result.payload;

  for (const id of paper_ids) {
    expect(typeof priorities[id]).toBe("number");
  }
});

test("snapshot.take with no active corpus rejects with structured error", async () => {
  // Temporarily clear ctx.db to simulate no active corpus
  const savedDb = built.ctx.db;
  built.ctx.db = undefined;
  try {
    await expect(built.dispatch("scholar.snapshot.take", { trigger: "manual" }))
      .rejects.toMatchObject({ code: "NO_ACTIVE_CORPUS" });
  } finally {
    built.ctx.db = savedDb;
  }
});

test("two consecutive snapshot.take calls produce two independent rows", async () => {
  seedPapers([{ status: "pending" }]);

  const r1 = await built.dispatch("scholar.snapshot.take", { trigger: "manual" }) as { id: string };
  const r2 = await built.dispatch("scholar.snapshot.take", { trigger: "open" }) as { id: string };

  expect(r1.id).not.toBe(r2.id);
  expect(r1.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(r2.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

  // Verify both rows exist in the DB
  const rows = rawClient(built.ctx.db!)
    .query("SELECT id FROM snapshots ORDER BY taken_at ASC")
    .all() as { id: string }[];
  expect(rows).toHaveLength(2);
  expect(rows.map(r => r.id)).toContain(r1.id);
  expect(rows.map(r => r.id)).toContain(r2.id);
});

// ─── posture-B regression guard ──────────────────────────────────────────────

test("snapshot.take makes no sqlite3-mcp calls (posture-B guard)", async () => {
  const strictPdf = new Proxy(built.ctx.pdf, {
    get(target, prop) {
      if (typeof prop === "string" && prop.includes("sqlite3")) {
        throw new Error(`sqlite3-mcp access detected: ${String(prop)}`);
      }
      return Reflect.get(target, prop);
    },
  });
  const origPdf = built.ctx.pdf;
  (built.ctx as unknown as { pdf: typeof strictPdf }).pdf = strictPdf;
  try {
    await built.dispatch("scholar.snapshot.take", { trigger: "manual" });
  } finally {
    (built.ctx as unknown as { pdf: typeof origPdf }).pdf = origPdf;
  }
  expect(true).toBe(true);
});

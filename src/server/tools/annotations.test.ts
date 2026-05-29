// src/server/tools/annotations.test.ts — §13 v1.1 push-only handler tests
//
// Tests for scholar.annotations.{list, upsert, delete} under the 2026-05-27
// §13 amendment (push-only propagation). The v1.0 reconcile-on-list tests
// (Red-4 / Red-5 / Red-7b / Red-7c / Red-8b / Red-9) were retired with the
// reconciler. The vendor wire envelope is covered by the S1 contract test
// against the real vendor process (see lifecycle.contract.test.ts).
//
// Test harness: buildServer + applyMigrations + a configurable mock PdfChild
// whose `interact` records every call (cmd + viewUUID). beforeEach seeds
// ctx.pdfViews so most tests don't need to call scholar.pdf.open first;
// the NO_OPEN_VIEWER cases delete the entry per-test.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, type BuiltServer } from "../index.ts";
import { openWithPragmas, applyMigrations } from "../db/migrations.ts";
import { rawClient } from "../db/raw-client.ts";
import { nowIso } from "../db/nowIso.ts";
import type { PdfChild } from "./registry.ts";
import type { PdfCommand } from "../../vendor/pdf-server/dist/src/commands.js";

// ─── harness ──────────────────────────────────────────────────────────────────

const TEST_PAPER = "p1";
const TEST_VIEW_UUID = "test-view-uuid-p1";

let dir: string;
let built: BuiltServer;
type InteractCall = { cmd: PdfCommand & Record<string, unknown>; viewUUID: string };
let interactCalls: InteractCall[];
let interactImpl: (cmd: PdfCommand, viewUUID: string) => Promise<unknown>;
const origRuntimeRoot = process.env.SCHOLAR_RUNTIME_ROOT;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-annotations-test-"));
  mkdirSync(join(dir, "dbs"), { recursive: true });
  process.env.SCHOLAR_RUNTIME_ROOT = dir;

  const configDb = openWithPragmas(join(dir, "dbs", "scholar-config.db"));
  applyMigrations(configDb);

  interactCalls = [];
  // Default impl: every push returns null (vendor returns no-data on
  // add/update/remove acknowledgements).
  interactImpl = async () => null;

  const mockPdf: PdfChild = {
    interact: async (cmd, opts) => {
      interactCalls.push({
        cmd: cmd as PdfCommand & Record<string, unknown>,
        viewUUID: opts.viewUUID,
      });
      return await interactImpl(cmd, opts.viewUUID);
    },
    getText: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
    displayPdf: async () => ({ viewUUID: TEST_VIEW_UUID }),
    currentRoots: () => [],
    setRoots: async () => {},
    isHealthy: () => ({ alive: true, lastOkAt: Date.now(), stdioOpen: true }),
  };

  built = buildServer({
    runtimeRoot: dir,
    openConfigDb: () => configDb,
    spawnPdfChild: () => mockPdf,
  });

  await built.dispatch("scholar.corpus.create", {
    slug: "annot-corp",
    display_name: "Annotation Test Corpus",
    initial_pdf_root: dir,
  });
  await built.dispatch("scholar.corpus.activate", { slug: "annot-corp" });
  // Seed a paper row so the FK references resolve.
  rawClient(built.ctx.db!)
    .query("INSERT INTO papers (id, key, title, imported_at) VALUES (?, ?, ?, ?)")
    .run(TEST_PAPER, "smith2024", "Test paper", nowIso());
  // §13 v1.1: pre-populate the viewUUID map so most tests don't need to call
  // scholar.pdf.open first. NO_OPEN_VIEWER tests clear/skip this entry.
  built.ctx.pdfViews.set(TEST_PAPER, TEST_VIEW_UUID);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (origRuntimeRoot === undefined) delete process.env.SCHOLAR_RUNTIME_ROOT;
  else process.env.SCHOLAR_RUNTIME_ROOT = origRuntimeRoot;
});

// ─── tiny helpers ─────────────────────────────────────────────────────────────

const dispatch = (tool: string, args: unknown) => built.dispatch(tool, args);

function findInteract(type: string): InteractCall[] {
  return interactCalls.filter((c) => c.cmd.type === type);
}

// =============================================================================
// NO_ACTIVE_CORPUS guards (§13 invariant 4)
// =============================================================================

test("scholar.annotations.list NO_ACTIVE_CORPUS guard fires when ctx.db is undefined", async () => {
  const saved = built.ctx.db;
  built.ctx.db = undefined;
  try {
    await expect(dispatch("scholar.annotations.list", { paper_id: TEST_PAPER }))
      .rejects.toMatchObject({ code: "NO_ACTIVE_CORPUS" });
    expect(interactCalls).toHaveLength(0);
  } finally {
    built.ctx.db = saved;
  }
});

test("scholar.annotations.upsert NO_ACTIVE_CORPUS guard fires when ctx.db is undefined", async () => {
  const saved = built.ctx.db;
  built.ctx.db = undefined;
  try {
    await expect(dispatch("scholar.annotations.upsert", { paper_id: TEST_PAPER, body: "x" }))
      .rejects.toMatchObject({ code: "NO_ACTIVE_CORPUS" });
    expect(interactCalls).toHaveLength(0);
  } finally {
    built.ctx.db = saved;
  }
});

test("scholar.annotations.delete NO_ACTIVE_CORPUS guard fires when ctx.db is undefined", async () => {
  const saved = built.ctx.db;
  built.ctx.db = undefined;
  try {
    await expect(dispatch("scholar.annotations.delete", { id: "01ABCD" }))
      .rejects.toMatchObject({ code: "NO_ACTIVE_CORPUS" });
    expect(interactCalls).toHaveLength(0);
  } finally {
    built.ctx.db = saved;
  }
});

// =============================================================================
// NO_OPEN_VIEWER guards (§13 v1.1 invariant 5 — new)
// =============================================================================

test("upsert throws NO_OPEN_VIEWER when ctx.pdfViews has no entry for paper_id", async () => {
  built.ctx.pdfViews.delete(TEST_PAPER);
  await expect(dispatch("scholar.annotations.upsert", { paper_id: TEST_PAPER, body: "x" }))
    .rejects.toMatchObject({ code: "NO_OPEN_VIEWER" });
  expect(interactCalls).toHaveLength(0);
  const rows = rawClient(built.ctx.db!).query("SELECT id FROM annotations").all() as unknown[];
  expect(rows).toHaveLength(0);
});

test("delete on live row throws NO_OPEN_VIEWER when no viewer is open; no push, no deleted_at write", async () => {
  // Insert a live row first (viewUUID present).
  const r = await dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: "x",
  }) as { id: string };
  interactCalls = [];
  built.ctx.pdfViews.delete(TEST_PAPER);
  await expect(dispatch("scholar.annotations.delete", { id: r.id }))
    .rejects.toMatchObject({ code: "NO_OPEN_VIEWER" });
  expect(interactCalls).toHaveLength(0);
  const row = rawClient(built.ctx.db!)
    .query("SELECT deleted_at FROM annotations WHERE id = ?")
    .get(r.id) as { deleted_at: string | null };
  expect(row.deleted_at).toBeNull();
});

test("delete on missing id is a clean no-op even when no viewer is open", async () => {
  built.ctx.pdfViews.delete(TEST_PAPER);
  const result = await dispatch("scholar.annotations.delete", { id: "nonexistent-ulid" }) as {
    deleted: boolean;
    reason: string;
  };
  expect(result.deleted).toBe(false);
  expect(result.reason).toBe("not_found");
  expect(interactCalls).toHaveLength(0);
});

test("delete on already-tombstoned id is a clean no-op even when no viewer is open", async () => {
  const r = await dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: "x",
  }) as { id: string };
  await dispatch("scholar.annotations.delete", { id: r.id });
  interactCalls = [];
  built.ctx.pdfViews.delete(TEST_PAPER);
  const result = await dispatch("scholar.annotations.delete", { id: r.id }) as {
    deleted: boolean;
    reason: string;
  };
  expect(result.deleted).toBe(false);
  expect(result.reason).toBe("already_tombstoned");
  expect(interactCalls).toHaveLength(0);
});

test("list does NOT require an open viewer (pure DB read)", async () => {
  await dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: "rendered without viewer",
  });
  interactCalls = [];
  built.ctx.pdfViews.delete(TEST_PAPER);
  const result = await dispatch("scholar.annotations.list", { paper_id: TEST_PAPER }) as {
    rows: Array<{ body: string }>;
  };
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]!.body).toBe("rendered without viewer");
  expect(interactCalls).toHaveLength(0);
});

// =============================================================================
// upsert insert path + write-then-push ordering + wire envelope (§13 invariant 1)
// =============================================================================

test("upsert insert: writes annotation with source='scholar', then pushes add_annotations carrying viewUUID", async () => {
  // Capture DB state at the moment of the first interact call to prove the
  // synchronous write commits BEFORE the await for pdf.interact resolves.
  let dbRowAtFirstInteract: { id: string } | null = null;
  interactImpl = async () => {
    if (dbRowAtFirstInteract === null) {
      dbRowAtFirstInteract =
        (rawClient(built.ctx.db!).query("SELECT id FROM annotations LIMIT 1").get() as
          | { id: string }
          | null);
    }
    return null;
  };

  const result = await dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: "hello",
    anchor: "§2.1",
  }) as { id: string; source: string; created_at: string; updated_at: string };

  expect(result.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID
  expect(result.source).toBe("scholar");
  expect(result.updated_at >= result.created_at).toBe(true);

  // Write-then-push: at the moment interact was first called, the DB row existed.
  expect(dbRowAtFirstInteract).not.toBeNull();
  expect(dbRowAtFirstInteract!.id).toBe(result.id);

  // Exactly one interact call: add_annotations, carrying our viewUUID.
  const addCalls = findInteract("add_annotations");
  expect(addCalls).toHaveLength(1);
  expect(addCalls[0]!.viewUUID).toBe(TEST_VIEW_UUID);

  // DB row shape.
  const row = rawClient(built.ctx.db!)
    .query("SELECT * FROM annotations WHERE id = ?")
    .get(result.id) as { id: string; body: string; source: string; deleted_at: string | null };
  expect(row.body).toBe("hello");
  expect(row.source).toBe("scholar");
  expect(row.deleted_at).toBeNull();
});

// =============================================================================
// upsert update path
// =============================================================================

test("upsert update: same id, different body → updates row + pushes update_annotations", async () => {
  const r1 = await dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: "first",
  }) as { id: string; created_at: string };
  expect(findInteract("add_annotations")).toHaveLength(1);

  const r2 = await dispatch("scholar.annotations.upsert", {
    id: r1.id,
    paper_id: TEST_PAPER,
    body: "second",
  }) as { id: string; body: string; created_at: string; updated_at: string };

  expect(r2.id).toBe(r1.id);
  expect(r2.body).toBe("second");
  expect(r2.created_at).toBe(r1.created_at); // created_at preserved
  expect(r2.updated_at > r1.created_at).toBe(true);

  // Second interact was update_annotations (not a second add).
  expect(findInteract("update_annotations")).toHaveLength(1);
  expect(findInteract("add_annotations")).toHaveLength(1);
});

// =============================================================================
// M8 — phase-2 (push) throw leaves a re-pushable dirty row
// =============================================================================

test("upsert: push failure leaves DB row intact; retry with same id is idempotent (M8)", async () => {
  // Audit M8 / §13 v1.1 "write-then-push": the DB write commits synchronously
  // before the await for pdf.interact resolves, so a push failure leaves a
  // dirty-but-recoverable row. The user re-invokes upsert with the captured id
  // and the operation is idempotent — the same id round-trips through the
  // update branch and emits update_annotations (not a second add).
  let interactCallsObserved = 0;
  interactImpl = async () => {
    interactCallsObserved += 1;
    if (interactCallsObserved === 1) throw new Error("pdf viewer push failed");
    return null;
  };

  await expect(
    dispatch("scholar.annotations.upsert", {
      paper_id: TEST_PAPER,
      body: "first attempt",
    }),
  ).rejects.toThrow(/push failed/);

  // Phase-1 write committed despite the phase-2 throw — DB row persists.
  const dirty = rawClient(built.ctx.db!)
    .query("SELECT id, body, source FROM annotations WHERE paper_id = ?")
    .get(TEST_PAPER) as { id: string; body: string; source: string };
  expect(dirty.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(dirty.body).toBe("first attempt");

  // The first push call was attempted (and threw).
  expect(findInteract("add_annotations")).toHaveLength(1);

  // Retry with same id: idempotent on the existing-id path → emits update_annotations,
  // not a second add_annotations.
  const retried = await dispatch("scholar.annotations.upsert", {
    id: dirty.id,
    paper_id: TEST_PAPER,
    body: "first attempt",
  }) as { id: string };
  expect(retried.id).toBe(dirty.id);
  expect(findInteract("update_annotations")).toHaveLength(1);
  expect(findInteract("add_annotations")).toHaveLength(1);
});

// =============================================================================
// delete: soft-delete + remove_annotations push (no tombstone-table writes under v1.1)
// =============================================================================

test("delete: soft-deletes annotation (deleted_at set) and pushes remove_annotations carrying viewUUID", async () => {
  const r1 = await dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: "to delete",
  }) as { id: string };

  // Verify DB state at the moment of the first interact after delete.
  let deletedAtAtPush: string | null = null;
  interactImpl = async (cmd) => {
    if (cmd.type === "remove_annotations" && deletedAtAtPush === null) {
      const row = rawClient(built.ctx.db!)
        .query("SELECT deleted_at FROM annotations WHERE id = ?")
        .get(r1.id) as { deleted_at: string | null };
      deletedAtAtPush = row.deleted_at;
    }
    return null;
  };

  await dispatch("scholar.annotations.delete", { id: r1.id });

  const row = rawClient(built.ctx.db!)
    .query("SELECT deleted_at FROM annotations WHERE id = ?")
    .get(r1.id) as { deleted_at: string | null };
  expect(row.deleted_at).not.toBeNull();

  // Write-then-push: at the moment remove_annotations fired, deleted_at was set.
  expect(deletedAtAtPush).not.toBeNull();

  // remove_annotations pushed with the right viewUUID + ids payload.
  const removes = findInteract("remove_annotations");
  expect(removes).toHaveLength(1);
  expect(removes[0]!.viewUUID).toBe(TEST_VIEW_UUID);
  expect((removes[0]!.cmd as { ids: string[] }).ids).toEqual([r1.id]);
});

// =============================================================================
// delete idempotency (unchanged under v1.1)
// =============================================================================

test("delete on already-tombstoned annotation is no-op: no second pdf.interact, deleted_at unchanged", async () => {
  const r1 = await dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: "x",
  }) as { id: string };
  await dispatch("scholar.annotations.delete", { id: r1.id });
  const firstDeletedAt = (rawClient(built.ctx.db!)
    .query("SELECT deleted_at FROM annotations WHERE id = ?")
    .get(r1.id) as { deleted_at: string }).deleted_at;

  const removesBefore = findInteract("remove_annotations").length;
  await dispatch("scholar.annotations.delete", { id: r1.id });
  const removesAfter = findInteract("remove_annotations").length;
  expect(removesAfter).toBe(removesBefore); // no new push

  const secondDeletedAt = (rawClient(built.ctx.db!)
    .query("SELECT deleted_at FROM annotations WHERE id = ?")
    .get(r1.id) as { deleted_at: string }).deleted_at;
  expect(secondDeletedAt).toBe(firstDeletedAt); // unchanged
});

// =============================================================================
// list returns live rows
// =============================================================================

test("list returns rows with deleted_at IS NULL only; shape includes id/page/anchor/body/source/created_at/updated_at", async () => {
  const r1 = await dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: "live note",
    anchor: "§3.2 — key finding paragraph",
    page: 5,
  }) as { id: string };
  const r2 = await dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: "to be deleted",
  }) as { id: string };
  await dispatch("scholar.annotations.delete", { id: r2.id });

  const result = await dispatch("scholar.annotations.list", { paper_id: TEST_PAPER }) as {
    rows: Array<{ id: string; body: string; anchor: string | null; page: number | null; source: string }>;
  };
  expect(result.rows.length).toBe(1);
  const row = result.rows[0]!;
  expect(row.id).toBe(r1.id);
  expect(row.body).toBe("live note");
  expect(row.anchor).toBe("§3.2 — key finding paragraph");
  expect(row.page).toBe(5);
  expect(row.source).toBe("scholar");
});

// =============================================================================
// sanitization (§12.0) on user-supplied body and anchor
// =============================================================================

test("upsert rejects body containing bidi-override U+202E before DB write or pdf.interact", async () => {
  const evil = "hello‮world";
  const callsBefore = interactCalls.length;
  await expect(dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: evil,
  })).rejects.toThrow(/bidi/i);
  expect(findInteract("add_annotations")).toHaveLength(0);
  expect(interactCalls.length).toBe(callsBefore);
  const rows = rawClient(built.ctx.db!)
    .query("SELECT id FROM annotations")
    .all() as unknown[];
  expect(rows).toHaveLength(0);
});

test("upsert rejects anchor containing bidi-override U+202E", async () => {
  await expect(dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: "ok",
    anchor: "§2.1‮evil",
  })).rejects.toThrow(/bidi/i);
  expect(findInteract("add_annotations")).toHaveLength(0);
});

// =============================================================================
// rect JSON validation
// =============================================================================

test("upsert accepts valid 4-element finite rect JSON", async () => {
  const r = await dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: "x",
    rect: "[10, 20, 200, 300]",
  }) as { id: string };
  const row = rawClient(built.ctx.db!)
    .query("SELECT rect FROM annotations WHERE id = ?")
    .get(r.id) as { rect: string };
  expect(JSON.parse(row.rect)).toEqual([10, 20, 200, 300]);
});

test("upsert rejects rect with 3 elements", async () => {
  await expect(dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER, body: "x", rect: "[10, 20, 200]",
  })).rejects.toMatchObject({ code: "INVALID_RECT" });
});

test("upsert rejects rect with non-finite numbers", async () => {
  await expect(dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER, body: "x", rect: "[10, 20, 200, 1e9999]",
  })).rejects.toMatchObject({ code: "INVALID_RECT" });
});

test("upsert rejects rect with wrong shape (object)", async () => {
  await expect(dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER, body: "x", rect: '{"x":10}',
  })).rejects.toMatchObject({ code: "INVALID_RECT" });
});

// =============================================================================
// Paper-level note + serializeForViewer fallback rect
// =============================================================================

test("upsert accepts paper-level note (no rect, no anchor); push uses vendor note shape with default origin (20,20) and page 1", async () => {
  const r = await dispatch("scholar.annotations.upsert", {
    paper_id: TEST_PAPER,
    body: "paper-level note",
  }) as { id: string };

  const row = rawClient(built.ctx.db!)
    .query("SELECT rect, anchor, source FROM annotations WHERE id = ?")
    .get(r.id) as { rect: string | null; anchor: string | null; source: string };
  expect(row.rect).toBeNull();
  expect(row.anchor).toBeNull();
  expect(row.source).toBe("scholar");

  // serializeForViewer maps scholar → vendor's `note` annotation shape:
  // {id, type: "note", page, x, y, content}. With no rect/anchor, x=20, y=20,
  // page=1, content=body verbatim.
  const adds = findInteract("add_annotations");
  expect(adds).toHaveLength(1);
  const annotationsPayload = (adds[0]!.cmd as unknown as {
    annotations: Array<{ id: string; type: string; page: number; x: number; y: number; content: string }>;
  }).annotations;
  expect(annotationsPayload).toHaveLength(1);
  const note = annotationsPayload[0]!;
  expect(note.type).toBe("note");
  expect(note.page).toBe(1);
  expect(note.x).toBe(20);
  expect(note.y).toBe(20);
  expect(note.content).toBe("paper-level note");

  // list includes the row.
  const result = await dispatch("scholar.annotations.list", { paper_id: TEST_PAPER }) as { rows: unknown[] };
  expect(result.rows.length).toBeGreaterThan(0);
});

// =============================================================================
// scholar.pdf.open populates ctx.pdfViews (§13 v1.1 invariant — new)
// =============================================================================

test("scholar.pdf.open registers viewUUID under paper_id in ctx.pdfViews", async () => {
  // Drop the seeded entry to prove .open populates it.
  built.ctx.pdfViews.delete(TEST_PAPER);
  expect(built.ctx.pdfViews.get(TEST_PAPER)).toBeUndefined();

  const result = await dispatch("scholar.pdf.open", {
    paper_id: TEST_PAPER,
    source: "/tmp/fixture.pdf",
  }) as { paper_id: string; viewUUID: string };

  expect(result.paper_id).toBe(TEST_PAPER);
  expect(result.viewUUID).toBe(TEST_VIEW_UUID);
  expect(built.ctx.pdfViews.get(TEST_PAPER)).toBe(TEST_VIEW_UUID);
});

// =============================================================================
// Posture-B regression guard (M6 pattern from corpus.test.ts)
// =============================================================================

test("annotations handlers make no sqlite3-mcp calls (posture-B guard)", async () => {
  const strictPdf = new Proxy(built.ctx.pdf, {
    get(target, prop) {
      if (typeof prop === "string" && prop.includes("sqlite3")) {
        throw new Error(`sqlite3-mcp access detected on ctx.pdf: ${String(prop)}`);
      }
      return Reflect.get(target, prop);
    },
  });
  const origPdf = built.ctx.pdf;
  (built.ctx as unknown as { pdf: typeof strictPdf }).pdf = strictPdf;
  try {
    const r = await dispatch("scholar.annotations.upsert", {
      paper_id: TEST_PAPER, body: "guard-test",
    }) as { id: string };
    await dispatch("scholar.annotations.list", { paper_id: TEST_PAPER });
    await dispatch("scholar.annotations.delete", { id: r.id });
  } finally {
    (built.ctx as unknown as { pdf: typeof origPdf }).pdf = origPdf;
  }
  expect(true).toBe(true);
});

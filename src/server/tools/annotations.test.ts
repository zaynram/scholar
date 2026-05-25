// src/server/tools/annotations.test.ts — annotations plan cycle 6.7 (Red)
//
// Tests for scholar.annotations.{list, upsert, delete} and the §13 reconciler.
//
// Test harness: buildServer + applyMigrations + a configurable mock PdfChild
// whose `interact` records every call and (optionally) returns viewer rows
// for a `list_annotations` request. Each test mutates `interactImpl` and
// `interactCalls` between dispatches — the PdfChild instance reference is
// stable so the handler's `ctx.pdf` snapshot picks up the configured impl.
//
// SDK v1.29.0: InMemoryTransport export path (per plan-md F11 round-2 note)
// is not needed here — dispatch() bypasses the transport and routes directly
// through the foundation-009 ToolRegistry per src/server/index.ts.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, type BuiltServer } from "../index.ts";
import { openWithPragmas, applyMigrations } from "../db/migrations.ts";
import { rawClient } from "../db/raw-client.ts";
import { ulid, nowIso } from "../db/nowIso.ts";
import type { PdfChild } from "./registry.ts";

// ─── harness ──────────────────────────────────────────────────────────────────

let dir: string;
let built: BuiltServer;
let interactCalls: Array<{ commands: unknown[]; dbHasRowAtFirstCall?: boolean }>;
let interactImpl: (commands: unknown[]) => Promise<unknown>;
const origRuntimeRoot = process.env.SCHOLAR_RUNTIME_ROOT;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-annotations-test-"));
  mkdirSync(join(dir, "dbs"), { recursive: true });
  process.env.SCHOLAR_RUNTIME_ROOT = dir;

  const configDb = openWithPragmas(join(dir, "dbs", "scholar-config.db"));
  applyMigrations(configDb);

  interactCalls = [];
  // Default impl: list_annotations → []; other ops → null.
  interactImpl = async (commands: unknown[]) => {
    const cmd0 = (commands as Array<{ type: string }>)[0];
    if (cmd0?.type === "list_annotations") return [];
    return null;
  };

  const mockPdf: PdfChild = {
    interact: async (commands: unknown[]) => {
      interactCalls.push({ commands });
      return await interactImpl(commands);
    },
    getText: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
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
    .run("p1", "smith2024", "Test paper", nowIso());
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (origRuntimeRoot === undefined) delete process.env.SCHOLAR_RUNTIME_ROOT;
  else process.env.SCHOLAR_RUNTIME_ROOT = origRuntimeRoot;
});

// ─── tiny helpers ─────────────────────────────────────────────────────────────

const dispatch = (tool: string, args: unknown) => built.dispatch(tool, args);

function findInteract(type: string): unknown[] {
  return interactCalls.filter((c) => {
    const cmd0 = (c.commands as Array<{ type: string }>)[0];
    return cmd0?.type === type;
  }).map((c) => c.commands);
}

// =============================================================================
// Red-13 — NO_ACTIVE_CORPUS guards
// =============================================================================

test("scholar.annotations.list NO_ACTIVE_CORPUS guard fires when ctx.db is undefined", async () => {
  const saved = built.ctx.db;
  built.ctx.db = undefined;
  try {
    await expect(dispatch("scholar.annotations.list", { paper_id: "p1" }))
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
    await expect(dispatch("scholar.annotations.upsert", { paper_id: "p1", body: "x" }))
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
// Red-1 — upsert insert path + write-then-push ordering
// =============================================================================

test("upsert insert: writes annotation with source='scholar', then pushes add_annotations", async () => {
  // Capture DB state at the moment of the first interact call to prove
  // the synchronous write commits BEFORE the await for pdf.interact resolves.
  let dbRowAtFirstInteract: { id: string } | null = null;
  interactImpl = async (commands: unknown[]) => {
    if (dbRowAtFirstInteract === null) {
      dbRowAtFirstInteract =
        (rawClient(built.ctx.db!).query("SELECT id FROM annotations LIMIT 1").get() as
          | { id: string }
          | null);
    }
    const cmd0 = (commands as Array<{ type: string }>)[0];
    if (cmd0?.type === "list_annotations") return [];
    return null;
  };

  const result = await dispatch("scholar.annotations.upsert", {
    paper_id: "p1",
    body: "hello",
    anchor: "§2.1",
  }) as { id: string; source: string; created_at: string; updated_at: string };

  expect(result.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID
  expect(result.source).toBe("scholar");
  expect(result.updated_at >= result.created_at).toBe(true);

  // Write-then-push: at the moment interact was first called, the DB row existed.
  expect(dbRowAtFirstInteract).not.toBeNull();
  expect(dbRowAtFirstInteract!.id).toBe(result.id);

  // Exactly one interact call: add_annotations.
  const addCalls = findInteract("add_annotations");
  expect(addCalls).toHaveLength(1);

  // DB row shape.
  const row = rawClient(built.ctx.db!)
    .query("SELECT * FROM annotations WHERE id = ?")
    .get(result.id) as { id: string; body: string; source: string; deleted_at: string | null };
  expect(row.body).toBe("hello");
  expect(row.source).toBe("scholar");
  expect(row.deleted_at).toBeNull();
});

// =============================================================================
// Red-2 — upsert update path
// =============================================================================

test("upsert update: same id, different body → updates row + pushes update_annotations", async () => {
  const r1 = await dispatch("scholar.annotations.upsert", {
    paper_id: "p1",
    body: "first",
  }) as { id: string; created_at: string };
  // First interact was add_annotations.
  expect(findInteract("add_annotations")).toHaveLength(1);
  // Need the viewer to report the existing id so step-2 picks update_annotations.
  // We use the upsert directly (not via reconcile) — upsert decides on its own
  // by checking if the row exists in the DB pre-write.
  const r2 = await dispatch("scholar.annotations.upsert", {
    id: r1.id,
    paper_id: "p1",
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
// Red-3 — delete soft-delete + tombstone atomicity + remove_annotations push
// =============================================================================

test("delete: soft-deletes annotation AND inserts annotation_tombstones atomically", async () => {
  const r1 = await dispatch("scholar.annotations.upsert", {
    paper_id: "p1",
    body: "to delete",
  }) as { id: string };

  // Verify DB state at the moment of the first interact after delete.
  let stateAtRemove: { deleted_at: string | null; tombstone_id: string | undefined } | null = null;
  interactImpl = async (commands: unknown[]) => {
    const cmd0 = (commands as Array<{ type: string }>)[0];
    if (cmd0?.type === "remove_annotations" && stateAtRemove === null) {
      const row = rawClient(built.ctx.db!)
        .query("SELECT deleted_at FROM annotations WHERE id = ?")
        .get(r1.id) as { deleted_at: string | null };
      const ts = rawClient(built.ctx.db!)
        .query("SELECT annotation_id FROM annotation_tombstones WHERE annotation_id = ?")
        .get(r1.id) as { annotation_id: string } | null;
      stateAtRemove = { deleted_at: row.deleted_at, tombstone_id: ts?.annotation_id };
    }
    if (cmd0?.type === "list_annotations") return [];
    return null;
  };

  await dispatch("scholar.annotations.delete", { id: r1.id });

  // Annotation row: deleted_at set.
  const row = rawClient(built.ctx.db!)
    .query("SELECT deleted_at FROM annotations WHERE id = ?")
    .get(r1.id) as { deleted_at: string | null };
  expect(row.deleted_at).not.toBeNull();

  // Tombstone row: inserted with matching id.
  const tomb = rawClient(built.ctx.db!)
    .query("SELECT annotation_id, paper_id, deleted_at FROM annotation_tombstones WHERE annotation_id = ?")
    .get(r1.id) as { annotation_id: string; paper_id: string; deleted_at: string };
  expect(tomb.annotation_id).toBe(r1.id);
  expect(tomb.paper_id).toBe("p1");
  expect(tomb.deleted_at).toBe(row.deleted_at!);

  // Write-then-push: at the moment remove_annotations fired, both writes were committed.
  expect(stateAtRemove).not.toBeNull();
  expect(stateAtRemove!.deleted_at).not.toBeNull();
  expect(stateAtRemove!.tombstone_id).toBe(r1.id);

  // remove_annotations pushed.
  expect(findInteract("remove_annotations")).toHaveLength(1);
});

// =============================================================================
// Red-3b — delete idempotency
// =============================================================================

test("delete on already-tombstoned annotation is no-op: no second pdf.interact, deleted_at unchanged", async () => {
  const r1 = await dispatch("scholar.annotations.upsert", {
    paper_id: "p1",
    body: "x",
  }) as { id: string };
  await dispatch("scholar.annotations.delete", { id: r1.id });
  const firstDeletedAt = (rawClient(built.ctx.db!)
    .query("SELECT deleted_at FROM annotations WHERE id = ?")
    .get(r1.id) as { deleted_at: string }).deleted_at;

  const removesBefore = findInteract("remove_annotations").length;
  // Second delete on the same id.
  await dispatch("scholar.annotations.delete", { id: r1.id });
  const removesAfter = findInteract("remove_annotations").length;
  expect(removesAfter).toBe(removesBefore); // no new push

  const secondDeletedAt = (rawClient(built.ctx.db!)
    .query("SELECT deleted_at FROM annotations WHERE id = ?")
    .get(r1.id) as { deleted_at: string }).deleted_at;
  expect(secondDeletedAt).toBe(firstDeletedAt); // unchanged
});

// =============================================================================
// Red-10 — list returns live rows (deleted_at IS NULL), Daisy-compatible shape
// =============================================================================

test("list returns rows with deleted_at IS NULL only; shape includes id/page/anchor/body/source/created_at/updated_at", async () => {
  const r1 = await dispatch("scholar.annotations.upsert", {
    paper_id: "p1",
    body: "live note",
    anchor: "§3.2 — key finding paragraph",
    page: 5,
  }) as { id: string };
  const r2 = await dispatch("scholar.annotations.upsert", {
    paper_id: "p1",
    body: "to be deleted",
  }) as { id: string };
  await dispatch("scholar.annotations.delete", { id: r2.id });

  const result = await dispatch("scholar.annotations.list", { paper_id: "p1" }) as {
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
// Red-9 — Tombstone resurrection prevention (the core §13 amendment)
// =============================================================================

test("reconcile: viewer re-emits tombstoned id → phase-3 INSERT skipped; phase-2 cure issues remove_annotations", async () => {
  const r1 = await dispatch("scholar.annotations.upsert", { paper_id: "p1", body: "doomed" }) as { id: string };
  await dispatch("scholar.annotations.delete", { id: r1.id });

  // Clear the call log to focus on the next reconcile.
  interactCalls = [];
  // Viewer is "stuck" — still reports the deleted annotation.
  interactImpl = async (commands: unknown[]) => {
    const cmd0 = (commands as Array<{ type: string }>)[0];
    if (cmd0?.type === "list_annotations") {
      return [{
        id: r1.id,
        page: null,
        anchor: null,
        rect: null,
        body: "doomed",
        created_at: nowIso(),
        updated_at: nowIso(),
      }];
    }
    return null;
  };

  const result = await dispatch("scholar.annotations.list", { paper_id: "p1" }) as { rows: unknown[] };

  // Phase-3 INSERT short-circuit fired: the deleted row was NOT re-inserted.
  expect(result.rows).toHaveLength(0);
  // Annotation in DB is still deleted_at IS NOT NULL.
  const row = rawClient(built.ctx.db!)
    .query("SELECT deleted_at FROM annotations WHERE id = ?")
    .get(r1.id) as { deleted_at: string | null };
  expect(row.deleted_at).not.toBeNull();
  // Phase-2 resurrection cure: a remove_annotations call was issued.
  const removes = findInteract("remove_annotations") as Array<Array<{ ids: string[] }>>;
  expect(removes.length).toBeGreaterThanOrEqual(1);
  // At least one of the removes contains r1.id.
  const containsR1 = removes.some((cmds) => cmds[0]!.ids.includes(r1.id));
  expect(containsR1).toBe(true);
  // annotation_tombstones row still exists (durable; no implicit prune).
  const tomb = rawClient(built.ctx.db!)
    .query("SELECT annotation_id FROM annotation_tombstones WHERE annotation_id = ?")
    .get(r1.id) as { annotation_id: string } | null;
  expect(tomb?.annotation_id).toBe(r1.id);
});

// =============================================================================
// Red-7c — Post-tx delete-recovery for perpetual viewer-side staleness
// =============================================================================

test("reconcile post-tx: when cursor has advanced past deleted_at and viewer still has row, post-tx re-issues remove_annotations", async () => {
  const r1 = await dispatch("scholar.annotations.upsert", { paper_id: "p1", body: "ghost-prone" }) as { id: string };
  await dispatch("scholar.annotations.delete", { id: r1.id });

  // Manually advance the cursor past the deleted_at timestamp by writing
  // an effectively-future last_reconciled_at. This forces scholar_dirty
  // to be empty for r1 on the next reconcile, so the post-tx phase is
  // the only path that re-asserts the remove.
  rawClient(built.ctx.db!)
    .query("INSERT OR REPLACE INTO reconcile_state (corpus_id, paper_id, last_reconciled_at) VALUES (?, ?, ?)")
    .run("annot-corp", "p1", "9999-12-31T23:59:59.999Z");

  interactCalls = [];
  // Viewer still has the (tombstoned) row.
  interactImpl = async (commands: unknown[]) => {
    const cmd0 = (commands as Array<{ type: string }>)[0];
    if (cmd0?.type === "list_annotations") {
      return [{
        id: r1.id,
        page: null,
        anchor: null,
        rect: null,
        body: "ghost-prone",
        created_at: nowIso(),
        updated_at: nowIso(),
      }];
    }
    return null;
  };

  await dispatch("scholar.annotations.list", { paper_id: "p1" });
  const removesFirst = findInteract("remove_annotations").length;
  expect(removesFirst).toBeGreaterThanOrEqual(1);

  // Second list with viewer still mocked — post-tx re-asserts again.
  await dispatch("scholar.annotations.list", { paper_id: "p1" });
  const removesSecond = findInteract("remove_annotations").length;
  expect(removesSecond).toBeGreaterThan(removesFirst);

  // Once viewer drops the row, post-tx does NOT fire.
  interactImpl = async (commands: unknown[]) => {
    const cmd0 = (commands as Array<{ type: string }>)[0];
    if (cmd0?.type === "list_annotations") return [];
    return null;
  };
  await dispatch("scholar.annotations.list", { paper_id: "p1" });
  const removesThird = findInteract("remove_annotations").length;
  expect(removesThird).toBe(removesSecond); // no new remove
});

// =============================================================================
// Red-8 — sanitizeText on user-supplied body and anchor (§12.0)
// =============================================================================

test("upsert rejects body containing bidi-override U+202E before DB write or pdf.interact", async () => {
  const evil = "hello‮world";
  const callsBefore = interactCalls.length;
  await expect(dispatch("scholar.annotations.upsert", {
    paper_id: "p1",
    body: evil,
  })).rejects.toThrow(/bidi/i);
  // No add_annotations was pushed.
  expect(findInteract("add_annotations")).toHaveLength(0);
  expect(interactCalls.length).toBe(callsBefore);
  // No row was inserted.
  const rows = rawClient(built.ctx.db!)
    .query("SELECT id FROM annotations")
    .all() as unknown[];
  expect(rows).toHaveLength(0);
});

test("upsert rejects anchor containing bidi-override U+202E", async () => {
  await expect(dispatch("scholar.annotations.upsert", {
    paper_id: "p1",
    body: "ok",
    anchor: "§2.1‮evil",
  })).rejects.toThrow(/bidi/i);
  expect(findInteract("add_annotations")).toHaveLength(0);
});

// =============================================================================
// Red-8b — sanitizeText on viewer-originated vrow.body (§12.0 inbound)
// =============================================================================

test("reconcile: viewer-originated row with bidi-override body throws before INSERT (phase-3)", async () => {
  // Viewer returns a row with bidi-override embedded.
  interactImpl = async (commands: unknown[]) => {
    const cmd0 = (commands as Array<{ type: string }>)[0];
    if (cmd0?.type === "list_annotations") {
      return [{
        id: ulid(),
        page: null,
        anchor: null,
        rect: null,
        body: "approve invoice‮",
        created_at: nowIso(),
        updated_at: nowIso(),
      }];
    }
    return null;
  };

  await expect(dispatch("scholar.annotations.list", { paper_id: "p1" }))
    .rejects.toThrow(/bidi/i);
  // No annotation was inserted.
  const rows = rawClient(built.ctx.db!)
    .query("SELECT id FROM annotations")
    .all() as unknown[];
  expect(rows).toHaveLength(0);
});

// =============================================================================
// Red-11 — rect JSON validation
// =============================================================================

test("upsert accepts valid 4-element finite rect JSON", async () => {
  const r = await dispatch("scholar.annotations.upsert", {
    paper_id: "p1",
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
    paper_id: "p1", body: "x", rect: "[10, 20, 200]",
  })).rejects.toMatchObject({ code: "INVALID_RECT" });
});

test("upsert rejects rect with non-finite numbers", async () => {
  await expect(dispatch("scholar.annotations.upsert", {
    paper_id: "p1", body: "x", rect: "[10, 20, 200, 1e9999]",
  })).rejects.toMatchObject({ code: "INVALID_RECT" });
});

test("upsert rejects rect with wrong shape (object)", async () => {
  await expect(dispatch("scholar.annotations.upsert", {
    paper_id: "p1", body: "x", rect: '{"x":10}',
  })).rejects.toMatchObject({ code: "INVALID_RECT" });
});

// =============================================================================
// Red-12 — Both-null rect + anchor accepted as paper-level note
// =============================================================================

test("upsert accepts paper-level note (no rect, no anchor); serializeForViewer falls back to fixed margin sticky", async () => {
  const r = await dispatch("scholar.annotations.upsert", {
    paper_id: "p1",
    body: "paper-level note",
  }) as { id: string };

  const row = rawClient(built.ctx.db!)
    .query("SELECT rect, anchor, source FROM annotations WHERE id = ?")
    .get(r.id) as { rect: string | null; anchor: string | null; source: string };
  expect(row.rect).toBeNull();
  expect(row.anchor).toBeNull();
  expect(row.source).toBe("scholar");

  // serializeForViewer (called during push) inserts the fixed sticky rect [20,20,120,60].
  const adds = findInteract("add_annotations") as Array<Array<{ annotations: Array<{ rect: number[] }> }>>;
  expect(adds).toHaveLength(1);
  expect(adds[0]![0]!.annotations[0]!.rect).toEqual([20, 20, 120, 60]);

  // list includes the row.
  const result = await dispatch("scholar.annotations.list", { paper_id: "p1" }) as { rows: unknown[] };
  expect(result.rows.length).toBeGreaterThan(0);
});

// =============================================================================
// Red-4 / happy reconcile — viewer-only row is pulled into scholar
// =============================================================================

test("reconcile pulls viewer-only rows into annotations (scholar_by_id miss → INSERT pdf-viewer source)", async () => {
  const viewerId = ulid();
  interactImpl = async (commands: unknown[]) => {
    const cmd0 = (commands as Array<{ type: string }>)[0];
    if (cmd0?.type === "list_annotations") {
      return [{
        id: viewerId,
        page: 3,
        anchor: "viewer-anchor",
        rect: [1, 2, 3, 4],
        body: "viewer-side note",
        created_at: nowIso(),
        updated_at: nowIso(),
      }];
    }
    return null;
  };

  const result = await dispatch("scholar.annotations.list", { paper_id: "p1" }) as {
    rows: Array<{ id: string; body: string; source: string; page: number | null }>;
  };
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]!.id).toBe(viewerId);
  expect(result.rows[0]!.source).toBe("pdf-viewer");
  expect(result.rows[0]!.body).toBe("viewer-side note");
  expect(result.rows[0]!.page).toBe(3);
});

// =============================================================================
// Red-7b — onConflictDoNothing on same-paper concurrent reconciles
// =============================================================================

test("two concurrent annotations.list on the same paper with viewer-only row: exactly one annotations row inserted; no PK constraint thrown", async () => {
  const viewerId = ulid();
  interactImpl = async (commands: unknown[]) => {
    const cmd0 = (commands as Array<{ type: string }>)[0];
    if (cmd0?.type === "list_annotations") {
      // Synthetic delay so both calls complete phase 1+2 before either runs phase 3.
      await new Promise((r) => setTimeout(r, 5));
      return [{
        id: viewerId,
        page: null,
        anchor: null,
        rect: null,
        body: "viewer note",
        created_at: nowIso(),
        updated_at: nowIso(),
      }];
    }
    return null;
  };

  const [a, b] = await Promise.all([
    dispatch("scholar.annotations.list", { paper_id: "p1" }) as Promise<{ rows: unknown[] }>,
    dispatch("scholar.annotations.list", { paper_id: "p1" }) as Promise<{ rows: unknown[] }>,
  ]);
  expect(a.rows.length).toBe(1);
  expect(b.rows.length).toBe(1);

  const rowCount = (rawClient(built.ctx.db!)
    .query("SELECT COUNT(*) AS c FROM annotations WHERE id = ?")
    .get(viewerId) as { c: number }).c;
  expect(rowCount).toBe(1);
});

// =============================================================================
// Red-5 — viewer rows without updated_at degrade to scholar-authoritative
// =============================================================================

test("reconcile: viewer rows missing updated_at still trigger viewer-only-INSERT but no LWW overwrite", async () => {
  const viewerId = ulid();
  interactImpl = async (commands: unknown[]) => {
    const cmd0 = (commands as Array<{ type: string }>)[0];
    if (cmd0?.type === "list_annotations") {
      return [{
        id: viewerId,
        page: null,
        anchor: null,
        rect: null,
        body: "no-updated_at",
        created_at: null,
        updated_at: null,
      }];
    }
    return null;
  };
  const r = await dispatch("scholar.annotations.list", { paper_id: "p1" }) as {
    rows: Array<{ id: string; body: string }>;
  };
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0]!.id).toBe(viewerId);
  expect(r.rows[0]!.body).toBe("no-updated_at");
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
      paper_id: "p1", body: "guard-test",
    }) as { id: string };
    await dispatch("scholar.annotations.list", { paper_id: "p1" });
    await dispatch("scholar.annotations.delete", { id: r.id });
  } finally {
    (built.ctx as unknown as { pdf: typeof origPdf }).pdf = origPdf;
  }
  expect(true).toBe(true);
});

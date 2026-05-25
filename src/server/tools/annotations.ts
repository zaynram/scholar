// src/server/tools/annotations.ts — annotations plan cycle 6.7 (Green)
//
// Three MCP tools: scholar.annotations.{list, upsert, delete}.
// Implements §13's bidirectional reconciliation against the vendored pdf MCP
// child, plus the spec-amendment-34871f2 tombstone-resurrection fix.
//
// LOAD-BEARING INVARIANTS (preserved verbatim from the plan-md):
//   1. §13 phase ordering — phase-1 reads → phase-2 MCP I/O → phase-3
//      db.transaction with NO awaits inside the closure. The transaction
//      callback is typed `(tx) => void` so async returns are compile-time
//      rejected (constraint #1).
//   2. Write-then-push — handlers commit the synchronous DB write BEFORE
//      forwarding to the pdf child. Failure-safe: a viewer crash after DB
//      write leaves a dirty row that the next reconcile pushes (constraint #2).
//   3. §12.0 sanitizeText — applied to body and anchor on both outbound
//      (user-supplied) and inbound (viewer-originated) paths (constraint #3).
//   4. source hardcoded — upsert input schema excludes source; handler writes
//      "scholar"; only phase-3 step-3 writes "pdf-viewer" (constraint #4).
//   5. NO_ACTIVE_CORPUS guard fires before any DB or pdf-child call
//      (constraint #5).
//   6. deriveRectFromAnchor returns the fixed [20,20,120,60] sticky — geometry-
//      aware anchor resolution is v2 (constraint #6).
//   7. scholar_deleted_ids Set — captured in phase 1 alongside tombstoned_ids;
//      filters phase-3 INSERT to prevent resurrection of any soft-deleted id,
//      not just the tombstone-audit subset (constraint #7).
//   8. ctx.db snapshot-at-entry; ctx.pdf snapshotted alongside (constraint #8 + #15).
//   9. corpus_id from ctx.config.activeCorpusId(); never from tool input
//      (constraint #9).
//  13. Phase-2 step-2 throws propagate — no try/catch in the per-row loop
//      (constraint #13). Self-healing depends on phase-3 NOT running after a
//      partial push.
//  14. Post-tx delete-recovery — after db.transaction(...) returns and before
//      reconcile() resolves, re-assert remove_annotations for any viewer rows
//      whose id is in scholar_deleted_ids. Cures perpetual viewer-side staleness
//      when the cursor has advanced past deleted_at (constraint #14).
//  16. Phase-3 step-3 INSERT uses .onConflictDoNothing() so concurrent same-
//      paper reconciles serialize without throwing PK constraint errors
//      (constraint #16).

import { z } from "zod";
import { and, eq, gt, isNull, or, isNotNull } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { annotations, annotation_tombstones, reconcile_state } from "../db/schema.ts";
import { sanitizeText } from "../ingest/primitives.ts";
import { ulid, nowIso } from "../db/nowIso.ts";
import type { PdfChild, RegisterTools, ServerContext } from "./registry.ts";

// ─── error ────────────────────────────────────────────────────────────────────

class AnnotationsToolError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AnnotationsToolError";
  }
}

// ─── shapes ───────────────────────────────────────────────────────────────────

export type AnnotationRow = typeof annotations.$inferSelect;

type ViewerRow = {
  id: string;
  page?: number | null;
  anchor?: string | null;
  rect?: number[] | null;
  body: string;
  created_at?: string | null;
  updated_at?: string | null;
};

type ViewerAnnotation = {
  id: string;
  page: number | null;
  rect: [number, number, number, number];
  body: string;
  created_at: string;
  updated_at: string;
};

// ─── helpers (file-private) ───────────────────────────────────────────────────

/**
 * v1 fixed margin sticky-note rect. Anchor-geometry-aware resolution is v2
 * (requires PDF geometry from extraction; out-of-scope cross-plan coupling).
 * Constraint #6.
 */
function deriveRectFromAnchor(
  _anchor: string | null | undefined,
): [number, number, number, number] {
  return [20, 20, 120, 60];
}

/**
 * §13 pinned shape. id rides through unchanged (direct ULID — wrap-and-strip
 * branch deferred unless a future probe of pdf@1.7.2 reveals viewer-side id
 * mutation; constraint #12).
 */
function serializeForViewer(row: AnnotationRow): ViewerAnnotation {
  return {
    id: row.id,
    page: row.page,
    rect: row.rect
      ? (JSON.parse(row.rect) as [number, number, number, number])
      : deriveRectFromAnchor(row.anchor),
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Parse + validate the rect JSON. Used by upsert. */
function parseRect(rectStr: string): [number, number, number, number] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rectStr);
  } catch {
    throw new AnnotationsToolError(
      "INVALID_RECT",
      `INVALID_RECT: rect must be a 4-element JSON array of finite numbers; got non-JSON: ${rectStr}`,
    );
  }
  if (!Array.isArray(parsed) || parsed.length !== 4) {
    throw new AnnotationsToolError(
      "INVALID_RECT",
      "INVALID_RECT: rect must be a 4-element JSON array of finite numbers.",
    );
  }
  for (const v of parsed) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new AnnotationsToolError(
        "INVALID_RECT",
        "INVALID_RECT: rect elements must all be finite numbers.",
      );
    }
  }
  return parsed as [number, number, number, number];
}

/** Require an active corpus; throw structured error otherwise. Constraint #5. */
function requireDb(ctx: ServerContext, op: string): BunSQLiteDatabase {
  if (!ctx.db) {
    throw new AnnotationsToolError(
      "NO_ACTIVE_CORPUS",
      `NO_ACTIVE_CORPUS: scholar.annotations.${op} requires an active corpus.`,
    );
  }
  return ctx.db;
}

// ─── §13 reconciler ───────────────────────────────────────────────────────────

/**
 * Bidirectional reconciler. Runs synchronously before every annotations.list
 * to eliminate the model-facing stale window. The three-phase structure keeps
 * SQLite write-lock holding decoupled from pdf-child network I/O — concurrent
 * lists on different papers do NOT serialize behind each other's interact()
 * round-trip.
 *
 * Phase 1 (reads, no tx) → Phase 2 (MCP I/O, no tx) → Phase 3 (write-back,
 * sync tx, no awaits) → Post-tx (re-assert removes for ghosts).
 */
export async function reconcile(
  corpus_id: string,
  paper_id: string,
  db: BunSQLiteDatabase,
  pdf: PdfChild,
): Promise<void> {
  // --- Phase 1: read-only state capture (no tx; no SQLite write lock held). ---

  const cursor = db
    .select({ at: reconcile_state.last_reconciled_at })
    .from(reconcile_state)
    .where(
      and(
        eq(reconcile_state.corpus_id, corpus_id),
        eq(reconcile_state.paper_id, paper_id),
      ),
    )
    .get()?.at ?? "1970-01-01T00:00:00.000Z";

  const scholar_dirty = db
    .select()
    .from(annotations)
    .where(
      and(
        eq(annotations.paper_id, paper_id),
        or(gt(annotations.updated_at, cursor), gt(annotations.deleted_at, cursor)),
      ),
    )
    .all();

  const scholar_all_live = db
    .select()
    .from(annotations)
    .where(
      and(
        eq(annotations.paper_id, paper_id),
        isNull(annotations.deleted_at),
      ),
    )
    .all();
  const scholar_by_id = new Map(scholar_all_live.map((r) => [r.id, r]));

  // Constraint #7: every currently soft-deleted id for this paper — stricter
  // than tombstoned_ids (which only includes explicit .delete-tool inserts).
  // Used in phase-3 step-3 INSERT filter and in the post-tx delete-recovery loop.
  const scholar_deleted_ids = new Set(
    db
      .select({ id: annotations.id })
      .from(annotations)
      .where(
        and(
          eq(annotations.paper_id, paper_id),
          isNotNull(annotations.deleted_at),
        ),
      )
      .all()
      .map((r) => r.id),
  );

  // Spec §13 tombstoned_ids — drives the phase-2 resurrection-cure call.
  const tombstoned_ids = new Set(
    db
      .select({ id: annotation_tombstones.annotation_id })
      .from(annotation_tombstones)
      .where(eq(annotation_tombstones.paper_id, paper_id))
      .all()
      .map((r) => r.id),
  );

  // --- Phase 2: MCP round-trips (await on network; no SQLite tx open). ---

  const viewer_rows = (await pdf.interact([
    { type: "list_annotations", paper_id },
  ])) as ViewerRow[];
  const viewer_by_id = new Map(viewer_rows.map((r) => [r.id, r]));

  // Step 1: tombstone-push + resurrection cure. Folds (a) freshly-deleted
  // dirty rows and (b) any tombstoned id the viewer is still reporting live
  // into a single remove_annotations call. The (b) leg is the cure for
  // amendment 34871f2 — without it, the phase-3 suppression masks the bug
  // but never actually cleans up the viewer-side row.
  const fresh_tombstone_ids = scholar_dirty
    .filter((r) => r.deleted_at !== null)
    .map((r) => r.id);
  const resurrected_ids = viewer_rows
    .filter((v) => tombstoned_ids.has(v.id))
    .map((v) => v.id);
  const ids_to_remove = Array.from(
    new Set([...fresh_tombstone_ids, ...resurrected_ids]),
  );
  if (ids_to_remove.length > 0) {
    await pdf.interact([{ type: "remove_annotations", ids: ids_to_remove }]);
  }

  // Step 2: per-row push of live add/update. Per spec §13, mixed add+update
  // batch semantics are unverified against pdf@1.7.2; we issue one call per
  // dirty row. If a probe later confirms mixed batching is supported, this
  // loop collapses to one call.
  //
  // Constraint #13: throws here propagate. Do NOT wrap in try/catch — the
  // self-healing property depends on phase-3 NOT running after a partial push.
  const live_changes = scholar_dirty.filter((r) => r.deleted_at === null);
  for (const row of live_changes) {
    const op = viewer_by_id.has(row.id) ? "update_annotations" : "add_annotations";
    await pdf.interact([{ type: op, annotations: [serializeForViewer(row)] }]);
  }

  // --- Phase 3: local write-back inside a single Drizzle transaction. No awaits. ---
  //
  // Callback typed `(tx) => void` so a future maintainer who writes
  // `db.transaction(async (tx) => ...)` fails compilation rather than
  // silently degrading the §13 invariant.
  const now = nowIso();
  db.transaction((tx): void => {
    // Step 3: viewer-only rows → pull. Tombstoned/soft-deleted ids skipped
    // (resurrection prevention; spec amendment 34871f2 + constraint #7).
    // INSERT uses .onConflictDoNothing() so concurrent same-paper reconciles
    // serialize without throwing PK constraint errors (constraint #16).
    for (const vrow of viewer_rows) {
      if (tombstoned_ids.has(vrow.id)) continue;
      if (scholar_deleted_ids.has(vrow.id)) continue;
      const srow = scholar_by_id.get(vrow.id);
      if (!srow) {
        // Inbound sanitization: viewer text is untrusted (§12.0 constraint #3).
        const safeBody = sanitizeText(vrow.body);
        const safeAnchor = vrow.anchor != null ? sanitizeText(vrow.anchor) : null;
        tx.insert(annotations)
          .values({
            id: vrow.id,
            paper_id,
            page: vrow.page ?? null,
            anchor: safeAnchor,
            rect: vrow.rect ? JSON.stringify(vrow.rect) : null,
            body: safeBody,
            source: "pdf-viewer",
            created_at: vrow.created_at ?? now,
            updated_at: vrow.updated_at ?? now,
            deleted_at: null,
          })
          .onConflictDoNothing()
          .run();
      } else if (vrow.updated_at && vrow.updated_at > srow.updated_at) {
        // LWW with strict-greater tie-break (constraint #11: scholar wins on ==).
        const safeBody = sanitizeText(vrow.body);
        tx.update(annotations)
          .set({
            body: safeBody,
            rect: vrow.rect ? JSON.stringify(vrow.rect) : null,
            source: "pdf-viewer",
            updated_at: vrow.updated_at,
          })
          .where(eq(annotations.id, vrow.id))
          .run();
      }
    }

    // Step 4: scholar-only rows OLDER than cursor and missing from the viewer
    // → treat as viewer-side deletions and tombstone in scholar.
    for (const srow of scholar_all_live) {
      if (srow.updated_at <= cursor && !viewer_by_id.has(srow.id)) {
        tx.update(annotations)
          .set({ deleted_at: now })
          .where(eq(annotations.id, srow.id))
          .run();
      }
    }

    // Step 5: advance cursor.
    tx.insert(reconcile_state)
      .values({ corpus_id, paper_id, last_reconciled_at: now })
      .onConflictDoUpdate({
        target: [reconcile_state.corpus_id, reconcile_state.paper_id],
        set: { last_reconciled_at: now },
      })
      .run();
  });

  // --- Post-tx phase: re-assert removes for viewer rows blocked by the F7 filter. ---
  //
  // Constraint #14: once the cursor has advanced past deleted_at, the
  // tombstone no longer appears in scholar_dirty so the phase-2 cure (which
  // depends on tombstoned_ids) might still fire for tool-deleted rows, but a
  // reconciler-set soft-delete (phase-3 step-4) is NOT in annotation_tombstones
  // and would never re-push. This loop fills that gap by issuing remove_annotations
  // for ANY soft-deleted id the viewer is still reporting. Throws propagate
  // (same reasoning as constraint #13).
  for (const vrow of viewer_rows) {
    if (scholar_deleted_ids.has(vrow.id)) {
      await pdf.interact([{ type: "remove_annotations", ids: [vrow.id] }]);
    }
  }
}

// ─── handlers ─────────────────────────────────────────────────────────────────

type UpsertArgs = {
  id?: string;
  paper_id: string;
  page?: number | null;
  anchor?: string | null;
  rect?: string | null;
  body: string;
};

type ListArgs = { paper_id: string };
type DeleteArgs = { id: string };

async function handleList(args: unknown, ctx: ServerContext): Promise<unknown> {
  const db = requireDb(ctx, "list");
  const pdf = ctx.pdf;
  const { paper_id } = args as ListArgs;
  const corpus_id = ctx.config.activeCorpusId();
  if (!corpus_id) {
    // Shouldn't happen if ctx.db is set, but guard defensively.
    throw new AnnotationsToolError(
      "NO_ACTIVE_CORPUS",
      "NO_ACTIVE_CORPUS: scholar.annotations.list could not resolve active corpus id.",
    );
  }
  await reconcile(corpus_id, paper_id, db, pdf);
  const rows = db
    .select()
    .from(annotations)
    .where(
      and(
        eq(annotations.paper_id, paper_id),
        isNull(annotations.deleted_at),
      ),
    )
    .all();
  return { rows };
}

async function handleUpsert(args: unknown, ctx: ServerContext): Promise<unknown> {
  const db = requireDb(ctx, "upsert");
  const pdf = ctx.pdf;
  const input = args as UpsertArgs;
  if (!input || typeof input.body !== "string" || typeof input.paper_id !== "string") {
    throw new AnnotationsToolError(
      "INVALID_ARGS",
      "INVALID_ARGS: paper_id and body are required.",
    );
  }

  // Outbound sanitization (§12.0 constraint #3 outbound). Throws SanitizeError
  // before any DB write or pdf-child call.
  const safeBody = sanitizeText(input.body);
  const safeAnchor = input.anchor != null ? sanitizeText(input.anchor) : null;
  const rectArr = input.rect != null ? parseRect(input.rect) : null;
  const rectJson = rectArr ? JSON.stringify(rectArr) : null;
  const page = input.page ?? null;

  // Read current row (if id supplied) to choose insert-vs-update + preserve created_at.
  let existing: AnnotationRow | undefined;
  if (input.id) {
    existing = db
      .select()
      .from(annotations)
      .where(eq(annotations.id, input.id))
      .get();
  }

  const now = nowIso();
  let savedRow: AnnotationRow;
  if (existing) {
    db.update(annotations)
      .set({
        page,
        anchor: safeAnchor,
        rect: rectJson,
        body: safeBody,
        source: "scholar",
        updated_at: now,
      })
      .where(eq(annotations.id, existing.id))
      .run();
    savedRow = {
      ...existing,
      page,
      anchor: safeAnchor,
      rect: rectJson,
      body: safeBody,
      source: "scholar",
      updated_at: now,
    };
  } else {
    const id = input.id ?? ulid();
    db.insert(annotations)
      .values({
        id,
        paper_id: input.paper_id,
        page,
        anchor: safeAnchor,
        rect: rectJson,
        body: safeBody,
        source: "scholar",
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })
      .run();
    savedRow = {
      id,
      paper_id: input.paper_id,
      page,
      anchor: safeAnchor,
      rect: rectJson,
      body: safeBody,
      source: "scholar",
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
  }

  // Write-then-push (constraint #2): the DB write above committed synchronously
  // before this await. A viewer crash here leaves a dirty row that the next
  // reconcile will pick up via scholar_dirty (updated_at > cursor).
  const op = existing ? "update_annotations" : "add_annotations";
  await pdf.interact([{ type: op, annotations: [serializeForViewer(savedRow)] }]);

  return savedRow;
}

async function handleDelete(args: unknown, ctx: ServerContext): Promise<unknown> {
  const db = requireDb(ctx, "delete");
  const pdf = ctx.pdf;
  const { id } = args as DeleteArgs;
  if (typeof id !== "string") {
    throw new AnnotationsToolError("INVALID_ARGS", "INVALID_ARGS: id is required.");
  }
  const existing = db
    .select()
    .from(annotations)
    .where(eq(annotations.id, id))
    .get();
  if (!existing) {
    // No row to delete — silent success keeps the surface idempotent for stale
    // viewer pushes; treat as a no-op (no row to tombstone).
    return { id, deleted: false, reason: "not_found" };
  }
  // Constraint #3b: idempotent on already-tombstoned rows. No second
  // deleted_at write, no second tombstone insert, no second pdf.interact.
  if (existing.deleted_at !== null) {
    return { id, deleted: false, reason: "already_tombstoned", deleted_at: existing.deleted_at };
  }

  const now = nowIso();
  // Constraint #8 atomicity: deleted_at + annotation_tombstones in a single tx.
  db.transaction((tx): void => {
    tx.update(annotations)
      .set({ deleted_at: now })
      .where(eq(annotations.id, id))
      .run();
    tx.insert(annotation_tombstones)
      .values({
        annotation_id: id,
        paper_id: existing.paper_id,
        deleted_at: now,
        deleted_by: "scholar",
        deletion_reason: null,
      })
      .onConflictDoNothing()
      .run();
  });

  // Write-then-push.
  await pdf.interact([{ type: "remove_annotations", ids: [id] }]);
  return { id, deleted: true, deleted_at: now };
}

// ─── registerTools ────────────────────────────────────────────────────────────

export const registerTools: RegisterTools = (_server, ctx, _register) => {
  _register(
    "scholar.annotations.list",
    {
      description:
        "List live annotations for a paper. Runs §13's bidirectional reconciler " +
        "(scholar ↔ vendored pdf MCP child) before returning, so the model never " +
        "observes an annotation set that disagrees with the viewer.",
      inputSchema: z.object({ paper_id: z.string().min(1) }),
    },
    handleList,
  );
  _register(
    "scholar.annotations.upsert",
    {
      description:
        "Create or update an annotation. id is optional on insert (a ULID is " +
        "generated). On update, created_at is preserved; source is hardcoded " +
        "to 'scholar'. Pushes add_annotations/update_annotations to the pdf " +
        "child AFTER the DB write commits (write-then-push, §13).",
      inputSchema: z.object({
        id: z.string().optional(),
        paper_id: z.string().min(1),
        page: z.number().int().nullable().optional(),
        anchor: z.string().nullable().optional(),
        // 4-element JSON string of finite numbers; validated before persist.
        rect: z.string().nullable().optional(),
        body: z.string().min(1),
        // source intentionally excluded (constraint #4).
      }),
    },
    handleUpsert,
  );
  _register(
    "scholar.annotations.delete",
    {
      description:
        "Soft-delete an annotation. Sets annotations.deleted_at AND inserts an " +
        "annotation_tombstones row atomically (§13 propagation model), then " +
        "pushes remove_annotations to the pdf child. Idempotent on already-" +
        "tombstoned ids.",
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    handleDelete,
  );
};

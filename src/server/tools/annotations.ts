// src/server/tools/annotations.ts — annotations plan cycle 6.7 (§13 v1.1)
//
// Three MCP tools: scholar.annotations.{list, upsert, delete}.
// Implements the push-only annotation contract per spec §13 v1.1 (2026-05-27
// amendment). The bidirectional reconciler from v1.0 was retired when the
// production-readiness audit found that it depended on `list_annotations` —
// a vendor command that @modelcontextprotocol/server-pdf@1.7.2 does not expose.
//
// LOAD-BEARING INVARIANTS (push-only):
//   1. Write-then-push — handlers commit the synchronous DB write BEFORE
//      forwarding to the pdf child. Failure-safe: a viewer crash after the
//      write leaves a dirty row that the user can re-push by re-invoking
//      upsert with the same id.
//   2. §12.0 sanitizeText — applied to user-supplied body and anchor on the
//      outbound (upsert) path. Throws before any DB write or pdf-child call.
//      Inbound sanitization is moot — there is no inbound path under v1.1.
//   3. source hardcoded — upsert input schema excludes source; handler always
//      writes "scholar". The "pdf-viewer" enum value persists in the §8.2
//      CHECK constraint to keep older v0.x corpora validating; new writes
//      never use it.
//   4. NO_ACTIVE_CORPUS guard fires before any DB or pdf-child call.
//   5. NO_OPEN_VIEWER guard fires when ctx.pdfViews has no entry for the
//      target paper_id. upsert/delete throw; list does NOT — list is a pure
//      DB read and works against closed-viewer papers.
//   6. ctx.db snapshot-at-entry; ctx.pdf snapshotted alongside; ctx.pdfViews
//      read at viewUUID-resolution time.
//   7. corpus_id from ctx.config.activeCorpusId(); never from tool input.
//   8. deriveRectFromAnchor returns the fixed [20,20,120,60] sticky — geometry-
//      aware anchor resolution is v2.

import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { annotations } from "../db/schema.ts";
import { sanitizeText } from "../ingest/primitives.ts";
import { ulid, nowIso } from "../db/nowIso.ts";
import type { PdfChild, RegisterTools, ServerContext } from "./registry.ts";
import type { NoteAnnotation } from "../../vendor/pdf-server/dist/src/pdf-annotations.js";

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

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Default sticky-note origin when no rect was supplied. v1 ships a fixed
 * top-left margin position; geometry-aware anchor resolution is v2.
 */
const DEFAULT_NOTE_ORIGIN: { x: number; y: number } = { x: 20, y: 20 };

/**
 * Map a scholar annotation row to the vendor's `note` annotation shape
 * (single source of truth: src/vendor/pdf-server/dist/src/pdf-annotations.d.ts).
 *
 * Mapping rationale (§13 v1.1 + §16 vendor-truth invariant):
 *   - scholar's rect [x,y,w,h] is collapsed to vendor's (x, y); vendor's
 *     `note` doesn't carry width/height — the sticky icon is fixed-size.
 *   - scholar's anchor metadata (if any) is prefixed onto content so the
 *     viewer's sticky text box shows it.
 *   - page defaults to 1 because vendor requires `number` and scholar
 *     persists `page: number | null` (paper-level notes carry no page).
 *
 * The discriminator type="note" is hard-coded — scholar v1 only emits
 * sticky notes. Highlight/underline/etc. are out of scope until v2.
 */
function serializeForViewer(row: AnnotationRow): NoteAnnotation {
  const rect = row.rect
    ? (JSON.parse(row.rect) as [number, number, number, number])
    : null;
  const x = rect ? rect[0] : DEFAULT_NOTE_ORIGIN.x;
  const y = rect ? rect[1] : DEFAULT_NOTE_ORIGIN.y;
  const content = row.anchor ? `${row.anchor}\n\n${row.body}` : row.body;
  return {
    id: row.id,
    type: "note",
    page: row.page ?? 1,
    x,
    y,
    content,
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

/** Require an active corpus; throw structured error otherwise. */
function requireDb(ctx: ServerContext, op: string): BunSQLiteDatabase {
  if (!ctx.db) {
    throw new AnnotationsToolError(
      "NO_ACTIVE_CORPUS",
      `NO_ACTIVE_CORPUS: scholar.annotations.${op} requires an active corpus.`,
    );
  }
  return ctx.db;
}

/**
 * Resolve viewUUID for a paper_id from the in-process map populated by
 * scholar.pdf.open. Throws NO_OPEN_VIEWER on miss — the user re-opens the
 * viewer to refresh the entry (§13 viewUUID propagation).
 */
function requireViewUUID(ctx: ServerContext, paper_id: string, op: string): string {
  const viewUUID = ctx.pdfViews.get(paper_id);
  if (!viewUUID) {
    throw new AnnotationsToolError(
      "NO_OPEN_VIEWER",
      `NO_OPEN_VIEWER: scholar.annotations.${op} requires scholar.pdf.open(paper_id=${paper_id}) to be called first so the viewUUID is registered in ctx.pdfViews.`,
    );
  }
  return viewUUID;
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
  // §13 v1.1: pure DB read. Does NOT require an open viewer — closed-viewer
  // papers still return their persisted rows.
  const db = requireDb(ctx, "list");
  const { paper_id } = args as ListArgs;
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
  const pdf: PdfChild = ctx.pdf;
  const input = args as UpsertArgs;
  if (!input || typeof input.body !== "string" || typeof input.paper_id !== "string") {
    throw new AnnotationsToolError(
      "INVALID_ARGS",
      "INVALID_ARGS: paper_id and body are required.",
    );
  }
  // viewUUID resolved BEFORE sanitization so a missing-viewer error fires
  // before any string parsing — keeps the error ordering predictable.
  const viewUUID = requireViewUUID(ctx, input.paper_id, "upsert");

  // §12.0 sanitization (constraint #2). Throws SanitizeError before DB or push.
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

  // Write-then-push (constraint #1): the DB write above committed synchronously
  // before this await. A throw here leaves a dirty row that the user can
  // re-push by re-invoking upsert with the same id (idempotent on existing id).
  const action = existing ? "update_annotations" : "add_annotations";
  await pdf.interact(
    { type: action, annotations: [serializeForViewer(savedRow)] },
    { viewUUID },
  );

  return savedRow;
}

async function handleDelete(args: unknown, ctx: ServerContext): Promise<unknown> {
  const db = requireDb(ctx, "delete");
  const pdf: PdfChild = ctx.pdf;
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
    // Idempotent on missing id — keeps the surface resilient to stale viewer
    // pushes; treat as a no-op (no row to tombstone, no push to send).
    return { id, deleted: false, reason: "not_found" };
  }
  // Idempotent on already-tombstoned rows — no second deleted_at write, no
  // second pdf.interact.
  if (existing.deleted_at !== null) {
    return {
      id,
      deleted: false,
      reason: "already_tombstoned",
      deleted_at: existing.deleted_at,
    };
  }
  // viewUUID resolved AFTER existence + idempotency checks so a delete on an
  // already-tombstoned row is a clean no-op even when no viewer is open.
  const viewUUID = requireViewUUID(ctx, existing.paper_id, "delete");

  const now = nowIso();
  // Single-statement update — under v1.1 the atomic tombstones pair retired.
  db.update(annotations)
    .set({ deleted_at: now })
    .where(eq(annotations.id, id))
    .run();

  // Write-then-push.
  await pdf.interact({ type: "remove_annotations", ids: [id] }, { viewUUID });
  return { id, deleted: true, deleted_at: now };
}

// ─── registerTools ────────────────────────────────────────────────────────────

export const registerTools: RegisterTools = (_server, ctx, _register) => {
  _register(
    "scholar.annotations.list",
    {
      description:
        "List live annotations for a paper. Pure DB read under §13 v1.1 push-only; " +
        "does NOT require an open viewer.",
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
        "to 'scholar'. Pushes add/update_annotations to the pdf child via " +
        "ctx.pdfViews[paper_id] AFTER the DB write commits (write-then-push, §13).",
      inputSchema: z.object({
        id: z.string().optional(),
        paper_id: z.string().min(1),
        page: z.number().int().nullable().optional(),
        anchor: z.string().nullable().optional(),
        rect: z.string().nullable().optional(),
        body: z.string().min(1),
      }),
    },
    handleUpsert,
  );
  _register(
    "scholar.annotations.delete",
    {
      description:
        "Soft-delete an annotation. Sets annotations.deleted_at and pushes " +
        "remove_annotations to the pdf child via ctx.pdfViews[paper_id]. " +
        "Idempotent on already-tombstoned ids (no-op).",
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    handleDelete,
  );
};

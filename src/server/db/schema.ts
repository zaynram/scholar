// src/server/db/schema.ts — foundation cycle 6.1 (Task 1.4)
//
// Transcription of spec §8.1 + §8.2. Drizzle migrate() applies all of these
// tables to any DB passed to applyMigrations(); the config DB and the per-corpus
// DB are SEPARATE files at runtime (different paths) but share this single
// schema definition. Per spec §8 the conceptual split is:
//   - config DB tables: corpora, pdf_roots, settings (machine-global)
//   - per-corpus DB tables: papers, paper_chunks, annotations, reconcile_state,
//     digests, reading_prompts, anchor_cache, snapshots, citations, settings
//     (corpus-bound, travels with the corpus when packed)
// Each runtime DB ends up with extra unused tables; that overhead is acceptable
// and avoids two-schema migration plumbing.
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from "drizzle-orm/sqlite-core";

// =========================================================================
// CONFIG DB (§8.1)
// =========================================================================

/**
 * Per-corpus registration. The active corpus is selected via
 * `scholar.corpus.activate`; the resulting `corpus_id` indexes both pdf_roots
 * (this DB) and the per-corpus DB file lookup.
 */
export const corpora = sqliteTable("corpora", {
  id: text("id").primaryKey(), // slug, e.g. "daisy"
  display_name: text("display_name").notNull(),
  created_at: text("created_at").notNull(),
  last_opened_at: text("last_opened_at"), // ISO-8601 UTC; updated by initOnce on corpus-open (§7.3 step 4)
  archived_at: text("archived_at"), // null = active
});

export const pdf_roots = sqliteTable(
  "pdf_roots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    corpus_id: text("corpus_id")
      .notNull()
      .references(() => corpora.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    is_default: integer("is_default", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    corpus_idx: index("pdf_roots_corpus_idx").on(t.corpus_id),
    // Exactly one default root per corpus. Partial unique — only is_default=1 rows are
    // uniqueness-checked, so corpora may carry many is_default=false rows.
    one_default: uniqueIndex("pdf_roots_one_default_idx").on(t.corpus_id).where(sql`is_default = 1`),
  }),
);

/**
 * Shared by config-DB and per-corpus-DB. The config-DB row set holds
 * machine-global preferences (Ollama overrides, host pairing). The per-corpus
 * row set holds corpus-bound state (embed.model, embed.dim, chunk_vec.created).
 * Drizzle issues one `CREATE TABLE settings (key, value)` migration; both
 * physical DBs end up with the same table shape and the consumer plans write
 * the appropriate key set.
 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON-encoded
});

// =========================================================================
// PER-CORPUS DB (§8.2)
// =========================================================================

export const papers = sqliteTable(
  "papers",
  {
    id: text("id").primaryKey(), // ULID
    key: text("key").notNull().unique(), // human-friendly bibkey
    title: text("title").notNull(),
    authors: text("authors"),
    year: integer("year"),
    venue: text("venue"),
    doi: text("doi"),
    arxiv_id: text("arxiv_id"),
    pdf_path: text("pdf_path"),
    role: text("role"),
    section: text("section"),
    depth: text("depth"), // "cited" | "background" | "deep"
    status: text("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(0),
    abstract: text("abstract"),
    imported_via: text("imported_via"),
    imported_at: text("imported_at").notNull(),
    status_touched_at: text("status_touched_at"),
  },
  (t) => ({
    status_idx: index("papers_status_idx").on(t.status),
    section_idx: index("papers_section_idx").on(t.section),
    // §12.1 DOI-first dedupe — uniqueness without rejecting null DOIs.
    doi_uniq: uniqueIndex("papers_doi_idx").on(t.doi).where(sql`doi IS NOT NULL`),
    arxiv_uniq: uniqueIndex("papers_arxiv_idx").on(t.arxiv_id).where(sql`arxiv_id IS NOT NULL`),
    status_ck: check("papers_status_ck", sql`status IN ('pending','reading','reviewed','skip')`),
    depth_ck: check("papers_depth_ck", sql`depth IS NULL OR depth IN ('cited','background','deep')`),
    imp_via_ck: check(
      "papers_imported_via_ck",
      sql`imported_via IS NULL OR imported_via IN ('bibtex','ris','crossref','arxiv','manual')`,
    ),
  }),
);

export const paper_chunks = sqliteTable(
  "paper_chunks",
  {
    id: text("id").primaryKey(), // fresh ulid() per row, per Ruling B 2026-05-24
    paper_id: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    page: integer("page"),
    text: text("text").notNull(),
    // null until embedded into chunk_vec; non-null = embed landed.
    // Catch-up scan after Ollama outage uses the partial index below.
    embedded_at: text("embedded_at"),
  },
  (t) => ({
    // §11.5 UPSERT-on-natural-key — extraction's UPSERT requires this uniqueness
    // at the storage layer, not just by convention.
    paper_ord_uniq: uniqueIndex("paper_chunks_paper_ord_idx").on(t.paper_id, t.ordinal),
    pending_idx: index("paper_chunks_pending_idx").on(t.id).where(sql`embedded_at IS NULL`),
  }),
);

// chunk_vec virtual table — created by src/server/db/raw-ddl.ts (NOT Drizzle).

export const annotations = sqliteTable(
  "annotations",
  {
    id: text("id").primaryKey(), // matches child pdf MCP's annotation IDs for compat
    paper_id: text("paper_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    page: integer("page"),
    anchor: text("anchor"),
    rect: text("rect"), // JSON-encoded [x1,y1,x2,y2]
    body: text("body").notNull(),
    source: text("source").notNull(), // "scholar" | "pdf-viewer"
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
    deleted_at: text("deleted_at"), // soft-delete tombstone
  },
  (t) => ({
    paper_idx: index("annotations_paper_idx").on(t.paper_id),
    paper_dirty_idx: index("annotations_paper_dirty_idx").on(t.paper_id, t.updated_at),
    source_ck: check("annotations_source_ck", sql`source IN ('scholar','pdf-viewer')`),
  }),
);

/**
 * Resurrection-prevention audit log for annotation deletes. Inserted in the same
 * db.transaction(...) as the soft-delete in annotations.deleted_at (see §13 propagation
 * model and reconciler). The §13 reconciler loads the per-paper tombstone-id set in
 * phase 1 and uses it as an in-memory filter in phase 3 step 3, preventing a viewer-side
 * re-emergence of a deleted annotation from re-inserting. v1 keeps tombstones forever —
 * no TTL, no background sweep, no lazy prune (see §13 "Tombstone retention"); the
 * per-corpus DB stays small because tombstones are bounded by user delete actions, not
 * by paper count, and any TTL would re-introduce the resurrection bug for tombstones
 * older than the window.
 *
 * No FK to annotations(id): the tombstone is canonical and must survive a hypothetical
 * hard-delete of the annotations row (e.g., a future schema migration that compacts
 * soft-deleted rows). annotation_id is treated as an opaque ULID label here. The
 * timestamp is TEXT/ISO to match annotations.deleted_at and reconcile_state
 * .last_reconciled_at — uniform timestamp typing across §8.2 overrides the chore's
 * integer-millis suggestion (decision logged here for §13 amendment 2026-05-25).
 */
export const annotation_tombstones = sqliteTable("annotation_tombstones", {
  annotation_id:   text("annotation_id").primaryKey(),  // matches the deleted annotations.id (ULID)
  paper_id:        text("paper_id").notNull(),          // denormalized for fast per-paper SELECT in §13 phase 1
  deleted_at:      text("deleted_at").notNull(),        // ISO; mirrors the annotations.deleted_at value at delete time
  deleted_by:      text("deleted_by"),                  // optional audit: 'scholar' | tool name | user identity
  deletion_reason: text("deletion_reason"),             // optional free-form audit string
}, (t) => ({
  paper_idx: index("annotation_tombstones_paper_idx").on(t.paper_id),
}));

export const reconcile_state = sqliteTable(
  "reconcile_state",
  {
    corpus_id: text("corpus_id").notNull(),
    paper_id: text("paper_id").notNull(),
    last_reconciled_at: text("last_reconciled_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.corpus_id, t.paper_id] }),
  }),
);

export const anchor_cache = sqliteTable("anchor_cache", {
  paper_id: text("paper_id")
    .primaryKey()
    .references(() => papers.id, { onDelete: "cascade" }),
  anchors_json: text("anchors_json").notNull(),
  pages: integer("pages"),
  generated_at: text("generated_at").notNull(),
  extractor: text("extractor"),
});

export const reading_prompts = sqliteTable("reading_prompts", {
  paper_id: text("paper_id")
    .primaryKey()
    .references(() => papers.id, { onDelete: "cascade" }),
  prompts_json: text("prompts_json").notNull(),
  generated_at: text("generated_at").notNull(),
  model: text("model"),
});

export const digests = sqliteTable(
  "digests",
  {
    id: text("id").primaryKey(),
    scope_key: text("scope_key").notNull(),
    scope_signature: text("scope_signature").notNull(),
    body_md: text("body_md").notNull(),
    generated_at: text("generated_at").notNull(),
    model: text("model"),
    paper_count: integer("paper_count"),
  },
  (t) => ({
    scope_idx: index("digests_scope_idx").on(t.scope_key),
  }),
);

/**
 * Snapshot payload — typed shape pinned (§8.2 Session 2 / Data F10). Stored
 * as JSON in snapshots.payload; consumer plans validate at read time.
 */
export type SnapshotPayload = {
  paper_ids: string[];
  statuses: Record<string, "pending" | "reading" | "reviewed" | "skip">;
  priorities: Record<string, number>;
  selection?: string[];
  counts: { total: number; pending: number; reading: number; reviewed: number; skip: number };
};

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    taken_at: text("taken_at").notNull(),
    payload: text("payload").notNull(), // JSON-encoded SnapshotPayload
    trigger: text("trigger"), // "open" | "manual"
  },
  (t) => ({
    trigger_ck: check("snapshots_trigger_ck", sql`trigger IS NULL OR trigger IN ('open','manual')`),
  }),
);

export const citations = sqliteTable(
  "citations",
  {
    citing_id: text("citing_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
    cited_id: text("cited_id")
      .notNull()
      .references(() => papers.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.citing_id, t.cited_id] }),
  }),
);

// reading_queue view + chunk_vec virtual table — created by raw-ddl.ts (NOT Drizzle).

/**
 * Inferred row type for `corpora` — exported type-only so registry.ts can
 * declare its `CorpusRow` contract by importing from here. Per spec §8.1.
 */
export type CorpusRow = typeof corpora.$inferSelect;

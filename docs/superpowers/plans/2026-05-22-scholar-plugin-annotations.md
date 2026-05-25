# Plan: 2026-05-22-scholar-plugin-annotations

| Field         | Value                                                       |
|---------------|-------------------------------------------------------------|
| **Plan ID**   | `2026-05-22-scholar-plugin-annotations`                     |
| **Plan group**| `2026-05-22-scholar-plugin`                                 |
| **Cycles**    | `[6.7]`                                                     |
| **Depends-on**| `corpus` (plan-level; corpus transitively pulls foundation) |
| **Blast-radius** | `src/server/tools/annotations.ts`                        |
| **Worktree**  | `not-required`                                              |
| **Tier**      | `sonnet` — one cycle with one bounded concern; the §13 reconciler algorithm is fully documented in the spec; no cross-cutting symbol discovery or root-cause judgment required |

---

## Context

Cycle 6.7 fills the body of `src/server/tools/annotations.ts`, which foundation (cycle 6.1) scaffolded as a no-op stub. The stub exports `registerTools(server, ctx)` with an empty body; this plan replaces that body with:

- Three MCP tools: `scholar.annotations.list`, `scholar.annotations.upsert`, `scholar.annotations.delete`.
- The `reconcile(corpus_id, paper_id, db, pdf)` function (§13 reconciler algorithm + preemptive tombstone-resurrection fix + post-tx delete-recovery phase — see constraints #7 and #14).
- The `serializeForViewer(row)` helper (§13, pinned shape).
- The `deriveRectFromAnchor()` stub (fixed margin sticky-note — see constraint #6).

> **Dispatcher shorthand note.** The dispatcher prompt refers to "annotations.create / annotations.update" as shorthand. The spec (§5.8 + §13) defines the actual surface as `upsert` (covering both insert and update paths) and `delete`. Tests below exercise `upsert` on the insert path, `upsert` on the update path, and `delete` for the soft-delete tombstone. No separate `create` or `update` tools are introduced.

---

## Load-bearing Constraints

### 1 — No `await` inside `db.transaction(...)` (§13, advisor-flagged)

> **INVARIANT (spec §13).** The `db.transaction(...)` closure in phase 3 of `reconcile` is synchronous. No `await` may appear inside it.

The transaction callback MUST be typed as `(tx: SQLiteTransaction) => void` — NOT `(tx: SQLiteTransaction) => void | Promise<void>`. TypeScript rejects an `async` arrow's `Promise<void>` return assignment to `void`, making this a mechanism-level enforcement rather than a comment hint.

Rationale: `reconcile` runs on every `scholar.annotations.list`. Two concurrent `list` calls on different papers must not serialize behind each other's pdf-child network I/O. Holding the SQLite write lock across `await ctx.pdf.interact(...)` would impose exactly that serialization.

Any refactor that introduces an `await` inside the `db.transaction(...)` closure is a regression against this invariant, regardless of whether tests pass.

### 2 — Write-then-push ordering in `upsert` and `delete` (§13 line 1172)

The handler writes to the DB first, then calls the pdf-child — **not** the reverse. Spec §13 line 1172: "writes scholar's row (a `.delete` writes a tombstone), then immediately forwards the change to the child pdf MCP." This is failure-safe for the add/update path: a viewer crash after DB write leaves a dirty row that the next `reconcile` pushes.

Red-1/2/3 spy-order assertion: the synchronous DB call (`.run()`) fires and returns **before** the first `await ctx.pdf.interact(...)` call.

### 3 — `sanitizeText` on all user-supplied AND viewer-originated string fields (§12.0)

`body` and `anchor` are sanitized in **both** directions:

- **Outbound (upsert handler):** `sanitizeText(body)` and `sanitizeText(anchor)` on all user-supplied strings before DB write.
- **Inbound (phase-3 step-3 of reconcile):** `sanitizeText(vrow.body)` and `sanitizeText(vrow.anchor)` on viewer-originated rows before INSERT or UPDATE. The viewer is an external process; its annotation text is untrusted input per §12.0's "every untrusted-input boundary" invariant. React escapes XSS but does not strip bidi-override characters; persistence of U+202E in `body` allows bidi-flipped UI text.

### 4 — `source` field hardcoded; never accepted from tool input (F3 round-2)

The `upsert` tool's input schema **excludes** `source` entirely; the handler hardcodes `source: 'scholar'`. Only `reconcile()` phase-3 step-3 writes `'pdf-viewer'`.

### 5 — `NO_ACTIVE_CORPUS` guard on every handler (F5 round-2)

Every tool handler checks `ctx.db !== undefined` as its first action. If undefined, return a structured `{ code: "SCHOLAR_NO_ACTIVE_CORPUS" }` error before any DB or pdf-child call. Use `ctx.withCorpus(fn)` if foundation exposes it; otherwise inline the guard.

### 6 — `deriveRectFromAnchor` fixed to margin sticky-note (F6 round-2)

```typescript
function deriveRectFromAnchor(_anchor: string | null | undefined): [number, number, number, number] {
  // v1: fixed margin sticky-note. Geometry-aware anchor resolution is v2
  // (requires PDF geometry from extraction — out-of-scope cross-plan coupling).
  return [20, 20, 120, 60];
}
```

### 7 — Preemptive tombstone-resurrection fix (F2 round-2 — SPEC BUG)

> **Lead note:** chore `amend-spec-§13-tombstone-resurrection-fix` is lead-owned for atomic commit.

Phase-1 captures `scholar_deleted_ids: Set<string>` — all annotation ids with `deleted_at IS NOT NULL` for this paper. Phase-3 step-3's INSERT short-circuits with `continue` when `vrow.id ∈ scholar_deleted_ids`. Prevents a viewer-still-holding-the-row scenario from resurrecting a committed tombstone.

### 8 — `ctx.db` snapshot-at-entry (§7.6)

Every handler snapshots `ctx.db` into a local immediately after the `NO_ACTIVE_CORPUS` guard. Only that local is used for the rest of the call.

### 9 — `corpus_id` from active-corpus row, never from tool input (F7 round-2)

`reconcile` receives `corpus_id` from `ctx.config.activeCorpusId()` inside the handler — never from tool call input parameters.

### 10 — Phase-2 race window: documented and accepted (§13)

Between phase-1's `scholar_all_live` snapshot and phase-3's tombstone scan, a concurrent `annotations.upsert` may insert a new row. That row's `updated_at` is necessarily after the cursor, so phase-3's tombstone rule (`srow.updated_at <= cursor`) correctly skips it. **Do not refactor to close this window with additional locking.** The race is documented and accepted in §13.

### 11 — Tie-breaking on identical `updated_at`: scholar wins (§13)

When `vrow.updated_at === srow.updated_at`, scholar's row is preserved — the algorithm only overwrites on strict `>`. Documented and intentional.

### 12 — `serializeForViewer` branch chosen on test evidence; inverse strip required (F6 round-3)

Ships with direct ULID IDs. The `scholar-<ulid>` wrap-and-strip variant is adopted only if Red-4 reveals the viewer mutates ULID-shaped IDs. **If wrap-and-strip is chosen**, `reconcile()` must also strip the prefix when reading `viewer_rows` before the `scholar_by_id.get(vrow.id)` identity comparison — without the inverse strip, every viewer row appears as `!srow` and triggers re-INSERT, producing duplicate annotations with mismatched id formats. Red-4b tests the full round-trip through `reconcile()` when wrap-and-strip is active.

### 13 — Phase-2 step-2 throws MUST propagate; do not catch-and-continue (F4)

When `ctx.pdf.interact(...)` throws for row N in the phase-2 dirty-row loop, the exception propagates out of `reconcile()`. Phase-3 does not run; the cursor does not advance. On the next `annotations.list` call the entire push is retried from the cursor. This is the self-healing property. A future maintainer who wraps the `await` in try/catch and continues the loop would silently advance the cursor past unpushed dirty rows, losing those annotations from the viewer permanently. The self-healing property depends on phase-3 NOT running after a partial push.

### 14 — Post-tx delete-recovery phase for perpetual viewer-side staleness (F3)

Constraint #2 holds for add/update: dirty rows are re-pushed on subsequent reconciles. For deletes it holds only until the cursor advances past `deleted_at`. Once `cursor > deleted_at`, the tombstone no longer appears in `scholar_dirty` and `scholar_deleted_ids` short-circuits the re-INSERT — but nothing re-pushes the `remove_annotations`. The viewer keeps the row indefinitely ("ghost" annotation; no diagnostic surface).

**Fix — post-tx phase:** after `db.transaction(...)` returns (synchronous write complete), and before `reconcile()` resolves, run a **post-tx delete-recovery** step:

```typescript
// --- Post-tx phase: re-assert removes for any viewer rows the F7-fix blocked ---
// (Runs outside the transaction; ctx.pdf.interact is async.)
for (const vrow of viewer_rows) {
  if (scholar_deleted_ids.has(vrow.id)) {
    await pdf.interact([{ type: "remove_annotations", ids: [vrow.id] }]);
  }
}
```

This re-asserts the delete on every `annotations.list` call until the viewer drops the row and `viewer_rows` no longer includes it. The post-tx phase uses the `pdf` parameter (see handler snapshot below) — never `ctx.pdf` directly, to avoid the cross-corpus race described in constraint #15.

Throws from the post-tx phase propagate out of `reconcile()` (same reasoning as constraint #13: caller retries on next list).

### 15 — Snapshot `ctx.pdf` at handler entry; pass to `reconcile` (F7)

`ctx.pdf` is the live singleton reference; `corpus.activate` may replace it between the DB write and the async pdf-child call. The `delete` (and `upsert`) handlers snapshot both `ctx.db` and `ctx.pdf` at entry:

```typescript
const db = ctx.db!;  // after NO_ACTIVE_CORPUS guard
const pdf = ctx.pdf; // snapshot alongside db — same epoch
```

`pdf` is passed as an explicit parameter to `reconcile(corpus_id, paper_id, db, pdf)` and used for all `interact()` calls, including the post-tx phase. This keeps all pdf-child traffic in `reconcile` anchored to the corpus that was active when the tool call entered. Alternatively, `ctx.withCorpus(fn)` (if foundation exposes it) closes over both `db` and `pdf` — either approach satisfies this constraint.

### 16 — phase-3 step-3 INSERT uses `.onConflictDoNothing()` (F2)

Two concurrent `annotations.list` calls on the **same paper** both complete phase-1 and phase-2 with identical state, then serialize on the SQLite write lock. The first commit inserts viewer-only rows. The second attempt hits the same primary keys. Without `.onConflictDoNothing()`, `SQLITE_CONSTRAINT_PRIMARYKEY` fires inside the transaction, rolls it back, and propagates an error to the caller. Fix: add `.onConflictDoNothing()` to phase-3 step-3's INSERT. The second transaction is now a silent no-op for already-inserted rows; cursor UPSERT in step-5 still advances correctly.

---

## Cycle 6.7 — Annotation Round-trip

### Red phase (failing tests first)

All tests live at `src/server/tools/annotations.test.ts`.

> **Note on `InMemoryTransport` (F11 round-2):** Locate the SDK v1.29.0 export path for `InMemoryTransport` by inspecting the installed package at test-file write time; record the resolved import path in a comment.

#### Red-1 — `annotations.upsert` (insert path)

```typescript
// Preconditions: active corpus DB, a live papers row for paper_id.
// Call upsert with { paper_id, body: "hello", anchor: "§2.1" }.
// (source excluded from input schema; hardcoded to 'scholar' internally.)
// Assertions:
// - Exactly one row: deleted_at = null, source = 'scholar'.
// - id is a valid ULID; updated_at >= created_at.
// - Sync DB write spy fires BEFORE first await ctx.pdf.interact spy (write-then-push).
// - ctx.pdf.interact([{type: "add_annotations", ...}]) called once.
```

#### Red-2 — `annotations.upsert` (update path)

```typescript
// Precondition: existing annotation row.
// Call upsert with same id, different body.
// Assertions:
// - body and updated_at change; created_at, id, source = 'scholar' unchanged.
// - Sync DB write spy fires BEFORE ctx.pdf.interact([{type:"update_annotations",...}]) spy.
// - deleted_at remains null.
```

#### Red-3 — `annotations.delete` (soft-delete tombstone)

```typescript
// Call scholar.annotations.delete({ id }).
// Assertions:
// - Row exists; deleted_at is set.
// - Sync DB write (deleted_at update) spy fires BEFORE ctx.pdf.interact([{type:"remove_annotations",...}]) spy.
// - Subsequent list call omits the row.
```

#### Red-3b — `annotations.delete` idempotency (F13 round-2)

```typescript
// Call delete on an already-tombstoned annotation.
// Assertion: no-op success; existing deleted_at timestamp unchanged; no pdf.interact call.
```

#### Red-4 — ID round-trip verification (§13 F9)

```typescript
// Mock ctx.pdf.interact([{type:"list_annotations",...}]) to return a row with the same ULID.
// Assertion: list result contains annotation with original ULID (identity path active).
// If mock returns viewer-mutated id: adopt scholar-<ulid> wrap-and-strip; pin format.
// Commit one branch; mark the other xfail until real pdf@1.7.2 is probed.
```

#### Red-4b — Wrap-and-strip full round-trip (F6 — conditional on Red-4 selecting wrap-and-strip)

```typescript
// If Red-4 selects the scholar-<ulid> branch:
// - upsert an annotation (ULID id).
// - Mock viewer list_annotations to return the id with scholar- prefix stripped/mutated.
// - Call annotations.list (triggers reconcile).
// Assertions:
// - reconcile() correctly strips the prefix in viewer_rows before scholar_by_id.get().
// - No duplicate annotation rows inserted (no re-INSERT of the wrapped id as a new row).
// - Exactly one row in annotations table for this paper.
```

#### Red-5 — `list_annotations` `updated_at` availability (§13 F1)

```typescript
// Fixture A: viewer returns rows WITH updated_at — LWW branch exercised.
// Fixture B: viewer returns rows WITHOUT updated_at — degrades to scholar-authoritative;
//   no exception; no LWW overwrite; viewer-only-add and viewer-side-delete still work.
```

#### Red-6 — Mixed-batch acceptance (§13 batching note)

```typescript
// Test whether interact([add_annotations, update_annotations]) is accepted as one call.
// If accepted: step-2 loop collapses to one call (assert count=1).
// If not: per-row loop (assert count = number of dirty rows).
// Document finding in comment inside reconcile().
```

#### Red-7 — Concurrent `list` does not hold write lock across MCP I/O (different papers)

```typescript
// Two concurrent annotations.list on DIFFERENT papers.
// ctx.pdf.interact fake adds 50ms delay.
// Assertions:
// - Both resolve without deadlock.
// - Total wall-time < 2 * delay (they overlap; not serialized).
```

#### Red-7b — Concurrent same-paper `annotations.list` (F2)

```typescript
// Two concurrent annotations.list on THE SAME paper with one viewer-only fixture row.
// ctx.pdf.interact returns the same viewer rows to both calls.
// Assertions:
// - Both calls resolve without error (no SQLITE_CONSTRAINT_PRIMARYKEY throw).
// - Exactly ONE annotations row inserted (not two duplicates).
// (.onConflictDoNothing() on phase-3 step-3 INSERT makes the second tx a silent no-op.)
```

#### Red-7c — Post-tx delete-recovery for perpetual viewer-side staleness (F3)

```typescript
// Scenario:
// 1. upsert + delete annotation (tombstone committed; remove_annotations push succeeds).
// 2. Simulate: cursor has advanced past deleted_at (manually set last_reconciled_at
//    after deleted_at in reconcile_state to reproduce the stale-cursor state).
// 3. Mock viewer list_annotations to still return the annotation (viewer didn't apply remove).
// 4. Call annotations.list (triggers reconcile).
// Assertions:
// - reconcile() phase-3 F7-fix short-circuit fires (no re-INSERT).
// - Post-tx phase issues another remove_annotations for the id.
// - Call annotations.list again: post-tx fires again (viewer still has row in mock).
// - If mock is updated to drop the row: next list call, post-tx does NOT fire.
// Rationale: remove is re-asserted every reconcile until viewer drops the row.
```

#### Red-8 — `sanitizeText` on user-supplied `body` and `anchor` (§12.0)

```typescript
// Parametric over body and anchor:
// Case A: body = "hello‮world" (U+202E RLO bidi-override).
//   Assertion: upsert rejects with SanitizeError before DB write or pdf.interact.
// Case B: anchor = "§2.1‮evil".
//   Assertion: same rejection.
```

#### Red-8b — `sanitizeText` on viewer-originated `vrow.body` (F1 inbound)

```typescript
// Parametric — run for vrow.body and vrow.anchor:
// Mock ctx.pdf.interact([{type:"list_annotations",...}]) to return a viewer row with
// body = "approve invoice‮" (bidi-override in viewer-originated text).
// Call annotations.list (triggers reconcile → phase-3 step-3 INSERT).
// Assertion: SanitizeError thrown (or sanitized-into-acceptance per §12.0 contract)
//   before the INSERT executes. Viewer-originated bidi content must not persist verbatim.
// Mirror: same test for vrow.anchor containing U+202E.
```

#### Red-9 — Tombstone resurrection prevention (constraint #7)

```typescript
// 1. upsert + delete (tombstone committed; push fails — ctx.pdf.interact throws for remove).
// 2. annotations.list → reconcile(); viewer still has the row.
// Phase-3 step-3 scholar_deleted_ids short-circuit fires.
// Assertion: annotation does NOT re-appear in list results (no re-INSERT of source='pdf-viewer').
```

#### Red-10 — Daisy round-trip schema compatibility (F12 round-2)

```typescript
// Non-trivial fixture anchor: "§3.2 — key finding paragraph".
// Assertions:
// - list rows include { id, page, anchor, body, created_at, updated_at, source }.
// - Deleted rows (deleted_at set) excluded from list output.
// - serializeForViewer(row) produces { id, page, rect, body, created_at, updated_at }.
// Spec §8.2 inline: rect nullable per "e.g., a paper-level note".
```

#### Red-11 — `rect` JSON validation (F9 round-2)

```typescript
// Valid: "[10, 20, 200, 300]" (4-element numeric array, all finite) → accepted.
// Invalid: "[10, 20, 200]" (3 elements) → structured error before DB write.
// Invalid: "[10, 20, 200, Infinity]" (non-finite) → structured error.
// Invalid: '{"x":10}' (wrong shape) → structured error.
```

#### Red-12 — Both-null `rect` + `anchor` accepted as paper-level note (F10 round-2)

```typescript
// upsert with no rect and no anchor.
// Assertion: accepted; row inserted with source='scholar'; list returns it.
// Rationale: spec §8.2 explicitly marks rect nullable "e.g., a paper-level note";
//   anchor is also nullable. Both-null is a valid paper-level attachment.
//   serializeForViewer uses deriveRectFromAnchor([20,20,120,60]) as fallback.
```

#### Red-13 — `NO_ACTIVE_CORPUS` guard (F5 round-2)

```typescript
// ctx.db = undefined for each tool:
// - annotations.list → { code: "SCHOLAR_NO_ACTIVE_CORPUS" }, no DB or pdf call.
// - annotations.upsert → same.
// - annotations.delete → same.
```

---

### Green phase (implementation)

Fill `src/server/tools/annotations.ts`.

#### `registerTools` body

Register three tools on `server`:

**`scholar.annotations.list`** — input `{ paper_id: string }`:
1. `NO_ACTIVE_CORPUS` guard.
2. `corpus_id = ctx.config.activeCorpusId()`.
3. Snapshot: `const db = ctx.db!; const pdf = ctx.pdf;`.
4. Call `reconcile(corpus_id, paper_id, db, pdf)`.
5. Return all rows with `deleted_at IS NULL`.

**`scholar.annotations.upsert`** — input `{ id?: string, paper_id: string, page?: number, anchor?: string, rect?: string, body: string }` (source excluded):
1. `NO_ACTIVE_CORPUS` guard.
2. `corpus_id = ctx.config.activeCorpusId()`.
3. Snapshot `db` and `pdf`.
4. `sanitizeText(body)`, `sanitizeText(anchor)` if provided.
5. Validate `rect` JSON if provided (4-element finite number array).
6. Generate ULID `id` if absent.
7. Upsert row with `source: 'scholar'` via `.onConflictDoUpdate`.
8. **After** DB write commits: call `pdf.interact([{type: op, annotations: [serializeForViewer(row)]}])` where `op` is `'add_annotations'` or `'update_annotations'`.

**`scholar.annotations.delete`** — input `{ id: string }`:
1. `NO_ACTIVE_CORPUS` guard.
2. Snapshot `db` and `pdf`.
3. Idempotency check: if `deleted_at` already set, return no-op success.
4. Write `deleted_at = nowIso()` synchronously.
5. **After** DB write commits: call `pdf.interact([{type: 'remove_annotations', ids: [id]}])`.

#### `reconcile(corpus_id, paper_id, db, pdf)` — §13 algorithm + fixes

The three phase comments appear verbatim in source:

```
// --- Phase 1: read-only state capture (no tx; no SQLite write lock held). ---
```
```
// --- Phase 2: MCP round-trips (await on network; no SQLite tx open). ---
```
```
// --- Phase 3: local write-back inside a single Drizzle transaction. No awaits. ---
```

**Phase-1 additions (constraint #7 + #16):**
- Capture `scholar_deleted_ids: Set<string>` — all annotation ids where `deleted_at IS NOT NULL` for this paper.

**Phase-2 step-2 loop (constraint #13):** throws propagate; do NOT wrap in try/catch. Comment: *"Do not catch here: self-healing depends on phase-3 not running after a partial push."*

**Phase-3 callback typed as `(tx: SQLiteTransaction) => void`** (constraint #1 — TS mechanism: rejects async callback's `Promise<void>` at compile time).

**Phase-3 step-3 (constraint #16):** add `.onConflictDoNothing()` to INSERT; add `scholar_deleted_ids.has(vrow.id)` short-circuit before INSERT (constraint #7). Apply `sanitizeText` to `vrow.body` and `vrow.anchor` before INSERT and UPDATE branches (constraint #3 inbound).

**Phase-3 UPDATE branch (§13 line 1249-1254):** apply `sanitizeText(vrow.body)` before SET.

**Post-tx phase (constraint #14):** after `db.transaction(...)` returns, before `reconcile` resolves:
```typescript
// --- Post-tx phase: re-assert removes for viewer rows blocked by scholar_deleted_ids ---
for (const vrow of viewer_rows) {
  if (scholar_deleted_ids.has(vrow.id)) {
    await pdf.interact([{ type: "remove_annotations", ids: [vrow.id] }]);
  }
}
```
Throws propagate (same reasoning as constraint #13).

All other algorithm steps match §13 verbatim. Mixed-batch collapse and `updated_at` degenerate path chosen on test evidence from Red-5/Red-6.

#### `serializeForViewer(row)` — §13 pinned shape

```typescript
function serializeForViewer(row: AnnotationRow): ViewerAnnotation {
  return {
    id: row.id,   // direct ULID; scholar-<ulid> wrap applied only if Red-4 demands it
    page: row.page,
    rect: row.rect ? JSON.parse(row.rect) : deriveRectFromAnchor(row.anchor),
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
```

If Red-4 selects wrap-and-strip: also add consumer-side inverse-strip in `reconcile()` before `scholar_by_id.get(vrow.id)` (constraint #12).

#### Type imports

- `annotations`, `reconcile_state` from `src/server/db/schema.ts` (foundation-owned — do not edit).
- `sanitizeText` from `src/server/ingest/primitives.ts` (foundation-owned — do not edit).
- `BunSQLiteDatabase`, `SQLiteTransaction` from `drizzle-orm/bun-sqlite`.
- `ctx.withCorpus` if exposed by foundation; otherwise inline the `NO_ACTIVE_CORPUS` guard.

Do not edit `schema.ts`, `primitives.ts`, `registry.ts`, `migrations.ts`, or any sibling plan's file.

---

### Refactor phase (optional)

After all Red tests pass:

- Inline `/* no-await-in-tx */` comment above `db.transaction` (belt-and-suspenders alongside the `(tx) => void` type enforcement).
- If Red-6 collapsed the step-2 loop, record: `// verified: pdf@1.7.2 accepts mixed add/update batch in one interact() call`.
- If Red-4 required wrap-and-strip, document the format on `serializeForViewer` and the inverse-strip location.
- `serializeForViewer` and `deriveRectFromAnchor` remain file-private.

---

## Out of scope (handed to sibling plans)

| Sibling suffix  | Cycles owned    | Scope excluded from this plan                                                                   |
|-----------------|-----------------|--------------------------------------------------------------------------------------------------|
| `foundation`    | 6.1, 6.2        | Stub creation of `annotations.ts`; `ServerContext`, `PdfChild`, `Logger`, `ConfigAccessor`, `registerTools`, `runRawDdl` contracts; `sanitizeText` / `wrapUntrusted` / `resolveUnderRoot` / `encodeDoi` / `validateArxivId` / `loadVecAndProbeDim` / `initOnce` primitives; Drizzle schema (`annotations`, `reconcile_state` tables); vendored pdf MCP + `src/server/pdf/lifecycle.ts`. |
| `corpus`        | 6.3, 6.11 | `scholar.corpus.*` tools, `scholar.roots.*` tools, snapshot tool (sqlite3-mcp registration removed post-posture-B 2026-05-24), first-run wizard. `corpus.activate` (which mutates `ctx.db` and `ctx.pdf`). |
| `ingest`        | 6.4             | All ingestion adapters and `scholar.ingest.*` tools.                                            |
| `extraction`    | 6.5, 6.6, 6.8  | Text extraction, chunking, Ollama embeddings, `chunk_vec` + `reading_queue` DDL, hybrid search, reading queue, digest, reading-prompts. `scholar.pdf.*`, `scholar.papers.*`, `scholar.digest.*`, `scholar.prompts.*` tools. |
| `frontends`     | 6.9, 6.10       | Five React UI views; nu module; slash commands; skills; rendering of annotation counts and annotation views. |

### Posture-B regression-guard (deferred)

The canonical pattern at `src/server/tools/corpus.test.ts:259-280` wraps
`built.ctx.pdf` in a Proxy that throws on any property-access whose
name contains `"sqlite3"`, then exercises the happy-path handlers. If
any code path attempts to dereference the dropped `ctx.sqlite3.*`
delegated dependency from pre-posture-B, the test fails fast.

For this plan, the parallel guard belongs in `src/server/tools/annotations.test.ts`,
exercising `scholar.annotations.list` (the canonical annotation handler) or
`scholar.annotations.upsert`. Documented post-execution by chore
`propagate-proxy-regression-guard-across-plans`; add as a Red test in
a future posture-B regression refactor cycle — NOT added by this chore
because the plan-md is immutable post-close (plan-group
`2026-05-22-scholar-plugin` closed at c4f61da on 2026-05-25).
| `packaging`     | 6.13            | `scripts/build-plugin.ts`; plugin archive assembly; single-file executable compile.             |

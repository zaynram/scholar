# Plan: 2026-05-22-scholar-plugin-corpus

| Field | Value |
|---|---|
| **Plan ID** | `2026-05-22-scholar-plugin-corpus` |
| **Plan group** | `2026-05-22-scholar-plugin` |
| **Cycles** | `[6.3, 6.11]` |
| **Depends-on** | `foundation` |
| **Blast-radius** | `src/server/tools/corpus.ts src/server/tools/roots.ts src/server/tools/snapshot.ts scripts/first-run.ts` |
| **Worktree** | `not-required` |
| **Tier** | `sonnet` — 2 cycles, tool wiring within frozen §7.6 contracts. Scope is well-bounded. |

> **Architecture note (posture B, lead ruling post-corpus-002):** Scholar drops the sqlite3-mcp delegation entirely. Cycle 6.12 was removed; corpus owns `[6.3, 6.11]` only. The sqlite3-mcp server is a Python/FastMCP process whose `register_db` arg-shape (`{name, path}`) diverged from the spec's assumed `{alias, path}` and whose uv + Python ≥ 3.12 host deps are incompatible with scholar's `bun build --compile` portability requirement. Scholar reimplements §10's query/backup/inspect surface directly via `bun:sqlite`. §6.12, §7.4, §7.6, and §10 spec amendments are lead-owned chores.
>
> **Posture-B regression guard** (M6): one Red test per cycle asserts the mock `ctx` exposes no `sqlite3-mcp.*` callable and that corpus tool handlers make no outbound MCP calls on that namespace. This prevents a future refactor from accidentally reintroducing delegation.

---

## Context

The `foundation` plan (cycles 6.1 / 6.2) scaffolds `corpus.ts`, `roots.ts`, `snapshot.ts`, and `scripts/first-run.ts` as no-op stubs and pins every cross-plan contract (`ServerContext`, `PdfChild`, `ConfigAccessor`, `Logger`, `registerTools`). This plan fills the bodies of those four files. No other plan's file is touched; no new tool file is created.

Foundation also owns:
- `defaultPdfRoot(corpusId)` helper in `src/server/db/` (foundation-007 scope) — used in `corpus.activate`'s `initOnce` factory when populating `ctx.pdf.setRoots(paths)` with the active corpus's PDF roots for the pdf-child spawn.
- `writeRuntimeConfig(data)` helper — atomic `tmp + fsync + rename` write to `runtime/config.json`. Used by `corpus.activate` and `first-run.ts`. Foundation pins its atomicity semantics; this plan imports and calls it.

---

## Load-bearing invariants (must not be violated)

1. **Slug validation (SECURITY — I1).** Corpus slugs match `/^[a-z][a-z0-9-]{0,63}$/`. Rejected: empty string, uppercase, leading digit or dash, dot, 65+ chars, null-byte, and the reserved literals `["config"]`. On Windows, `con`, `nul`, `aux`, `prn`, `com1`–`com9`, `lpt1`–`lpt9` are also reserved because the slug is the SQLite file basename and Windows reserves these filenames. Validation runs before any filesystem or DB write; failure returns `INVALID_SLUG`. Concurrent create on the same slug is serialized through `initOnce("corpus.create:" + slug, ...)` — only one factory runs per slug, eliminating the orphan-DB race (I1 concurrency fix, see §5.5 protocol below).

2. **`display_name` sanitization (SECURITY — I2).** `sanitizeText(input.display_name, { maxLen: 128 })` (§12.0 primitive) runs before any INSERT. The primitive strips bidi-override characters (e.g., U+202E), PUA codepoints (U+E000–U+F8FF), and Unicode tag-block characters (U+E0000–U+E007F). Overlong inputs are truncated with a `ctx.log.warn` rather than hard-rejected.

3. **`ctx.db` snapshot-at-entry (§7.6).** Every handler snapshots `ctx.db` into a local on its very first line. `corpus.activate` mutates `ctx.db` in place; re-reading `ctx.db` after an `await` would silently address the wrong corpus. Prefer `ctx.withCorpus(fn)`.

4. **`PRAGMA foreign_keys = ON` per connection (§5.3, §8).** Executed by `openWithPragmas` on every connection open — not once per process. Cascade deletes are load-bearing.

5. **`initOnce` memoization per corpus (§7.3, §12.0).** All server-side initialization for a corpus (first-run, corpus-open, pdf-child spawn) is guarded by a single promise-memoized slot keyed on `"corpus:" + slug`. Retry-on-reject: transient failures clear the slot; fatal errors retain the rejected promise. `scholar.corpus.reset-init` (model-only) clears the slot manually.

6. **Cross-DB atomicity for `scholar.corpus.create` (§5.5).** Provision the per-corpus DB fully first (steps a–f below), then INSERT into `corpora` + `pdf_roots` in the config DB in a single transaction. The entire create body is wrapped in `initOnce("corpus.create:" + slug, ...)` so concurrent creates on the same slug block rather than race. Wrap the per-corpus provisioning in a try/catch that unlinks the partial DB file on failure — the config DB never sees a row for a nonexistent or half-initialized DB. Orphaned DB files from prior failed creates are surfaced as `ORPHAN_DB_EXISTS` rather than silently overwritten (pre-check before provisioning).

7. **No `package.json` / `bun.lock` edits.** Foundation pre-declared the full v1 dep set at cycle 6.1.

---

## Cycle 6.3 — Corpus + roots tools + first-run wizard

**Spec refs:** §5.5, §5.6, §5.37, §7.3, §7.6, §8.1, §10, §12.0

**Files filled:** `src/server/tools/corpus.ts`, `src/server/tools/roots.ts`, `scripts/first-run.ts`

### What ships in this cycle

**`corpus.ts`** registers:
- `scholar.corpus.list` (model) — returns rows from `corpora` config-DB table.
- `scholar.corpus.create` (model) — cross-DB atomic corpus provisioning (see below). Args: `slug`, `display_name`, `initial_pdf_root`.
- `scholar.corpus.activate` (model) — switches active corpus. Idempotent (already-active → return current status). Rejects if corpus is archived — checked both before and inside the `initOnce` factory (I2 race fix, see pseudocode below).
- `scholar.corpus.status` (both) — counts + `corpora.last_opened_at` + stale-paper list.
- `scholar.corpus.export` (model) — packs the per-corpus DB to an auto-derived path `runtime/exports/<slug>-<ts>.tar.zst`. No user-supplied output path; no untrusted input crosses the §12.0 boundary (M5).
- `scholar.corpus.reset-init` (model-only) — clears the `initOnce` slot for a named corpus.
- `scholar.corpus.archive` (model-only) — sets `corpora.archived_at` in the config DB. The commit-order discipline matters: DB UPDATE is the durable point; in-memory `ctx.db = undefined` and `writeRuntimeConfig` null-out follow only on DB success. If the DB UPDATE fails, neither in-memory state nor `runtime/config.json` is touched (M4). If the corpus is currently active, the in-memory and config.json clears also run. Note: §10's tool table does not list this tool explicitly; the §10 inconsistency is a lead-owned spec-amendment chore that must land before this tool ships (M7, see Execution Order).
- **`scholar.dashboard`** (both, view-opener) — opens `ui://scholar/app.html` with `view: "dashboard"`. Registered from `corpus.ts` per the §7.6 view-opener table.

**`roots.ts`** registers:
- `scholar.roots.list` (both) — reads `pdf_roots` rows for the active corpus.
- `scholar.roots.add` (both) — inserts a `pdf_roots` row; calls `ctx.pdf.setRoots(paths)`. De-duplicates preserving insertion order.
- `scholar.roots.remove` (both) — deletes the row; enforces at least one root always remains. If the removed root was the default and other roots exist, auto-promotes the oldest remaining root (lowest `created_at`) to default (M2). Calls `ctx.pdf.setRoots(paths)` after the DB update.
- `scholar.roots.set-default` (both) — flips `is_default`; clears prior default in the same transaction.

**`scripts/first-run.ts`** — imported by `corpus.ts`, not a standalone executable. Called when no corpus is configured on `corpus.list` or `corpus.activate`. Uses the live MCP session's `elicitInput` to prompt for the initial PDF root.

**`elicitInput` host-capability detection (M4/I4).** Detection expression:
```typescript
const supportsElicit = !!server.server.getClientCapabilities()?.elicitation;
```
- If `true`: prompt with the platform default suggestion (`%USERPROFILE%/mcp-data/literature/` on Windows, `$HOME/mcp-data/literature/` on POSIX).
- If `false` or `undefined`: log via `ctx.log.warn` and return `FIRST_RUN_ELICIT_UNAVAILABLE` — do NOT silently proceed with a default path. Scholar remains functional once the user creates a corpus via `scholar.corpus.create` directly.

On successful `elicitInput`: (a) drives `scholar.corpus.create` with elicited path as `initial_pdf_root`; (b) calls `writeRuntimeConfig({ activeCorpusId: slug })`. On user dismissal: `initOnce` slot clears (retry semantics).

### `scholar.corpus.create` atomicity protocol (§5.5)

```
1. Slug validation: /^[a-z][a-z0-9-]{0,63}$/ + reserved list → INVALID_SLUG if fails.
2. display_name sanitization: sanitizeText(input.display_name, { maxLen: 128 }).
3. Entire create body wrapped in initOnce("corpus.create:" + slug, ...) — concurrent creates block.
4. Inside the factory:
   a. Orphan-DB check: if <dbPath> exists → ORPHAN_DB_EXISTS (do not overwrite).
   b. openWithPragmas(<path>)            — creates file; PRAGMA foreign_keys = ON
   c. loadVecExtension(db)               — loads sqlite-vec
   d. runDrizzleMigrations(db)           — Drizzle migrations
   e. loadVecAndProbeDim(db, embedModel) — probes embed dim; on Ollama offline → defer chunk_vec
   f. write settings.embed.model (and embed.dim when probed)
   g. runRawDdl(db)                      — chunk_vec (when dim known) + reading_queue view
   All of (a–g) in try/catch; unlink on failure.
   h. Config-DB transaction: INSERT corpora + INSERT pdf_roots (is_default=true)
```

### `corpus.activate` pseudocode (M3, I2 race fix)

```typescript
async function handleActivate(input: { slug: string }, ctx: ServerContext) {
  const _db = ctx.db;  // snapshot at entry (invariant #3)

  // Idempotency: already active → return current status without re-running factory
  if (ctx.config.activeCorpusId() === input.slug) return currentStatusPayload(ctx);

  // Pre-flight read of corpus row (must exist + not archived)
  const row = ctx.config.corpora().find(c => c.id === input.slug);
  if (!row) throw new McpError(ErrorCode.InvalidParams, "corpus not found");
  if (row.archived_at) throw new McpError(ErrorCode.InvalidRequest, "corpus is archived");

  await initOnce(`corpus:${input.slug}`, async () => {
    // I2 race fix: re-read archived_at INSIDE the factory to close the
    // activate-vs-archive window. If archive landed after the pre-flight
    // check above, this rejects before mutating ctx.db.
    const freshRow = ctx.config.corpora().find(c => c.id === input.slug);
    if (freshRow?.archived_at) throw new McpError(ErrorCode.InvalidRequest, "corpus archived during activation");

    const db = await openCorpusDb(row, ctx);  // openWithPragmas + migrations + vec + rawDdl
    // last_opened_at written HERE (inside factory per §7.3 step 4 — not written again after factory)
    ctx.configDb.run(sql`UPDATE corpora SET last_opened_at = ${nowIso()} WHERE id = ${input.slug}`);
    ctx.db = db;  // mutate in place — callers who snapshot at entry are safe
    ctx.config.set("activeCorpusId", input.slug);
    await writeRuntimeConfig({ activeCorpusId: input.slug });  // atomic tmp+fsync+rename

    // Populate pdf child's roots using foundation-owned helper
    const roots = allPdfRoots(input.slug, ctx.configDb);  // SELECT path FROM pdf_roots WHERE corpus_id=?
    await ctx.pdf.setRoots(roots);
  });

  return currentStatusPayload(ctx);
  // NOTE: last_opened_at is NOT written here a second time (M1 double-write fix).
}
```

### Red → Green → Refactor

**Red:**

`src/server/tools/corpus.test.ts`:

*Security — slug validation (I5, parametric):*
```typescript
test.each([
  ["empty string", ""],
  ["uppercase", "MyCorpus"],
  ["leading digit", "1abc"],
  ["leading dash", "-abc"],
  ["dot in name", "foo.db"],
  ["65 chars", "a".repeat(65)],
  ["null byte", "abc\x00def"],
  ["reserved config", "config"],
  ["Windows reserved con", "con"],
  ["Windows reserved nul", "nul"],
  ["Windows reserved aux", "aux"],
  ["path traversal", "../escape"],
])("corpus.create rejects slug %s before any DB write", async (_, slug) => {
  await expect(corpus.create({ slug, display_name: "test", initial_pdf_root: "/tmp" }))
    .rejects.toMatchObject({ code: "INVALID_SLUG" });
  // assert no DB or filesystem write occurred
});
```

*Security — display_name sanitization (I3, parametric):*
```typescript
test.each([
  ["bidi-override", "‮evil", "evil"],       // U+202E stripped
  ["PUA codepoint", "foobar", "foobar"],   // U+E000 stripped
  ["tag-block", "foo0bar", "foobar"],       // U+E0040 stripped
])("corpus.create strips %s from display_name", async (_, input, expected) => {
  await corpus.create({ slug: "test", display_name: input, initial_pdf_root: "/tmp" });
  const row = getCorpusRow("test");
  expect(row.display_name).toBe(expected);
});

test("corpus.create truncates display_name > 128 chars with warn", async () => {
  const long = "x".repeat(200);
  await corpus.create({ slug: "test", display_name: long, initial_pdf_root: "/tmp" });
  expect(getCorpusRow("test").display_name).toHaveLength(128);
  expect(ctx.log.warn).toHaveBeenCalled();
});
```

*Concurrent create race (I1):*
```typescript
test("parallel corpus.create on same slug produces exactly one corpus row and no orphan DB", async () => {
  const results = await Promise.allSettled([
    corpus.create({ slug: "race", display_name: "A", initial_pdf_root: "/tmp" }),
    corpus.create({ slug: "race", display_name: "B", initial_pdf_root: "/tmp" }),
  ]);
  const succeeded = results.filter(r => r.status === "fulfilled");
  expect(succeeded).toHaveLength(1);
  expect(getCorpusRows()).toHaveLength(1);
  // Exactly one DB file exists
  expect(existsSync("runtime/dbs/scholar-race.db")).toBe(true);
  // No second/orphan file
});
```

*Atomicity:*
- `corpus.create` with failing `runDrizzleMigrations` → no config row; partial DB file unlinked.
- `corpus.create` when `dbPath` already exists → `ORPHAN_DB_EXISTS` (M6).

*Lifecycle:*
- `corpus.list` returns empty array on fresh config DB.
- `corpus.activate` mutates `ctx.db` to the named corpus DB.
- `corpus.activate` on already-active corpus → idempotent, returns status, `initOnce` not re-entered (M7).
- `corpus.activate` on nonexistent corpus → structured error (M8).
- `corpus.activate` on archived corpus → structured error (M8).
- *Activate-vs-archive race (I2):* start `corpus.activate`, mock a `corpus.archive` landing inside the `initOnce` factory window → `corpus.activate` rejects with archived error; `ctx.db` unchanged.
- `corpus.archive` on active corpus → DB UPDATE first; then `ctx.db = undefined`; then config.json null-out. Subsequent `corpus.status` → `NO_ACTIVE_CORPUS`.
- `corpus.archive` DB-write failure → `ctx.db` and `runtime/config.json` unchanged (M4).
- `corpus.archive` on non-active corpus → sets `archived_at`; `ctx.db` unchanged.
- `corpus.status` returns correct counts and `last_opened_at`.
- `corpus.reset-init` clears `initOnce` slot (re-create succeeds after mocked failure).
- `scholar.dashboard` registered; returns structuredContent `{ view: "dashboard" }`.

*Posture-B regression guard (M6):*
```typescript
test("corpus handlers make no sqlite3-mcp calls", async () => {
  const callToolMock = jest.fn();
  // ctx has no sqlite3 field; verify no property is accessed
  const strictCtx = new Proxy(ctx, {
    get(target, prop) {
      if (String(prop).includes("sqlite3")) throw new Error("sqlite3-mcp access detected");
      return Reflect.get(target, prop);
    }
  });
  await corpus.activate({ slug: "daisy" }, strictCtx);  // should complete without touching sqlite3
  expect(callToolMock).not.toHaveBeenCalled();
});
```

`src/server/tools/roots.test.ts`:
- `roots.add` inserts row; `ctx.pdf.setRoots` called with new path list.
- `roots.add` deduplicates — same path twice yields one row.
- `roots.remove` on non-default root → `ctx.pdf.setRoots` called, no auto-promotion.
- `roots.remove` on default root when other roots exist → oldest root promoted to default (M2); `ctx.pdf.setRoots` called.
- `roots.remove` on the only remaining root → rejects.
- `roots.set-default` flips `is_default`; only one default row per corpus.
- Mock `ctx.pdf` shape: `{ setRoots: mock(), currentRoots: mock(), interact: mock(), getText: mock(), isHealthy: mock() }` — no sqlite3 mock (M5).

`scripts/first-run.test.ts`:
- First-run triggers when no corpus is configured.
- When `server.server.getClientCapabilities()?.elicitation` is truthy: `elicitInput` called with platform default suggestion; on success drives `corpus.create`.
- When `getClientCapabilities()` returns `undefined`: returns `FIRST_RUN_ELICIT_UNAVAILABLE` without any write (I4-a).
- When capabilities omit `elicitation`: returns `FIRST_RUN_ELICIT_UNAVAILABLE` without any write (I4-b).
- On `elicitInput` user dismissal: `initOnce` slot cleared (retry semantics).

**Green:**

Fill `corpus.ts`, `roots.ts`, `scripts/first-run.ts` following:
- Slug regex + reserved list (invariant #1, including Windows-reserved names).
- `sanitizeText` from `src/server/ingest/primitives.ts` for `display_name`.
- `initOnce("corpus.create:" + slug, ...)` wrapping the full create body.
- Orphan-DB pre-check before provisioning.
- Atomicity protocol (steps a–h) from §5.5.
- `corpus.activate` pseudocode above (I2 re-read inside factory; M1 no double-write).
- `corpus.archive` commit-order discipline (M4): DB → memory → config.json.
- `server.server.getClientCapabilities()?.elicitation` for `elicitInput` detection (I4).
- `writeRuntimeConfig` from foundation for atomic config.json writes (M3).
- `defaultPdfRoot` / `allPdfRoots` from `src/server/db/` (foundation-owned).

**Refactor (optional):**

Extract `provisionPerCorpusDb(slug, options)` if create handler body exceeds ~80 lines. Extract `tryAutoPromoteDefault(tx, corpusId)` in `roots.ts`. No interface changes; gated on all tests green.

---

## Cycle 6.11 — Snapshot tool (change-since-last-open)

**Spec refs:** §5.13, §8.2, §10

**Files filled:** `src/server/tools/snapshot.ts`

### What ships in this cycle

**`snapshot.ts`** registers:
- `scholar.snapshot.take` (model-only per §10) — captures a `SnapshotPayload` and inserts into `snapshots`.

Pure read + one write. No schema migration — `snapshots` is Drizzle-managed by `foundation`.

### `SnapshotPayload` shape (§8.2, pinned)

```typescript
type SnapshotPayload = {
  paper_ids: string[];
  statuses: Record<string, "pending" | "reading" | "reviewed" | "skip">;
  priorities: Record<string, number>;
  selection?: string[];
  counts: { total: number; pending: number; reading: number; reviewed: number; skip: number };
};
```

`snapshot.take` reads `SELECT id, status, priority FROM papers`, constructs the payload, JSON-encodes it, and inserts into `snapshots` with `trigger: "open" | "manual"` (check constraint). Delta computation is a **TypeScript function over two parsed `SnapshotPayload` objects, not SQL** — that function lives in `digest.ts` (extraction plan, cycle 6.8). `snapshot.ts` only captures.

### `ctx.db` rule

Snapshot-at-entry pattern. INSERT wraps in `db.transaction(tx => ...)` — no awaits inside closure.

### Red → Green → Refactor

**Red:**

`src/server/tools/snapshot.test.ts`:
- `snapshot.take("manual")` inserts row with correct `taken_at` and `trigger`.
- `snapshot.take("open")` inserts row.
- Payload parses back to valid `SnapshotPayload`.
- `counts` totals match seeded paper count.
- `statuses` keys match `paper_ids`.
- No active corpus → `McpError(ErrorCode.InvalidRequest)`.
- Two consecutive takes → two independent rows.

*Posture-B regression guard (M6):*
```typescript
test("snapshot.take makes no sqlite3-mcp calls", () => {
  // ctx has no sqlite3-mcp surface; same Proxy pattern as cycle 6.3 guard
});
```

**Green:** Fill `snapshot.ts`: snapshot-at-entry, SELECT papers, build payload, `db.transaction(...)`.

**Refactor:** None anticipated.

---

## Out of scope (handed to sibling plans)

| Sibling suffix | Cycles | Owns |
|---|---|---|
| `foundation` | 6.1, 6.2 | Scaffolding, frozen contracts, `defaultPdfRoot` / `allPdfRoots` / `writeRuntimeConfig` helpers, no-op stubs for all 9 tool modules, vendored pdf MCP + `lifecycle.ts`. |
| `ingest` | 6.4 | `src/server/ingest/` adapters and `src/server/tools/ingest.ts`. Depends on corpus tools delivered here. |
| `extraction` | 6.5, 6.6, 6.8 | `raw-ddl.ts`, `pdf.ts`, `papers.ts`, `digest.ts`, `prompts.ts`. Owns `scholar.digest.change-since-last-open` — consumer of snapshots from cycle 6.11. Owns view-openers `scholar.paper.show`, `scholar.digest.show`, `scholar.prompts.show`, `scholar.progress.show`. |
| `annotations` | 6.7 | `annotations.ts`. §13 reconciler. |
| `frontends` | 6.9, 6.10 | UI bundle (`CorpusDashboard.tsx` consumes `scholar.dashboard`), nu module, commands, skills. |
| `packaging` | 6.13 | `scripts/build-plugin.ts`. Does NOT own the first-run wizard. |

---

## Test file locations

```
src/server/tools/corpus.test.ts     — cycle 6.3
src/server/tools/roots.test.ts      — cycle 6.3
src/server/tools/snapshot.test.ts   — cycle 6.11
scripts/first-run.test.ts           — cycle 6.3
```

Run with `bun test`.

---

## Execution order within this plan

**6.3 → 6.11.**

**Prerequisites for cycle 6.3 code-landing:**
- Foundation-007 (`defaultPdfRoot` / `allPdfRoots` / `writeRuntimeConfig` helpers) must be available at compile time.
- §10 spec-amendment chore (adding `scholar.corpus.archive` to the tool table) must land before `corpus.archive` ships to users, so the host's tool-discovery surface is accurate. This is a lead-owned chore; execution is not blocked on it but the tool MUST NOT be user-visible until the chore closes (M7).

6.11 is independent of 6.3 beyond the `ServerContext` contract; sequential ordering avoids shared-file edit risk.

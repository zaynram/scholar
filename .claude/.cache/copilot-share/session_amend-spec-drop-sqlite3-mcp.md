# 🤖 Copilot CLI Session

> [!NOTE]
> - **Session ID:** `c7fe3292-146d-4869-860a-35b43574a133`  
> - **Started:** 5/24/2026, 9:26:28 PM  
> - **Duration:** 1m 54s  
> - **Exported:** 5/24/2026, 9:28:23 PM  

---

<sub>⏱️ 2s</sub>

### 👤 User

# Chore: amend-spec-drop-sqlite3-mcp

## Dispatch header
- chore-id: amend-spec-drop-sqlite3-mcp
- vehicle: copilot-cli (simple-chore via spec-pipeline)
- model: gpt-5.3-codex
- tier: analytical
- tier rationale: Cross-document refactor of 12+ surgical anchors across 8 sections of one spec file. Requires judgment on phrasing for replacement prose, careful preservation of surrounding context, and forward-references to a cycle that doesn't yet exist. The chore-author originally recommended Claude opus; routing-invariant #7 ("code-chores must touch src/ or tests/") requires copilot-cli for this docs-only blast radius. gpt-5.3-codex is the simple-chore analytical-tier model per the spec-pipeline taxonomy.
- blast-radius: docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (ONLY this file)
- working dir: /home/ramda/code/scholar (same-repo; not cross-repo)
- branch: ingest/2026-05-22-scholar-plugin (already a feature branch; do NOT create a new branch)

## Context (why this chore exists)
On 2026-05-24, the user ruled posture-B: drop sqlite3-mcp as a delegated dependency. Reason: primary-source inspection of /home/ramda/code/claude-lib/mcpb/mcp-sqlite3 revealed it is a Python/uv FastMCP server, which is unvendorable for the scholar plugin's `bun --compile` single-file distribution model.

Scholar instead implements query/backup/inspect natively in `src/server/tools/{query,backup,inspect}.ts` per a new cycle 6.14. Cycle 6.14 itself is added by a SEPARATE chore (`amend-spec-add-cycle-6.14`) that runs AFTER this one. Your forward-references to "cycle 6.14" will be unresolved until that chore lands — that is expected and intentional. Do NOT add cycle 6.14 yourself.

The foundation, extraction, and corpus plan-mds in `docs/superpowers/plans/` already describe posture-B; the spec must catch up before plan execution starts.

## Scope: exactly these edits, no more

### EDIT 1 — Line 18 (§1. Context and Motivation, last paragraph)
Find the sentence containing "the existing `sqlite3-mcp` and `nushell-mcp` servers".

BEFORE:
\> ...orchestrates the UI through `mcp-apps` views that compose with the vendored (unmodified) pdf MCP and the existing `sqlite3-mcp` and `nushell-mcp` servers already on the user's machine.

AFTER:
\> ...orchestrates the UI through `mcp-apps` views that compose with the vendored (unmodified) pdf MCP and the existing `nushell-mcp` server already on the user's machine.

### EDIT 2 — Line 30 (§3. Constraints, item 5 "Persistence")
BEFORE:
\> 5. **Persistence** — `bun:sqlite` + Drizzle ORM (`drizzle-orm/bun-sqlite`) with the `sqlite-vec` extension loaded for embedding columns. Schema migration is owned by scholar; ad-hoc query/inspect surfaces are delegated to `sqlite3-mcp` via `register_db`.

AFTER:
\> 5. **Persistence** — `bun:sqlite` + Drizzle ORM (`drizzle-orm/bun-sqlite`) with the `sqlite-vec` extension loaded for embedding columns. Schema migration is owned by scholar; ad-hoc query/inspect surfaces are natively implemented as `scholar.query` and `scholar.inspect` (cycle 6.14 — added by a separate chore).

### EDIT 3 — Line 42 (§3. Constraints, item 13 "Backup / distribution")
BEFORE:
\> 13. **Backup / distribution** — delegated to `sqlite3-mcp` (`configure_backup` → `backup_to_repo`, `pack_repo` / `unpack_from_git_ref`).

AFTER:
\> 13. **Backup / distribution** — natively implemented as `scholar.backup` (VACUUM INTO; cycle 6.14 — added by a separate chore). Cross-host corpus distribution is a manual filesystem copy of `scholar-\<corpus\>.db` (see §14.2).

### EDIT 4 — Lines 93-105 (§4 System Architecture, ASCII diagram middle row)
The middle row of the ASCII diagram has three child boxes under "scholar MCP server": (1) `vendored: mcp-pdf-server`, (2) `sqlite3-mcp (existing)`, (3) `Local services`. REMOVE the entire middle box (the `sqlite3-mcp` one), keeping the other two boxes and the connector lines to "SQLite DB + sqlite-vec" below. The two surviving boxes should be visually rebalanced (slightly more horizontal space each) but it's acceptable if they stay in their current x-positions and the middle gap is just empty. Do NOT delete the entire diagram block; only the `sqlite3-mcp` box.

CRITICAL: ASCII art is fragile. Preserve column alignment of the surrounding boxes (vendored: mcp-pdf-server box and Local services box) and the connector lines (`│`, `┴`, `─`) underneath. The SQLite DB box at the bottom must remain reachable from both surviving boxes. If you cannot produce a clean rebalanced diagram, the minimum acceptable edit is: replace the contents of the middle box's lines with blank spaces (matching width) so the alignment stays intact, e.g.:

```
        ┌───────┴─────────┐                            ┌─────────────────┴────┐
        │  vendored:      │                            │  Local services      │
        │  mcp-pdf-server │                            │  - Ollama (embeds +  │
        │  (child proc,   │                            │    chat)             │
        │   unmodified)   │                            │                      │
        └─────────────────┘                            └──────────────────────┘
                │                                                  │
                └──────────────────────┬───────────────────────────┘
                                       │
                               ┌───────┴────────┐
                               │  SQLite DB     │
                               │  + sqlite-vec  │
                               │  (per corpus)  │
                               └────────────────┘
```

### EDIT 5 — Line 114 (§4 Component responsibilities table, "sqlite3-mcp" row)
DELETE the entire table row that begins with `| **sqlite3-mcp (already installed)** |`. Other rows (scholar MCP server, vendored mcp-pdf-server, Ollama, scholar.nu module, scholar UI bundle, nushell-mcp) remain unchanged.

### EDIT 6 — Lines 401-405 (§6.12 entire cycle)
DELETE these 5 lines entirely (the `### 6.12 sqlite3-mcp registration integration` heading and its 4-line body). The result: §6.11 is followed directly by §6.13 with NO §6.12 header in between. (Cycle 6.12 is OBSOLETE post-pivot; cycle 6.14 will be added later by a separate chore. The numbering gap at §6.12 is intentional.)

### EDIT 7 — Line 497 (§7.3 corpus-open step 6)
DELETE the entire line: `6. Registers itself with sqlite3-mcp by calling \`mcp__sqlite3-mcp__register_db\` once per corpus DB (best-effort; ignored if sqlite3-mcp is not running).`

Then RENUMBER the next line (current line 500, "7. Registers MCP tools and the UI resource (see §10 and §11).") to start with "6." instead of "7."

### EDIT 8 — Line 499 (§7.3 "All server-side initialization" paragraph)
This paragraph mentions "corpus-open (steps 4 and 6)". Since step 6 is now deleted, update the parenthetical:

BEFORE: `All server-side initialization — first-run elicitation, corpus-open (steps 4 and 6), and pdf-child spawn (step 5) — is guarded by`

AFTER: `All server-side initialization — first-run elicitation, corpus-open (step 4), and pdf-child spawn (step 5) — is guarded by`

### EDIT 9 — Line 508 (§7.3 Per-step failure-recovery table, "Step 6" row)
DELETE the entire table row that begins with `| 6 — sqlite3-mcp \`register_db\` |`. Then RENUMBER the next row (currently "7 — tool registration") to start with "6 —" instead of "7 —". This keeps the table consistent with the renumbered steps above. (Other rows: 4 — migrations, 5 — pdf-child spawn — remain unchanged.)

### EDIT 10 — Lines 511-547 (§7.4 entire subsection "sqlite3-mcp integration")
REPLACE the entire subsection. The new subsection should:
- Keep the heading position at line 511 but rename to: `### 7.4 Native query / backup / inspect surfaces`
- Replace the 36-line body with this concise content:

```
Scholar implements query, backup, and inspect surfaces natively (no external delegation):

| Need | Scholar tool | Implementation |
|---|---|---|
| Schema migrations | — | Drizzle (§7.3 step 4) |
| Domain-specific reads/writes | scholar.papers.*, scholar.annotations.*, etc. | Tool modules under `src/server/tools/` |
| Ad-hoc SQL exploration | `scholar.query` (cycle 6.14) | `bun:sqlite` direct `prepare`/`run`; BEGIN/ROLLBACK gate on write-intent |
| Schema/table inspection | `scholar.inspect` (cycle 6.14) | `bun:sqlite` `sqlite_master` reads; no-args structured response |
| Backups | `scholar.backup` (cycle 6.14) | SQLite `VACUUM INTO` sole implementation |
| Cross-host corpus distribution | (manual) | Filesystem copy of `scholar-\<corpus\>.db` (see §14.2) |

The earlier sqlite3-mcp-delegation plan (Sessions 1–3) is retired (user ruling 2026-05-24): the upstream sqlite3-mcp is a Python/uv FastMCP server and is unvendorable for the scholar plugin's `bun build --compile` single-file distribution model. The new tools are added by cycle 6.14 (added by a separate chore: `amend-spec-add-cycle-6.14`).
```

CRITICAL: Do NOT preserve any "joint-ownership write discipline" prose, the multi-row "Lifecycle hooks against sqlite3-mcp" table, or the "v1 discipline" numbered list. All of that content is OBSOLETE post-pivot. The §16 v2 candidates about read-only-mode registration (currently referenced as "v2 candidates recorded in §16") were ALSO posture-A-specific — but you do not need to edit §16 in this chore; if the orphan reference exists it will be cleaned up later.

### EDIT 11 — Line 1329 (§14.2 Distribution, third bullet)
BEFORE:
\> - The user can later distribute a *corpus* (not the plugin itself) via sqlite3-mcp's `pack_repo` against `scholar-\<corpus\>.db`, producing a git ref another user can `unpack_from_git_ref` into their scholar installation.

AFTER:
\> - The user can later distribute a *corpus* (not the plugin itself) via filesystem copy of the per-corpus `scholar-\<corpus\>.db` file; the recipient drops it into their `runtime/dbs/` directory and registers it via `scholar.corpus.create` with the existing file path.

### EDIT 12 — Line 1363 (§17 Decisions Log, "sqlite3-mcp integration" bullet)
BEFORE:
\> - sqlite3-mcp integration → **delegate query/backup/pack** surfaces to it via `register_db`.

AFTER:
\> - Query / backup / inspect surfaces → **native** (`scholar.query`, `scholar.backup`, `scholar.inspect`; cycle 6.14). sqlite3-mcp **not used** — its upstream is a Python/uv FastMCP server and is unvendorable for the scholar plugin's `bun build --compile` single-file distribution (user ruling 2026-05-24).

## What is OUT OF SCOPE for this chore
- DO NOT add a new §6.14 cycle. (Separate chore: amend-spec-add-cycle-6.14.)
- DO NOT add new tool entries to §10's tool surface table. (Separate work after cycle 6.14 lands.)
- DO NOT edit §7.6 ServerContext — the `sqlite3:` field is already absent.
- DO NOT edit §16 (Risks and Mitigations) — even though §7.4's deleted v2-candidate prose forward-referenced it.
- DO NOT edit `.claude/context/plans.xml`, `.claude/context/chores.xml`, splits.xml, sequence.xml, or any plan-md files. The dispatcher (Claude Code) handles the chore status flip after you commit.
- DO NOT touch any file under `src/`, `tests/`, `scripts/`, `nu/`, `.github/`, or `.claude-plugin/`. Your blast-radius is ONE file.
- DO NOT bundle related cleanups you notice. Specifically: there may be leftover references to "sqlite3-mcp" elsewhere in the spec (e.g., in §16 risks, the "Persistence" architectural reference in CLAUDE.md, or other docs); do NOT touch those — they are out-of-scope or handled by other chores.

## Output: commit conventions
After making the 12 edits:

1. Verify the result with `git diff --stat docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` — expect only ONE file changed; line-count change in the range of approximately -55 to -75 (net deletion due to §6.12, §7.4 contents being mostly removed, and rewrites being shorter than originals).

2. Stage the change: `git add docs/superpowers/specs/2026-05-22-scholar-plugin-design.md`

3. Write the commit message to a file (do NOT use `-m` inline — shell-safety per spec-pipeline empirical notes; backticks in inline commit messages can be blocked). Write to `/tmp/commit_msg_amend-spec-drop-sqlite3-mcp.txt`:
   ```
   spec(amend): drop sqlite3-mcp delegation (posture-B)

   Remove sqlite3-mcp from spec §1, §3, §4, §6.12 (deleted), §7.3,
   §7.4 (rewritten as Native query/backup/inspect surfaces),
   §14.2, §17. Forward-reference cycle 6.14 (added by a separate
   chore: amend-spec-add-cycle-6.14) for the native query/backup/
   inspect tools. Driver: user ruling 2026-05-24 — upstream
   sqlite3-mcp is Python/uv FastMCP and is unvendorable for
   scholar's bun --compile single-file distribution.

   Closes chore: amend-spec-drop-sqlite3-mcp.
   ```

4. Commit: `git commit -F /tmp/commit_msg_amend-spec-drop-sqlite3-mcp.txt`

5. Capture and report the work-commit SHA: `git rev-parse HEAD`

6. Final stdout line MUST be the SHA on its own line (this is the dispatcher's parse signal):
   ```
   WORK_COMMIT_SHA=\<sha\>
   ```

## Success criteria
- Exactly 1 file modified: `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md`
- All 12 edits applied; ASCII diagram (EDIT 4) remains visually parseable
- §6.12 heading and body absent; §6.11 followed by §6.13 with no intermediate heading
- §7.3 steps renumbered (step 7 → step 6 after deleting old step 6)
- §7.4 renamed to "Native query / backup / inspect surfaces" with the new short body
- Single new commit on the current branch; message contains "Closes chore: amend-spec-drop-sqlite3-mcp"
- Final stdout line is `WORK_COMMIT_SHA=\<sha\>`

## Failure / abort
If you discover the chore cannot complete cleanly (e.g., a line number doesn't match because the file was edited unexpectedly, or an anchor I described is missing), STOP, do NOT commit, and emit:
```
ABORT: \<one-line reason\>
```
The dispatcher will re-investigate.

---

<sub>⏱️ 13s</sub>

### 💬 Copilot

Got it — I’ll apply the 12 scoped edits in the spec file, verify the diff is limited to that file, then commit with the exact message format and report the commit SHA.

---

<sub>⏱️ 13s</sub>

### ✅ `rg`

**sqlite3-mcp|### 7\.4|### 6\.1[23]|corpus-open|Distribution|Decisions Log**

"sqlite3-mcp|### 7\.4|### 6\.1[23]|corpus-open|Distribution|Decisions Log" (docs/superpowers/specs/2026-05-22-scholar-plugin-design.md)

<details>
<summary>36 matches</summary>

```
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:18:This spec proposes `scholar`, a new Cowork plugin that takes the Daisy artifact as inspiration only: it adopts the proven UX patterns (status / depth / digest / reading prompts / per-paper actions) and discards the constraint workarounds. It builds the system on a real backend (Bun + TypeScript MCP server, SQLite via Drizzle, sqlite-vec for embeddings, local Ollama for mechanical LLM work) and orchestrates the UI through `mcp-apps` views that compose with the vendored (unmodified) pdf MCP and the existing `sqlite3-mcp` and `nushell-mcp` servers already on the user's machine.
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:30:5. **Persistence** — `bun:sqlite` + Drizzle ORM (`drizzle-orm/bun-sqlite`) with the `sqlite-vec` extension loaded for embedding columns. Schema migration is owned by scholar; ad-hoc query/inspect surfaces are delegated to `sqlite3-mcp` via `register_db`.
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:42:13. **Backup / distribution** — delegated to `sqlite3-mcp` (`configure_backup` → `backup_to_repo`, `pack_repo` / `unpack_from_git_ref`).
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:93:        │  vendored:      │    │  sqlite3-mcp      │    │  Local services      │
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:114:| **sqlite3-mcp (already installed)** | Provides `query_database`, `inspect_database`, `table_schema`, `configure_backup`, `backup_to_repo`, `pack_repo`, `unpack_from_git_ref`. Scholar calls `register_db` once per corpus DB at activation. We do **not** reimplement query/backup tools. |
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:401:### 6.12 sqlite3-mcp registration integration
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:406:### 6.13 Plugin build
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:495:4. Opens the active corpus's `scholar-<corpus>.db` via `bun:sqlite` wrapped by `drizzle-orm/bun-sqlite` (through `openWithPragmas` from §5.3, so `PRAGMA foreign_keys = ON` is set before any other SQL), loads the `sqlite-vec` extension, runs Drizzle migrations, then re-probes the embed dimension via `loadVecAndProbeDim` from §12.0 and compares against the persisted `settings.embed.{model,dim}` row written at corpus creation (§5.5) — a mismatch surfaces the "drop `chunk_vec` and re-embed" remediation rather than failing at insert time. Finally calls `runRawDdl(db)` (§7.6) to create the `reading_queue` view unconditionally, and the `chunk_vec` virtual table only when the embed dimension is known (either persisted from create-time or freshly probed at open). When `chunk_vec` does not yet exist (Ollama was offline at corpus creation and is still offline now), semantic-search code paths gate on its presence and degrade to lexical-only with a "still indexing" pill, exactly as for partially-embedded chunks. After the open succeeds, the corpus-open initializer also writes `corpora.last_opened_at = nowIso()` to the config DB — consumed by `scholar.corpus.status` (§10). (Deferred until a corpus is active.)
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:497:6. Registers itself with sqlite3-mcp by calling `mcp__sqlite3-mcp__register_db` once per corpus DB (best-effort; ignored if sqlite3-mcp is not running).
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:499:All server-side initialization — first-run elicitation, corpus-open (steps 4 and 6), and pdf-child spawn (step 5) — is guarded by a single promise-memoized initializer per corpus, via `initOnce` from §12.0 keyed on the corpus id. Concurrent tool calls on a fresh install (e.g. the UI opening the dashboard while the model calls `corpus.list`) await one initialization rather than racing `runtime/config.json` writes, issuing duplicate `elicitInput` prompts, or double-spawning the pdf child. **Retry-on-reject semantics:** `initOnce` clears the slot when the factory rejects, so a transient failure (Ollama not yet up, vec0 binary momentarily inaccessible, user dismissed the first-run `elicitInput`) does not permanently break the corpus. Only errors the factory explicitly classifies as fatal (e.g., a permanent schema mismatch) are retained as stuck. **Manual escape hatch:** `scholar.corpus.reset-init` is exposed as a `["model"]`-only tool that clears the init slot for a named corpus, used when an operator wants to force a re-init after fixing an environment issue without restarting the server.
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:508:| 6 — sqlite3-mcp `register_db` | sqlite3-mcp not running, MCP connection refused, the tool rejecting the call. | Log through `ctx.log.warn` and continue. Re-attempted on every `scholar.corpus.activate` and `scholar.corpus.status` (Arch F4 + Integration F5) — both are idempotent against sqlite3-mcp, so retrying is safe. Loss of registration only degrades the model's ad-hoc-SQL surface, not any scholar tool. |
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:511:### 7.4 sqlite3-mcp integration
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:513:Scholar treats sqlite3-mcp as a **complementary** service:
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:515:| Need | Scholar implements | Delegated to sqlite3-mcp |
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:521:| Distribution (corpus snapshots) | — | `pack_repo`, `pack_local`, `unpack_from_git_ref`, `unpack_from_tarball` |
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:524:When scholar opens a corpus, it calls `register_db` with that corpus's path under name `scholar:<corpus>`. When the user runs `/sqlite3-mcp query_database scholar:daisy "SELECT count(*) FROM papers"` they get the result without scholar mediating.
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:526:**Lifecycle hooks against sqlite3-mcp (Integration F4).** The `register_db` call is one event in a larger lifecycle that scholar maintains symmetrically:
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:528:| Scholar event | sqlite3-mcp action | Notes |
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:530:| `scholar.corpus.create` | `register_db` under `scholar:<id>` | Wrapped in the same `initOnce` slot as the corpus-open path so a first-run failure doesn't permanently break the corpus. |
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:531:| `scholar.corpus.activate` | `register_db` (idempotent retry) | Re-attempted on every activate so a sqlite3-mcp restart re-establishes the binding without a scholar restart. Also re-attempted as a side effect of `scholar.corpus.status` so the operator can force-heal by polling status (Arch F4 + Integration F5). |
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:532:| `scholar.corpus.archive` (sets `corpora.archived_at`) | `unregister_db scholar:<id>` if the API exposes it; otherwise log + skip and surface the stale entry through `scholar.corpus.status` | Verified at cycle 6.12 against the live sqlite3-mcp version; the table-row above records the contract scholar depends on. |
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:533:| Corpus delete (physical removal — no v1 caller; documented for v2) | `unregister_db scholar:<id>` then `bun.unlink` the .db file | Order matters: unregister first so sqlite3-mcp doesn't try to hand out a soon-deleted DB. |
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:536:**Joint-ownership write discipline (Open Q2 / Integration F6).** Scholar's per-corpus DB is jointly owned: scholar holds the schema, caches, and reconciler state, but sqlite3-mcp's `query_database` exposes raw SQL to the model. Two access surfaces operate against the same file with different semantics:
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:539:- **`sqlite3-mcp.query_database` (model ad-hoc)** — bypasses every scholar invariant. A `DELETE FROM paper_chunks` issued through this path silently desyncs `chunk_vec` (no FK cascade), drops the §13 reconciler's view of paper history, and invalidates any digest whose `scope_signature` covered the removed rows. The model has no awareness of which writes are safe.
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:541:This is **not** an opportunity to swap to a `bun:sqlite`-native alternative — the two paths serve different roles. `bun:sqlite` is a Bun runtime API only scholar's TypeScript can call; `sqlite3-mcp` exposes MCP tools the model invokes from chat. Dropping `sqlite3-mcp` would remove the model's ad-hoc query surface, which is plan 1.2's deliverable.
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:545:1. Scholar documents the joint-ownership semantics in the `scholar.corpus.status` output and in any operator-facing message that references sqlite3-mcp by name — including a one-line warning that destructive SQL via `query_database` can desync caches.
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:547:3. v2 candidates recorded in §16: investigate whether sqlite3-mcp exposes a read-only registration mode that scholar could prefer when the operator hasn't opted into write access, and whether scholar can subscribe to sqlite3-mcp write events to invalidate caches reactively.
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:578:**Foundation test-scoping rule.** Foundation's cycle-6.1 corpus-open tests exercise the path *through* the empty `runRawDdl` stub and assert only that the call succeeds and the Drizzle-managed tables exist. `chunk_vec` and `reading_queue` are not created until the `extraction` plan fills `raw-ddl.ts` (cycles 6.5/6.6); foundation tests must **not** assert on those two objects.
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:638:// immediately after Drizzle migrations at corpus-open (§7.3 step 4).
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:682:  last_opened_at:  text("last_opened_at"),             // ISO-8601 UTC; updated by initOnce on corpus-open (§7.3 step 4). Consumed by scholar.corpus.status (§10).
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:1313:## 14. Build Pipeline + Distribution
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:1325:### 14.2 Distribution
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:1329:- The user can later distribute a *corpus* (not the plugin itself) via sqlite3-mcp's `pack_repo` against `scholar-<corpus>.db`, producing a git ref another user can `unpack_from_git_ref` into their scholar installation.
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:1350:## 17. Decisions Log (Pre-Plan)
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:1355:- Distribution → **`bun build --compile` to a single self-contained exe** (v1). The `.mcp.json` `command` points at the compiled binary; no `bun` on PATH required.
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:1363:- sqlite3-mcp integration → **delegate query/backup/pack** surfaces to it via `register_db`.
```

</details>


---

<sub>⏱️ 18s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 80-130)

<details>
<summary>51 lines</summary>

````
80.             │  ┌────────────┐   ┌──────────────────┐   ┌────────────────────┐  │
81.             │  │  Chat UI   │   │  MCP App iframes │   │  Tool invocations  │  │
82.             │  └─────┬──────┘   └────────┬─────────┘   └─────────┬──────────┘  │
83.             └────────┼───────────────────┼────────────────────────┼────────────┘
84.                      │                   │                        │
85.         ┌────────────┴────────┐  ┌───────┴─────────┐  ┌───────────┴────────────┐
86.         │  scholar.nu module  │  │  scholar UI     │  │  scholar MCP server    │
87.         │  (user CLI surface) │  │  bundle.html    │  │  (Bun + TypeScript)    │
88.         └─────────────────────┘  └─────────────────┘  └────────────┬───────────┘
89.                                                                    │
90.                 ┌──────────────────────────────────────────────────┴───────┐
91.                 │                                                          │
92.         ┌───────┴─────────┐    ┌───────────────────┐    ┌─────────────────┴────┐
93.         │  vendored:      │    │  sqlite3-mcp      │    │  Local services      │
94.         │  mcp-pdf-server │    │  (existing)       │    │  - Ollama (embeds +  │
95.         │  (child proc,   │    │  registers        │    │    chat)             │
96.         │   unmodified)   │    │  scholar DB       │    │                      │
97.         └─────────────────┘    └───────────────────┘    └──────────────────────┘
98.                 │                       │                          │
99.                 └───────────────────────┼──────────────────────────┘
100.                                         │
101.                                 ┌───────┴────────┐
102.                                 │  SQLite DB     │
103.                                 │  + sqlite-vec  │
104.                                 │  (per corpus)  │
105.                                 └────────────────┘
106. ```
107. 
108. ### Component responsibilities
109. 
110. | Component | Responsibility |
111. |---|---|
112. | **scholar MCP server (this plugin's core)** | Owns the SQLite schema (Drizzle-managed migrations). Exposes corpus, ingestion, annotation, digest, prompt, search, and UI-resource tools. Spawns and supervises the vendored pdf MCP as a child process; acts as the MCP client for that session, answering `roots/list` requests with the active corpus's PDF roots. |
113. | **vendored mcp-pdf-server (unmodified)** | `@modelcontextprotocol/server-pdf@1.7.2` shipped as-is in `src/vendor/pdf-server/`. Receives root paths through MCP `roots/list` (it asks; scholar answers) and re-asks on `notifications/roots/list_changed` — no subprocess respawn for root changes. |
114. | **sqlite3-mcp (already installed)** | Provides `query_database`, `inspect_database`, `table_schema`, `configure_backup`, `backup_to_repo`, `pack_repo`, `unpack_from_git_ref`. Scholar calls `register_db` once per corpus DB at activation. We do **not** reimplement query/backup tools. |
115. | **Ollama (local)** | Embedding production (`nomic-embed-text:v1.5` default tag), digest/synthesis chat (`qwen3:8b` default tag), reading-prompts. Scholar discovers running Ollama via `http://127.0.0.1:11434/api/tags` and falls back to a queue if Ollama is offline. |
116. | **scholar.nu module** | User-facing thin CLI wrapper. `use scholar.nu *` then `scholar status --corpus daisy` etc. Each command does one MCP call and shapes the response into nu tables. |
117. | **scholar UI bundle** | Single-file HTML produced by **Bun's HTML bundler** (`bun build ./src/ui/index.html --target=browser`, which inlines JS, CSS, and assets without a separate `vite-plugin-singlefile` step); React. Five views routed by tool input. Reads from scholar MCP via `app.callServerTool`. Composes with the pdf MCP for paper-detail rendering. |
118. | **nushell-mcp (already installed)** | Used as a generic command runner if scholar needs to invoke external scripts (e.g., the `bibtex-tidy` CLI already on the user's PATH). Not load-bearing. |
119. 
120. ## 5. Project Layout
121. 
122. Plugin source root: `C:\Users\ramda\mcp-data\scholar` (already created).
123. Plugin runtime root: `%USERPROFILE%\mcp-data\scholar\runtime` (created on first launch).
124. Build output: `C:\Users\ramda\Documents\Cowork\System\scholar.plugin` (`.plugin` archive).
125. 
126. ```
127. scholar/
128. ├── .claude/
129. │   ├── context/
130. │   │   ├── plans.xml          (spec-pipeline canonical plan registry)
````

</details>


---

<sub>⏱️ 18s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 390-420)

<details>
<summary>31 lines</summary>

````
390. 
391. ### 6.10 nu module + slash commands + skills
392. User-facing surfaces: `scholar.nu`, `/scholar:ingest`, `/scholar:digest`, `/scholar:status`, and the two skills.
393. **Touches:** §5.30, §5.31, §5.32, §5.33, §5.34, §5.35.
394. **Depends-on:** 6.4, 6.5, 6.6, 6.7, 6.8.
395. 
396. ### 6.11 Snapshots + change-since-last-open
397. `scholar.snapshot.take` and the delta-digest computation that diffs against the most recent snapshot.
398. **Touches:** §5.13.
399. **Depends-on:** 6.1.
400. 
401. ### 6.12 sqlite3-mcp registration integration
402. `register_db` on corpus activation (wired into `src/server/tools/corpus.ts`). The backup/distribution recipe is specified in §14.2; this cycle produces no separate doc file.
403. **Touches:** §5.5.
404. **Depends-on:** 6.1.
405. 
406. ### 6.13 Plugin build
407. `scripts/build-plugin.ts` — the build orchestrator that assembles the `scholar.plugin` archive. The first-run PDF-root wizard is owned by cycle 6.3, not here.
408. **Touches:** §5.36.
409. **Depends-on:** 6.9, 6.10.
410. 
411. ## 7. Plugin Manifest and MCP Server Design
412. 
413. ### 7.1 Plugin manifest
414. 
415. `.claude-plugin/plugin.json`:
416. ```json
417. {
418.   "name": "scholar",
419.   "version": "0.1.0",
420.   "description": "Literature review workspace. Multi-corpus reading, annotation, semantic search, Ollama-powered syntheses, and a vendored pdf MCP. Inspired by but independent of the Daisy Lit Review artifact.",
````

</details>


---

<sub>⏱️ 18s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 485-560)

<details>
<summary>76 lines</summary>

````
485. 
486. **The host sees the scholar server's `pdf.*` proxy tools (see §10), not the vendored server directly.**
487. 
488. ### 7.3 Scholar core MCP server
489. 
490. Entry: `src/server/index.ts`. Uses `@modelcontextprotocol/sdk` over stdio. On startup:
491. 
492. 1. Resolves `SCHOLAR_RUNTIME_ROOT`, ensures `runtime/dbs/` exists.
493. 2. Reads `runtime/config.json` (corpora list, active corpus, default PDF root, Ollama model overrides).
494. 3. First-run handling is **not** done at startup. When a corpus tool (`scholar.corpus.list` / `scholar.corpus.activate`) runs and finds no corpus configured, it calls the first-run routine in `scripts/first-run.ts`, which uses the live MCP session's `elicitInput` request to ask the host for the initial PDF root, then drives `scholar.corpus.create` with the elicited path as `initial_pdf_root`. The wizard writes (a) `runtime/config.json` for the active-corpus pointer and (b) the cross-DB `corpora` row plus a `pdf_roots` row with `is_default = true` (the latter is the canonical location of the default root — `corpora` no longer carries a `pdf_root` column, per §8.1 / Data F18). `first-run.ts` is a module imported by `src/server/tools/corpus.ts` (both `corpus`-plan owned) — not a standalone executable.
495. 4. Opens the active corpus's `scholar-<corpus>.db` via `bun:sqlite` wrapped by `drizzle-orm/bun-sqlite` (through `openWithPragmas` from §5.3, so `PRAGMA foreign_keys = ON` is set before any other SQL), loads the `sqlite-vec` extension, runs Drizzle migrations, then re-probes the embed dimension via `loadVecAndProbeDim` from §12.0 and compares against the persisted `settings.embed.{model,dim}` row written at corpus creation (§5.5) — a mismatch surfaces the "drop `chunk_vec` and re-embed" remediation rather than failing at insert time. Finally calls `runRawDdl(db)` (§7.6) to create the `reading_queue` view unconditionally, and the `chunk_vec` virtual table only when the embed dimension is known (either persisted from create-time or freshly probed at open). When `chunk_vec` does not yet exist (Ollama was offline at corpus creation and is still offline now), semantic-search code paths gate on its presence and degrade to lexical-only with a "still indexing" pill, exactly as for partially-embedded chunks. After the open succeeds, the corpus-open initializer also writes `corpora.last_opened_at = nowIso()` to the config DB — consumed by `scholar.corpus.status` (§10). (Deferred until a corpus is active.)
496. 5. Spawns the pdf child with the active corpus's roots. (Deferred until a corpus is active.)
497. 6. Registers itself with sqlite3-mcp by calling `mcp__sqlite3-mcp__register_db` once per corpus DB (best-effort; ignored if sqlite3-mcp is not running).
498. 
499. All server-side initialization — first-run elicitation, corpus-open (steps 4 and 6), and pdf-child spawn (step 5) — is guarded by a single promise-memoized initializer per corpus, via `initOnce` from §12.0 keyed on the corpus id. Concurrent tool calls on a fresh install (e.g. the UI opening the dashboard while the model calls `corpus.list`) await one initialization rather than racing `runtime/config.json` writes, issuing duplicate `elicitInput` prompts, or double-spawning the pdf child. **Retry-on-reject semantics:** `initOnce` clears the slot when the factory rejects, so a transient failure (Ollama not yet up, vec0 binary momentarily inaccessible, user dismissed the first-run `elicitInput`) does not permanently break the corpus. Only errors the factory explicitly classifies as fatal (e.g., a permanent schema mismatch) are retained as stuck. **Manual escape hatch:** `scholar.corpus.reset-init` is exposed as a `["model"]`-only tool that clears the init slot for a named corpus, used when an operator wants to force a re-init after fixing an environment issue without restarting the server.
500. 7. Registers MCP tools and the UI resource (see §10 and §11).
501. 
502. **Per-step failure-recovery posture (Arch F13).** Each step has a documented degradation behaviour rather than a uniform "abort startup" stance — steps 4–6 can fail transiently and scholar must keep the operator's options open:
503. 
504. | Step | Failure mode | Recovery posture |
505. |---|---|---|
506. | 4 — migrations + raw-ddl | A Drizzle migration that already ran in part, a vec0 load failure, a partial `chunk_vec` materialization. | Idempotent. `IF NOT EXISTS` covers raw DDL; Drizzle migrations are content-addressed and self-heal on retry. The `initOnce` retry-on-reject semantics above re-drive the factory; an operator who fixed the underlying issue (e.g., pulled the embed model) re-triggers via any corpus tool call. |
507. | 5 — pdf-child spawn | Spawn `EACCES`, missing `build/runtime/bun` (pipeline regression), the Job Object FFI binding (Windows) failing to load, or the child crashing during the initial handshake. | Degrade — do not abort the corpus open. Scholar publishes a typed `PDF_CHILD_UNAVAILABLE` error from every `pdf.*` proxy call; `corpus.*`, `papers.search` (lexical), `digest.*`, and `prompts.*` continue to work. The lifecycle module supervises with exponential backoff (1s, 2s, 4s, 8s, capped at 30s) and clears the error once a spawn succeeds. |
508. | 6 — sqlite3-mcp `register_db` | sqlite3-mcp not running, MCP connection refused, the tool rejecting the call. | Log through `ctx.log.warn` and continue. Re-attempted on every `scholar.corpus.activate` and `scholar.corpus.status` (Arch F4 + Integration F5) — both are idempotent against sqlite3-mcp, so retrying is safe. Loss of registration only degrades the model's ad-hoc-SQL surface, not any scholar tool. |
509. | 7 — tool registration | A `server.registerTool` rejection (duplicate name, schema validation), the resource registration failing. | Abort startup with a structured error to the host. This is a programmer error (a downstream plan introduced a duplicate or malformed schema) that no operator can fix at runtime; failing fast surfaces the bug instead of silently shipping a half-registered toolset. |
510. 
511. ### 7.4 sqlite3-mcp integration
512. 
513. Scholar treats sqlite3-mcp as a **complementary** service:
514. 
515. | Need | Scholar implements | Delegated to sqlite3-mcp |
516. |---|---|---|
517. | Schema migrations | ✔ via Drizzle | — |
518. | Domain-specific reads/writes | ✔ as MCP tools | — |
519. | Ad-hoc SQL exploration | — | `query_database`, `inspect_database`, `table_schema`, `list_tables` |
520. | Backups | — | `configure_backup`, `backup_local`, `backup_to_repo`, `get_backup_config` |
521. | Distribution (corpus snapshots) | — | `pack_repo`, `pack_local`, `unpack_from_git_ref`, `unpack_from_tarball` |
522. | Cross-corpus copy | — | `copy_database` |
523. 
524. When scholar opens a corpus, it calls `register_db` with that corpus's path under name `scholar:<corpus>`. When the user runs `/sqlite3-mcp query_database scholar:daisy "SELECT count(*) FROM papers"` they get the result without scholar mediating.
525. 
526. **Lifecycle hooks against sqlite3-mcp (Integration F4).** The `register_db` call is one event in a larger lifecycle that scholar maintains symmetrically:
527. 
528. | Scholar event | sqlite3-mcp action | Notes |
529. |---|---|---|
530. | `scholar.corpus.create` | `register_db` under `scholar:<id>` | Wrapped in the same `initOnce` slot as the corpus-open path so a first-run failure doesn't permanently break the corpus. |
531. | `scholar.corpus.activate` | `register_db` (idempotent retry) | Re-attempted on every activate so a sqlite3-mcp restart re-establishes the binding without a scholar restart. Also re-attempted as a side effect of `scholar.corpus.status` so the operator can force-heal by polling status (Arch F4 + Integration F5). |
532. | `scholar.corpus.archive` (sets `corpora.archived_at`) | `unregister_db scholar:<id>` if the API exposes it; otherwise log + skip and surface the stale entry through `scholar.corpus.status` | Verified at cycle 6.12 against the live sqlite3-mcp version; the table-row above records the contract scholar depends on. |
533. | Corpus delete (physical removal — no v1 caller; documented for v2) | `unregister_db scholar:<id>` then `bun.unlink` the .db file | Order matters: unregister first so sqlite3-mcp doesn't try to hand out a soon-deleted DB. |
534. | Corpus rename | `register_db scholar:<new-name>` then `unregister_db scholar:<old-name>` | New first, old second, so an interrupted rename leaves both names pointing at the live file rather than neither. |
535. 
536. **Joint-ownership write discipline (Open Q2 / Integration F6).** Scholar's per-corpus DB is jointly owned: scholar holds the schema, caches, and reconciler state, but sqlite3-mcp's `query_database` exposes raw SQL to the model. Two access surfaces operate against the same file with different semantics:
537. 
538. - **`bun:sqlite` (scholar code)** — the only path that maintains scholar's invariants. All writes from inside scholar's own tool handlers go through Drizzle on `bun:sqlite`. The transaction boundaries from §11 and §13 hold here.
539. - **`sqlite3-mcp.query_database` (model ad-hoc)** — bypasses every scholar invariant. A `DELETE FROM paper_chunks` issued through this path silently desyncs `chunk_vec` (no FK cascade), drops the §13 reconciler's view of paper history, and invalidates any digest whose `scope_signature` covered the removed rows. The model has no awareness of which writes are safe.
540. 
541. This is **not** an opportunity to swap to a `bun:sqlite`-native alternative — the two paths serve different roles. `bun:sqlite` is a Bun runtime API only scholar's TypeScript can call; `sqlite3-mcp` exposes MCP tools the model invokes from chat. Dropping `sqlite3-mcp` would remove the model's ad-hoc query surface, which is plan 1.2's deliverable.
542. 
543. v1 discipline:
544. 
545. 1. Scholar documents the joint-ownership semantics in the `scholar.corpus.status` output and in any operator-facing message that references sqlite3-mcp by name — including a one-line warning that destructive SQL via `query_database` can desync caches.
546. 2. The skill `skills/scholar-workflow/SKILL.md` (cycle 6.10) carries the model-facing version of the same warning: **SELECT-only against `scholar:*` DBs unless you've read the schema and understand which caches your write disturbs.**
547. 3. v2 candidates recorded in §16: investigate whether sqlite3-mcp exposes a read-only registration mode that scholar could prefer when the operator hasn't opted into write access, and whether scholar can subscribe to sqlite3-mcp write events to invalidate caches reactively.
548. 
549. ### 7.5 Nushell module
550. 
551. `nu/scholar.nu` exports user-facing commands. All commands shell out to the scholar MCP via a small `nu_invoke` helper that wraps the official MCP client CLI invoked as a child process. **Transport is decided: the MCP client CLI** — the named-pipe alternative considered earlier is dropped. One example:
552. 
553. ```nu
554. export def main [] { scholar status }
555. 
556. export def status [
557.   --corpus(-c): string  # corpus name; defaults to active
558. ] {
559.   let payload = {tool: "corpus.status", args: {corpus: $corpus}}
560.   $payload | to json | nu_invoke | from json | get papers | sort-by status
````

</details>


---

<sub>⏱️ 18s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 1318-1370)

<details>
<summary>53 lines</summary>

```
1318. 2. `bun run build:ui` — `bun build src/ui/index.html --target=browser --outfile build/ui/app.html` (Bun's HTML bundler inlines JS, CSS, and small static assets into a single file; `--splitting` is unsupported with `--compile` but the UI is a single entry point so chunking is moot). Target: ≤ 4.5 MB to stay 90% under the asserted 5 MB iframe-resource cap. **Bundle-budget gate (cycle 6.9 produces the measurement):** cycle 6.9 emits a per-dependency KB table for pdf.js, Chart.js, React, and any other UI dep. If the bundled total exceeds 4.5 MB, the gate triggers one of three remediations, in order: (a) serve pdf.js's worker as a separate `ui://scholar/pdf-worker.js` resource and lazy-load it (smallest churn); (b) hand off heavyweight viewing to the pdf-viewer plugin via an `open in pdf-viewer` action in the paper-detail view (the §9.2 affordance already exists) and drop bundled pdf.js entirely; (c) swap React for Preact and/or Chart.js for uPlot per the §17 documented candidates. The measurement is the trigger — none of these swaps land speculatively.
1319. 3. `bun run build:pdf` — copies the unmodified vendored upstream pdf dist from `src/vendor/pdf-server/` to `build/vendor/pdf-server/`. No transpilation and no patch step — re-vendoring on upstream bump is a `bun pm pack @modelcontextprotocol/server-pdf@<new>` → unpack → swap.
1320. 4. `bun run build:runtime` — copies the Bun runtime binary (`bun.exe` on Windows, `bun` on POSIX) from the build host's Bun install to `build/runtime/`. Required because scholar's compiled binary cannot re-exec the Node-style pdf-child script under its embedded runtime (§7.2); this bundled `bun` is the spawn target. The runtime version pinned at build time is recorded in `package.json`'s `scholar.bundledBunVersion` field and must match `scholar.bunSqliteVersion` from step 5 (both are read from the same Bun release).
1321. 5. `bun run build:vec` — produces the `vec0` shared library at `build/vendor/sqlite-vec/`. Default path: copy a prebuilt `vec0.dll` (Windows-x64, ABI-pinned to the SQLite version Bun's `bun:sqlite` links against in this Bun release — see §16). Fallback path: if the prebuilt and Bun's linked SQLite disagree on ABI, the script compiles `vec0` from source (`sqlite-vec` upstream) against headers extracted from the Bun runtime — surfaced as a cycle 6.1 build requirement.
1322. 6. `bun run build:nu` — copies `nu/scholar.nu` into the bundle.
1323. 7. `bun run build:plugin` — assembles a tree at `build/plugin/` matching the installable layout, then zips it as `scholar.plugin` in `%USERPROFILE%\Documents\Cowork\System\` for the user to install via Cowork's plugin import.
1324. 
1325. ### 14.2 Distribution
1326. 
1327. - The `.plugin` archive is installed via Cowork's plugin import UI.
1328. - On first corpus access the in-server first-run routine (§7.3 step 3) elicits the default PDF root via `elicitInput` (per the user's "user-pick" choice). There is no separate install-time wizard step.
1329. - The user can later distribute a *corpus* (not the plugin itself) via sqlite3-mcp's `pack_repo` against `scholar-<corpus>.db`, producing a git ref another user can `unpack_from_git_ref` into their scholar installation.
1330. 
1331. ## 15. Cycle Sequencing
1332. 
1333. Cycles are enumerated in §6 (Implementation Cycles) with per-cycle `Touches` / `Depends-on` declarations. The spec-pipeline `ingest-spec` workflow uses §6 as the authoritative cycle list when deriving the plan-split. The dependency graph supports a multi-plan split with **three serial waves between scaffolding and packaging: corpus → {ingest, extraction, annotations} (one concurrent wave of three plans) → frontends**. Foundation runs before all of these; packaging runs after all of these. The concrete plan/cycle assignment and dependency wiring lives in `docs/superpowers/specs/2026-05-22-scholar-plugin-splits.xml`.
1334. 
1335. ## 16. Risks and Mitigations
1336. 
1337. | Risk | Mitigation |
1338. |---|---|
1339. | Ollama unavailable when user expects digests. | Graceful degradation (placeholder + warning toast); explicit "use Claude" opt-in for any single request. |
1340. | sqlite-vec extension load fails on the user's system. | **(a) SQLite source.** Scholar loads `vec0` against the SQLite engine Bun bundles with `bun:sqlite`; `Database.setCustomSQLite()` is **not** used in v1 — pinning to Bun's bundled SQLite means one ABI to test per Bun release and removes a user-environment failure mode (`setCustomSQLite` would require the user to ship a matching libsqlite). **(b) `vec0` triple.** The bundled `vec0.dll` / `vec0.so` / `vec0.dylib` triple lives in `build/vendor/sqlite-vec/`, ABI-pinned to the SQLite version Bun links in the active Bun release; v1 ships `vec0.dll` only (Windows-targeted per §3). The exact pin is recorded in `package.json`'s `scholar.bunSqliteVersion` field at cycle 6.1 build time. **(c) Load detection.** `loadVecAndProbeDim` (§12.0) is called at corpus open; failure falls back to lexical-only search with a remediation hint. The `vec0` shared library is resolved by absolute path — Bun's `loadExtension` does not require co-location with the engine binary. **(d) ABI mismatch on Windows.** If a prebuilt `vec0.dll` doesn't ABI-match Bun's linked SQLite at any point (Bun upgrade, sqlite-vec upgrade), the build step (§14.1 step 5) compiles `vec0` from upstream source against headers extracted from the Bun runtime — surfaced as a cycle 6.1 build requirement and the only reason the build pipeline carries a C toolchain. The vec0 smoke test in cycle 6.5 (per §6.5) is the canary. |
1341. | Upstream pdf server changes its MCP protocol shape (e.g., drops `useClientRoots`, changes `roots/list` reply schema, renames `interact` types). | Vendor is **unmodified** — there is no patch to re-apply, so divergence surfaces as protocol-shape changes scholar's MCP client side must adapt to. Re-vendoring on a minor bump is `bun pm pack` + unpack + run the cycle-6.2 fixture suite (roots/list responder, list_changed round-trip, viewUUID survival across a root mutation); any failure pins the affected behaviour to a versioned shim in `src/server/pdf/lifecycle.ts`. Major bumps are gated on the same fixture suite plus an annotations-round-trip retest. |
1342. | Latent upstream `useClientRoots` propagation bug (the env-var-derived `roots` value computed at `dist/index.js:34386–34391` is not threaded through to `createServer` on line 34392 — the call uses the original CLI flag instead). | Scholar passes `--use-client-roots` on the command line, so `useClientRoots` is already `true` at the createServer call and the bug never bites. No source patch needed; the workaround is purely in the spawn invocation. A future upstream fix would be a no-op for scholar. |
1343. | Drop vendored copy entirely (v2 simplification candidate). | Spawn via `bunx @modelcontextprotocol/server-pdf` when a sufficient network and bun runtime are present, removing `src/vendor/pdf-server/` from the bundle. Trade-off: removes the offline-distribution guarantee. Not pursued in v1 because the plugin must remain installable in air-gapped Cowork hosts. (Distinct from the v1-adopted protocol-based roots approach in §7.2.) |
1344. | Native FFI for the Windows Job Object orphan-reaping path. | Single FFI surface in `src/server/pdf/lifecycle.ts` via `koffi` (preferred) or `win32-api`. Falls back to a startup-sweep + `prctl(PR_SET_PDEATHSIG)` posture on non-Windows. The dependency is pinned and the failure mode is "no orphan reaping on Windows" — supervised respawn still works inside a live scholar session. |
1345. | Annotation reconciliation conflicts (user edits in both panes concurrently). | Last-write-wins keyed by `updated_at`; scholar reconciles on paper-detail open/refresh (§13). Test with a deliberate concurrent-edit race. |
1346. | Embedding production blocks tool responses on big papers. | Embedding pipeline runs on an in-process async queue with a small concurrency limit (a worker thread is deferred to v2 if profiling shows main-thread starvation); tools that need embeddings (`scholar.papers.search` with semantic mode) check readiness and degrade to lexical with a "still indexing" pill. |
1347. | User installs the plugin without the global `bun.exe`. | v1 ships scholar as a single self-contained executable produced by `bun build --compile` (promoted from earlier "v2 considers"); `.mcp.json`'s `command` points at the compiled binary, so the runtime host does not need `bun` on PATH for scholar's own process. The Bun runtime itself is **also** bundled into `build/runtime/bun(.exe)` because scholar spawns the unmodified Node-style pdf-child script (`src/vendor/pdf-server/dist/index.js`) and a `bun build --compile` artifact cannot re-exec arbitrary scripts under its embedded runtime (§7.2). The compiled scholar artifact and the bundled runtime are both produced by the §14.1 build pipeline; the `.mcp.json` command swap to the compiled exe and the runtime bundling decision were finalized in Session 4. |
1348. | The Cowork outputs folder isn't where the user installs from. | The build script writes a copy to both `%USERPROFILE%\Documents\Cowork\System\` and (best-effort) the user's Cowork plugin-import staging directory; surfaces a chat link. |
1349. 
1350. ## 17. Decisions Log (Pre-Plan)
1351. 
1352. - Plugin slug → **`scholar`**.
1353. - Corpus model → **multi-corpus** (corpus_id keys all per-corpus tables).
1354. - Persistence → **`bun:sqlite` + Drizzle (`drizzle-orm/bun-sqlite`)** with `sqlite-vec`. (Swapped from `better-sqlite3` during the 2026-05-22 spec revision; the swap also unlocks the v1 `bun build --compile` distribution because the runtime no longer depends on a Node.js-side native module.)
1355. - Distribution → **`bun build --compile` to a single self-contained exe** (v1). The `.mcp.json` `command` points at the compiled binary; no `bun` on PATH required.
1356. - Metadata sources → **CrossRef + arXiv + BibTeX/RIS**. (No Semantic Scholar, no OpenAlex.)
1357. - Reading queue → **simple priority** (no FSRS).
1358. - Semantic search → **sqlite-vec + local Ollama**.
1359. - Nushell wiring → **user-facing CLI only**.
1360. - PDF root default → **prompt at install** with `%USERPROFILE%/mcp-data/literature/` as the suggested override path.
1361. - Mechanical LLM work → **Ollama by default**; `cowork.askClaude` is opt-in only.
1362. - pdf MCP → **bundled unmodified vendor of v1.7.2** (`@modelcontextprotocol/server-pdf@1.7.2` `dist/` shipped as-is under `src/vendor/pdf-server/`). Root injection rides the MCP `roots/list` protocol — scholar's MCP client advertises `capabilities.roots.listChanged` and serves `ListRootsRequestSchema` from the active corpus's `pdf_roots` rows; `notifications/roots/list_changed` fires on root mutation, no subprocess respawn. The earlier "two-line patch + `MCP_PDF_CLIENT_ROOTS_PATHS` env var" plan is retired (Session 3 / Integration F2/F3) — the patch existed only because scholar wasn't holding up its client-side end of the protocol.
1363. - sqlite3-mcp integration → **delegate query/backup/pack** surfaces to it via `register_db`.
1364. - Tool wiring → **registry barrel + foundation-scaffolded stubs** (§7.6) so the seven plans' blast-radii stay file-disjoint.
1365. - First-run wizard → **server-side `elicitInput`, invoked lazily by the corpus tool**; not a standalone script.
1366. - nu transport → **MCP client CLI** (named-pipe alternative dropped).
1367. - Annotation propagation → **scholar→viewer push + viewer→scholar reconcile-on-read**, LWW on `updated_at`; no dependency on pdf-MCP push notifications.
1368. - Paper-detail PDF render → **bundled pdf.js in scholar's own iframe**; not a nested MCP App iframe.
1369. - Chart.js and pdf.js → **bundled** into the single-file UI; no runtime CDN dependency.
1370. - Cross-plan contracts (`ServerContext`, `PdfChild`, `ConfigAccessor`, `registerTools`, `runRawDdl`) → **pinned in §7.6 and frozen for v1**; no downstream plan edits `registry.ts`.
```

</details>


---

<sub>⏱️ 22s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 1-55)

<details>
<summary>55 lines</summary>

```
1. # Scholar — Literature Review Plugin (Design Spec)
2. 
3. > Slug: `2026-05-22-scholar-plugin`
4. > Status: draft, pre-plan
5. > Author: zayn (with Claude)
6. > Date: 2026-05-22
7. 
8. ## 1. Context and Motivation
9. 
10. The Daisy Lit Review live artifact (88-paper, 14-section DAISY corpus dashboard) demonstrated the *shape* of a useful literature-review experience: status cycling, scoped Haiku syntheses, change-since-last-open digests, per-paper reading prompts, annotation CRUD round-tripping with the pdf-viewer, and an "open externally / send-to-chat" handoff. Its limitations are structural to the live-artifact form factor:
11. 
12. - **Sandboxed iframe** forces `localStorage` as primary store; persistence is mirrored to a JSON file via PowerShell shell-out.
13. - **No backend** means anchor extraction is performed via a PowerShell-spawned Python script (uv → pypdf), and chat-session enumeration relies on UIA toggling of the sidebar.
14. - **No vector layer** means search is limited to literal substring matching.
15. - **Single-corpus by design** because the papers bundle is embedded into the HTML at build time.
16. - **No ingestion pipeline** because there is no file watcher and no metadata API integration.
17. 
18. This spec proposes `scholar`, a new Cowork plugin that takes the Daisy artifact as inspiration only: it adopts the proven UX patterns (status / depth / digest / reading prompts / per-paper actions) and discards the constraint workarounds. It builds the system on a real backend (Bun + TypeScript MCP server, SQLite via Drizzle, sqlite-vec for embeddings, local Ollama for mechanical LLM work) and orchestrates the UI through `mcp-apps` views that compose with the vendored (unmodified) pdf MCP and the existing `sqlite3-mcp` and `nushell-mcp` servers already on the user's machine.
19. 
20. The plugin is explicitly **not** a port of the Daisy artifact. It is a clean reimplementation informed by the artifact's feature catalogue.
21. 
22. ## 2. Scope
23. 
24. ### In scope (v1)
25. 
26. 1. **Plugin packaging** — installable `.plugin` archive with `.claude-plugin/plugin.json`, `.mcp.json`, bundled servers, skills, slash commands, and an MCP App UI bundle.
27. 2. **Vendored pdf MCP server (unmodified)** — `@modelcontextprotocol/server-pdf@1.7.2` shipped as-is under `src/vendor/pdf-server/`. Runtime multi-root management is delivered by scholar's MCP client side responding to `roots/list` and emitting `notifications/roots/list_changed` (§7.2) — no source patch.
28. 3. **Scholar MCP server** — Bun + TypeScript, exposes corpus management, ingestion, annotation, digest, reading-prompts, and UI-resource tools. Owns the SQLite database.
29. 4. **Multi-corpus support** — named corpora with isolated SQLite DBs and per-corpus PDF roots. Add/remove/switch corpora at runtime.
30. 5. **Persistence** — `bun:sqlite` + Drizzle ORM (`drizzle-orm/bun-sqlite`) with the `sqlite-vec` extension loaded for embedding columns. Schema migration is owned by scholar; ad-hoc query/inspect surfaces are delegated to `sqlite3-mcp` via `register_db`.
31. 6. **Ingestion** — three paths:
32.     - BibTeX / RIS file import (BibTeX via `@retorquere/bibtex-parser`; RIS via the in-house adapter in `src/server/ingest/bibtex.ts`).
33.     - CrossRef DOI lookup (no auth, free).
34.     - arXiv abstract API ingest (no auth, free).
35.     Manual entry (single-paper form) is the fallback.
36. 7. **Semantic search** — `sqlite-vec` index over paper title + abstract + extracted text chunks; embeddings produced via local Ollama (`nomic-embed-text:v1.5` default tag; user-pluggable).
37. 8. **Annotation surface** — schema-compatible with the Daisy round-trip (`{ id, page?, anchor?, body, created_at, updated_at, source }`); round-trips with the child pdf MCP (scholar→viewer push, viewer→scholar reconcile-on-read — see §13).
38. 9. **Synthesis / digest / reading prompts** — local Ollama by default (Qwen-class chat model, user-pluggable). Escape hatch to `cowork.askClaude` for high-stakes synthesis where the user explicitly opts in.
39. 10. **Reading queue** — simple priority queue (manual `priority` integer + computed staleness signals); no FSRS in v1.
40. 11. **MCP App view surfaces (5)** — corpus dashboard, paper detail, digest panel, reading prompts pane, reader progress (charts).
41. 12. **Nushell user CLI** — `scholar` nu module (`use scholar.nu *`) with `scholar list`, `scholar status`, `scholar ingest`, `scholar query`, `scholar digest`. Pure UX surface — delegates to scholar MCP via `mcp__nushell__nu_run` style invocations of the MCP CLI client. **No internal logic in nu.**
42. 13. **Backup / distribution** — delegated to `sqlite3-mcp` (`configure_backup` → `backup_to_repo`, `pack_repo` / `unpack_from_git_ref`).
43. 
44. ### Out of scope (v1, candidates for v2+)
45. 
46. - FSRS-based spaced repetition reading queue.
47. - Annotation graph / Zettelkasten edges (the v1 surfaces dropped the "annotation graph panel" from the UI elicitation).
48. - Semantic Scholar API integration (deferred per user direction).
49. - OpenAlex integration.
50. - Mobile / non-Windows packaging.
51. - Multi-user / shared-corpus syncing.
52. - Certified PDF signing (the bundled pdf MCP supports image-stamp signatures only).
53. - Filesystem watcher for auto-ingest of newly-dropped PDFs. v1 ingestion is explicitly user-triggered (BibTeX/RIS, DOI, arXiv, manual); a directory watcher is deferred to v2.
54. 
55. ### Non-goals
```

</details>


---

<sub>⏱️ 34s</sub>

### 💬 Copilot

I’ve located all anchors and I’m now applying the scoped replacements/removals in a single patch to keep the spec consistent.

---

<sub>⏱️ 34s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 88-106)

<details>
<summary>19 lines</summary>

````
88.         └─────────────────────┘  └─────────────────┘  └────────────┬───────────┘
89.                                                                    │
90.                 ┌──────────────────────────────────────────────────┴───────┐
91.                 │                                                          │
92.         ┌───────┴─────────┐    ┌───────────────────┐    ┌─────────────────┴────┐
93.         │  vendored:      │    │  sqlite3-mcp      │    │  Local services      │
94.         │  mcp-pdf-server │    │  (existing)       │    │  - Ollama (embeds +  │
95.         │  (child proc,   │    │  registers        │    │    chat)             │
96.         │   unmodified)   │    │  scholar DB       │    │                      │
97.         └─────────────────┘    └───────────────────┘    └──────────────────────┘
98.                 │                       │                          │
99.                 └───────────────────────┼──────────────────────────┘
100.                                         │
101.                                 ┌───────┴────────┐
102.                                 │  SQLite DB     │
103.                                 │  + sqlite-vec  │
104.                                 │  (per corpus)  │
105.                                 └────────────────┘
106. ```
````

</details>


---

<sub>⏱️ 1m 6s</sub>

### ✅ `apply_patch`

<details>
<summary>Arguments</summary>

```json
"*** Begin Patch\n*** Update File: /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md\n@@\n-This spec proposes `scholar`, a new Cowork plugin that takes the Daisy artifact as inspiration only: it adopts the proven UX patterns (status / depth / digest / reading prompts / per-paper actions) and discards the constraint workarounds. It builds the system on a real backend (Bun + TypeScript MCP server, SQLite via Drizzle, sqlite-vec for embeddings, local Ollama for mechanical LLM work) and orchestrates the UI through `mcp-apps` views that compose with the vendored (unmodified) pdf MCP and the existing `sqlite3-mcp` and `nushell-mcp` servers already on the user's machine.\n+This spec proposes `scholar`, a new Cowork plugin that takes the Daisy artifact as inspiration only: it adopts the proven UX patterns (status / depth / digest / reading prompts / per-paper actions) and discards the constraint workarounds. It builds the system on a real backend (Bun + TypeScript MCP server, SQLite via Drizzle, sqlite-vec for embeddings, local Ollama for mechanical LLM work) and orchestrates the UI through `mcp-apps` views that compose with the vendored (unmodified) pdf MCP and the existing `nushell-mcp` server already on the user's machine.\n@@\n-5. **Persistence** — `bun:sqlite` + Drizzle ORM (`drizzle-orm/bun-sqlite`) with the `sqlite-vec` extension loaded for embedding columns. Schema migration is owned by scholar; ad-hoc query/inspect surfaces are delegated to `sqlite3-mcp` via `register_db`.\n+5. **Persistence** — `bun:sqlite` + Drizzle ORM (`drizzle-orm/bun-sqlite`) with the `sqlite-vec` extension loaded for embedding columns. Schema migration is owned by scholar; ad-hoc query/inspect surfaces are natively implemented as `scholar.query` and `scholar.inspect` (cycle 6.14 — added by a separate chore).\n@@\n-13. **Backup / distribution** — delegated to `sqlite3-mcp` (`configure_backup` → `backup_to_repo`, `pack_repo` / `unpack_from_git_ref`).\n+13. **Backup / distribution** — natively implemented as `scholar.backup` (VACUUM INTO; cycle 6.14 — added by a separate chore). Cross-host corpus distribution is a manual filesystem copy of `scholar-<corpus>.db` (see §14.2).\n@@\n-        ┌───────┴─────────┐    ┌───────────────────┐    ┌─────────────────┴────┐\n-        │  vendored:      │    │  sqlite3-mcp      │    │  Local services      │\n-        │  mcp-pdf-server │    │  (existing)       │    │  - Ollama (embeds +  │\n-        │  (child proc,   │    │  registers        │    │    chat)             │\n-        │   unmodified)   │    │  scholar DB       │    │                      │\n-        └─────────────────┘    └───────────────────┘    └──────────────────────┘\n-                │                       │                          │\n-                └───────────────────────┼──────────────────────────┘\n-                                        │\n+        ┌───────┴─────────┐                            ┌─────────────────┴────┐\n+        │  vendored:      │                            │  Local services      │\n+        │  mcp-pdf-server │                            │  - Ollama (embeds +  │\n+        │  (child proc,   │                            │    chat)             │\n+        │   unmodified)   │                            │                      │\n+        └─────────────────┘                            └──────────────────────┘\n+                │                                                  │\n+                └──────────────────────┬───────────────────────────┘\n+                                       │\n@@\n-| **sqlite3-mcp (already installed)** | Provides `query_database`, `inspect_database`, `table_schema`, `configure_backup`, `backup_to_repo`, `pack_repo`, `unpack_from_git_ref`. Scholar calls `register_db` once per corpus DB at activation. We do **not** reimplement query/backup tools. |\n@@\n-### 6.12 sqlite3-mcp registration integration\n-`register_db` on corpus activation (wired into `src/server/tools/corpus.ts`). The backup/distribution recipe is specified in §14.2; this cycle produces no separate doc file.\n-**Touches:** §5.5.\n-**Depends-on:** 6.1.\n-\n ### 6.13 Plugin build\n `scripts/build-plugin.ts` — the build orchestrator that assembles the `scholar.plugin` archive. The first-run PDF-root wizard is owned by cycle 6.3, not here.\n **Touches:** §5.36.\n@@\n-6. Registers itself with sqlite3-mcp by calling `mcp__sqlite3-mcp__register_db` once per corpus DB (best-effort; ignored if sqlite3-mcp is not running).\n-\n-All server-side initialization — first-run elicitation, corpus-open (steps 4 and 6), and pdf-child spawn (step 5) — is guarded by a single promise-memoized initializer per corpus, via `initOnce` from §12.0 keyed on the corpus id. Concurrent tool calls on a fresh install (e.g. the UI opening the dashboard while the model calls `corpus.list`) await one initialization rather than racing `runtime/config.json` writes, issuing duplicate `elicitInput` prompts, or double-spawning the pdf child. **Retry-on-reject semantics:** `initOnce` clears the slot when the factory rejects, so a transient failure (Ollama not yet up, vec0 binary momentarily inaccessible, user dismissed the first-run `elicitInput`) does not permanently break the corpus. Only errors the factory explicitly classifies as fatal (e.g., a permanent schema mismatch) are retained as stuck. **Manual escape hatch:** `scholar.corpus.reset-init` is exposed as a `[\"model\"]`-only tool that clears the init slot for a named corpus, used when an operator wants to force a re-init after fixing an environment issue without restarting the server.\n-7. Registers MCP tools and the UI resource (see §10 and §11).\n+All server-side initialization — first-run elicitation, corpus-open (step 4), and pdf-child spawn (step 5) — is guarded by a single promise-memoized initializer per corpus, via `initOnce` from §12.0 keyed on the corpus id. Concurrent tool calls on a fresh install (e.g. the UI opening the dashboard while the model calls `corpus.list`) await one initialization rather than racing `runtime/config.json` writes, issuing duplicate `elicitInput` prompts, or double-spawning the pdf child. **Retry-on-reject semantics:** `initOnce` clears the slot when the factory rejects, so a transient failure (Ollama not yet up, vec0 binary momentarily inaccessible, user dismissed the first-run `elicitInput`) does not permanently break the corpus. Only errors the factory explicitly classifies as fatal (e.g., a permanent schema mismatch) are retained as stuck. **Manual escape hatch:** `scholar.corpus.reset-init` is exposed as a `[\"model\"]`-only tool that clears the init slot for a named corpus, used when an operator wants to force a re-init after fixing an environment issue without restarting the server.\n+6. Registers MCP tools and the UI resource (see §10 and §11).\n@@\n-| 6 — sqlite3-mcp `register_db` | sqlite3-mcp not running, MCP connection refused, the tool rejecting the call. | Log through `ctx.log.warn` and continue. Re-attempted on every `scholar.corpus.activate` and `scholar.corpus.status` (Arch F4 + Integration F5) — both are idempotent against sqlite3-mcp, so retrying is safe. Loss of registration only degrades the model's ad-hoc-SQL surface, not any scholar tool. |\n-| 7 — tool registration | A `server.registerTool` rejection (duplicate name, schema validation), the resource registration failing. | Abort startup with a structured error to the host. This is a programmer error (a downstream plan introduced a duplicate or malformed schema) that no operator can fix at runtime; failing fast surfaces the bug instead of silently shipping a half-registered toolset. |\n+| 6 — tool registration | A `server.registerTool` rejection (duplicate name, schema validation), the resource registration failing. | Abort startup with a structured error to the host. This is a programmer error (a downstream plan introduced a duplicate or malformed schema) that no operator can fix at runtime; failing fast surfaces the bug instead of silently shipping a half-registered toolset. |\n@@\n-### 7.4 sqlite3-mcp integration\n-\n-Scholar treats sqlite3-mcp as a **complementary** service:\n-\n-| Need | Scholar implements | Delegated to sqlite3-mcp |\n-|---|---|---|\n-| Schema migrations | ✔ via Drizzle | — |\n-| Domain-specific reads/writes | ✔ as MCP tools | — |\n-| Ad-hoc SQL exploration | — | `query_database`, `inspect_database`, `table_schema`, `list_tables` |\n-| Backups | — | `configure_backup`, `backup_local`, `backup_to_repo`, `get_backup_config` |\n-| Distribution (corpus snapshots) | — | `pack_repo`, `pack_local`, `unpack_from_git_ref`, `unpack_from_tarball` |\n-| Cross-corpus copy | — | `copy_database` |\n-\n-When scholar opens a corpus, it calls `register_db` with that corpus's path under name `scholar:<corpus>`. When the user runs `/sqlite3-mcp query_database scholar:daisy \"SELECT count(*) FROM papers\"` they get the result without scholar mediating.\n-\n-**Lifecycle hooks against sqlite3-mcp (Integration F4).** The `register_db` call is one event in a larger lifecycle that scholar maintains symmetrically:\n-\n-| Scholar event | sqlite3-mcp action | Notes |\n-|---|---|---|\n-| `scholar.corpus.create` | `register_db` under `scholar:<id>` | Wrapped in the same `initOnce` slot as the corpus-open path so a first-run failure doesn't permanently break the corpus. |\n-| `scholar.corpus.activate` | `register_db` (idempotent retry) | Re-attempted on every activate so a sqlite3-mcp restart re-establishes the binding without a scholar restart. Also re-attempted as a side effect of `scholar.corpus.status` so the operator can force-heal by polling status (Arch F4 + Integration F5). |\n-| `scholar.corpus.archive` (sets `corpora.archived_at`) | `unregister_db scholar:<id>` if the API exposes it; otherwise log + skip and surface the stale entry through `scholar.corpus.status` | Verified at cycle 6.12 against the live sqlite3-mcp version; the table-row above records the contract scholar depends on. |\n-| Corpus delete (physical removal — no v1 caller; documented for v2) | `unregister_db scholar:<id>` then `bun.unlink` the .db file | Order matters: unregister first so sqlite3-mcp doesn't try to hand out a soon-deleted DB. |\n-| Corpus rename | `register_db scholar:<new-name>` then `unregister_db scholar:<old-name>` | New first, old second, so an interrupted rename leaves both names pointing at the live file rather than neither. |\n-\n-**Joint-ownership write discipline (Open Q2 / Integration F6).** Scholar's per-corpus DB is jointly owned: scholar holds the schema, caches, and reconciler state, but sqlite3-mcp's `query_database` exposes raw SQL to the model. Two access surfaces operate against the same file with different semantics:\n-\n-- **`bun:sqlite` (scholar code)** — the only path that maintains scholar's invariants. All writes from inside scholar's own tool handlers go through Drizzle on `bun:sqlite`. The transaction boundaries from §11 and §13 hold here.\n-- **`sqlite3-mcp.query_database` (model ad-hoc)** — bypasses every scholar invariant. A `DELETE FROM paper_chunks` issued through this path silently desyncs `chunk_vec` (no FK cascade), drops the §13 reconciler's view of paper history, and invalidates any digest whose `scope_signature` covered the removed rows. The model has no awareness of which writes are safe.\n-\n-This is **not** an opportunity to swap to a `bun:sqlite`-native alternative — the two paths serve different roles. `bun:sqlite` is a Bun runtime API only scholar's TypeScript can call; `sqlite3-mcp` exposes MCP tools the model invokes from chat. Dropping `sqlite3-mcp` would remove the model's ad-hoc query surface, which is plan 1.2's deliverable.\n-\n-v1 discipline:\n-\n-1. Scholar documents the joint-ownership semantics in the `scholar.corpus.status` output and in any operator-facing message that references sqlite3-mcp by name — including a one-line warning that destructive SQL via `query_database` can desync caches.\n-2. The skill `skills/scholar-workflow/SKILL.md` (cycle 6.10) carries the model-facing version of the same warning: **SELECT-only against `scholar:*` DBs unless you've read the schema and understand which caches your write disturbs.**\n-3. v2 candidates recorded in §16: investigate whether sqlite3-mcp exposes a read-only registration mode that scholar could prefer when the operator hasn't opted into write access, and whether scholar can subscribe to sqlite3-mcp write events to invalidate caches reactively.\n+### 7.4 Native query / backup / inspect surfaces\n+\n+Scholar implements query, backup, and inspect surfaces natively (no external delegation):\n+\n+| Need | Scholar tool | Implementation |\n+|---|---|---|\n+| Schema migrations | — | Drizzle (§7.3 step 4) |\n+| Domain-specific reads/writes | scholar.papers.*, scholar.annotations.*, etc. | Tool modules under `src/server/tools/` |\n+| Ad-hoc SQL exploration | `scholar.query` (cycle 6.14) | `bun:sqlite` direct `prepare`/`run`; BEGIN/ROLLBACK gate on write-intent |\n+| Schema/table inspection | `scholar.inspect` (cycle 6.14) | `bun:sqlite` `sqlite_master` reads; no-args structured response |\n+| Backups | `scholar.backup` (cycle 6.14) | SQLite `VACUUM INTO` sole implementation |\n+| Cross-host corpus distribution | (manual) | Filesystem copy of `scholar-<corpus>.db` (see §14.2) |\n+\n+The earlier sqlite3-mcp-delegation plan (Sessions 1–3) is retired (user ruling 2026-05-24): the upstream sqlite3-mcp is a Python/uv FastMCP server and is unvendorable for the scholar plugin's `bun build --compile` single-file distribution model. The new tools are added by cycle 6.14 (added by a separate chore: `amend-spec-add-cycle-6.14`).\n@@\n-- The user can later distribute a *corpus* (not the plugin itself) via sqlite3-mcp's `pack_repo` against `scholar-<corpus>.db`, producing a git ref another user can `unpack_from_git_ref` into their scholar installation.\n+- The user can later distribute a *corpus* (not the plugin itself) via filesystem copy of the per-corpus `scholar-<corpus>.db` file; the recipient drops it into their `runtime/dbs/` directory and registers it via `scholar.corpus.create` with the existing file path.\n@@\n-- sqlite3-mcp integration → **delegate query/backup/pack** surfaces to it via `register_db`.\n+- Query / backup / inspect surfaces → **native** (`scholar.query`, `scholar.backup`, `scholar.inspect`; cycle 6.14). sqlite3-mcp **not used** — its upstream is a Python/uv FastMCP server and is unvendorable for the scholar plugin's `bun build --compile` single-file distribution (user ruling 2026-05-24).\n*** End Patch\n"
```

</details>

```
Modified 1 file(s): /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md
```


---

<sub>⏱️ 1m 15s</sub>

### ✅ `bash`

**Show diff stat for spec file**

$ git --no-pager diff --stat docs/superpowers/specs/2026-05-22-scholar-plugin-design.md

```
docs/superpowers/specs/2026-05-22-scholar-plugin-design.md | 86 +++++++++++++++++-------------------------------------
 1 file changed, 27 insertions(+), 59 deletions(-)
<exited with exit code 0>
```


---

<sub>⏱️ 1m 14s</sub>

### ✅ `rg`

**sqlite3-mcp registration integration|Registers itself with sqlite3-mcp|### 7\.4 sqlite3-mcp integration|pack_repo|delegate query/backup/pack**

"sqlite3-mcp registration integration|Registers itself with sqlite3-mcp|### 7\.4 sqlite3-mcp integration|pack_repo|delegate query/backup/pack" (docs/superpowers/specs/2026-05-22-scholar-plugin-design.md)

```
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:193:3. **Plugin-upgrade compatibility guard.** Before replaying migrations the runner reads `__drizzle_migrations` (Drizzle's own bookkeeping table). If `MAX(id)` recorded in the DB exceeds the number of migrations in the bundled journal, the DB was written by a newer plugin version; the runner aborts the open with `DbFromNewerPluginError`, surfacing the remediation "downgrade the plugin or run `scholar.corpus.export` to extract the data via `pack_repo`". A `scholar.corpus.export` model-only tool (registered in §10) is the schema-version-agnostic escape hatch — it produces a `pack_repo`-style tarball without going through Drizzle, so a newer-schema DB can always be evacuated regardless of which migrations the host plugin knows about.
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:937:| `scholar.corpus.export` | model | Pack the active corpus's per-corpus DB into a `pack_repo`-style tarball without going through Drizzle, so a newer-schema DB can be evacuated regardless of which migrations the host plugin knows about (F11(d) escape hatch — see §5.3). | — |
```


---

<sub>⏱️ 1m 26s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 14-45)

<details>
<summary>32 lines</summary>

```
14. - **No vector layer** means search is limited to literal substring matching.
15. - **Single-corpus by design** because the papers bundle is embedded into the HTML at build time.
16. - **No ingestion pipeline** because there is no file watcher and no metadata API integration.
17. 
18. This spec proposes `scholar`, a new Cowork plugin that takes the Daisy artifact as inspiration only: it adopts the proven UX patterns (status / depth / digest / reading prompts / per-paper actions) and discards the constraint workarounds. It builds the system on a real backend (Bun + TypeScript MCP server, SQLite via Drizzle, sqlite-vec for embeddings, local Ollama for mechanical LLM work) and orchestrates the UI through `mcp-apps` views that compose with the vendored (unmodified) pdf MCP and the existing `nushell-mcp` server already on the user's machine.
19. 
20. The plugin is explicitly **not** a port of the Daisy artifact. It is a clean reimplementation informed by the artifact's feature catalogue.
21. 
22. ## 2. Scope
23. 
24. ### In scope (v1)
25. 
26. 1. **Plugin packaging** — installable `.plugin` archive with `.claude-plugin/plugin.json`, `.mcp.json`, bundled servers, skills, slash commands, and an MCP App UI bundle.
27. 2. **Vendored pdf MCP server (unmodified)** — `@modelcontextprotocol/server-pdf@1.7.2` shipped as-is under `src/vendor/pdf-server/`. Runtime multi-root management is delivered by scholar's MCP client side responding to `roots/list` and emitting `notifications/roots/list_changed` (§7.2) — no source patch.
28. 3. **Scholar MCP server** — Bun + TypeScript, exposes corpus management, ingestion, annotation, digest, reading-prompts, and UI-resource tools. Owns the SQLite database.
29. 4. **Multi-corpus support** — named corpora with isolated SQLite DBs and per-corpus PDF roots. Add/remove/switch corpora at runtime.
30. 5. **Persistence** — `bun:sqlite` + Drizzle ORM (`drizzle-orm/bun-sqlite`) with the `sqlite-vec` extension loaded for embedding columns. Schema migration is owned by scholar; ad-hoc query/inspect surfaces are natively implemented as `scholar.query` and `scholar.inspect` (cycle 6.14 — added by a separate chore).
31. 6. **Ingestion** — three paths:
32.     - BibTeX / RIS file import (BibTeX via `@retorquere/bibtex-parser`; RIS via the in-house adapter in `src/server/ingest/bibtex.ts`).
33.     - CrossRef DOI lookup (no auth, free).
34.     - arXiv abstract API ingest (no auth, free).
35.     Manual entry (single-paper form) is the fallback.
36. 7. **Semantic search** — `sqlite-vec` index over paper title + abstract + extracted text chunks; embeddings produced via local Ollama (`nomic-embed-text:v1.5` default tag; user-pluggable).
37. 8. **Annotation surface** — schema-compatible with the Daisy round-trip (`{ id, page?, anchor?, body, created_at, updated_at, source }`); round-trips with the child pdf MCP (scholar→viewer push, viewer→scholar reconcile-on-read — see §13).
38. 9. **Synthesis / digest / reading prompts** — local Ollama by default (Qwen-class chat model, user-pluggable). Escape hatch to `cowork.askClaude` for high-stakes synthesis where the user explicitly opts in.
39. 10. **Reading queue** — simple priority queue (manual `priority` integer + computed staleness signals); no FSRS in v1.
40. 11. **MCP App view surfaces (5)** — corpus dashboard, paper detail, digest panel, reading prompts pane, reader progress (charts).
41. 12. **Nushell user CLI** — `scholar` nu module (`use scholar.nu *`) with `scholar list`, `scholar status`, `scholar ingest`, `scholar query`, `scholar digest`. Pure UX surface — delegates to scholar MCP via `mcp__nushell__nu_run` style invocations of the MCP CLI client. **No internal logic in nu.**
42. 13. **Backup / distribution** — natively implemented as `scholar.backup` (VACUUM INTO; cycle 6.14 — added by a separate chore). Cross-host corpus distribution is a manual filesystem copy of `scholar-<corpus>.db` (see §14.2).
43. 
44. ### Out of scope (v1, candidates for v2+)
45.
```

</details>


---

<sub>⏱️ 1m 26s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 90-120)

<details>
<summary>31 lines</summary>

````
90.                 ┌──────────────────────────────────────────────────┴───────┐
91.                 │                                                          │
92.         ┌───────┴─────────┐                            ┌─────────────────┴────┐
93.         │  vendored:      │                            │  Local services      │
94.         │  mcp-pdf-server │                            │  - Ollama (embeds +  │
95.         │  (child proc,   │                            │    chat)             │
96.         │   unmodified)   │                            │                      │
97.         └─────────────────┘                            └──────────────────────┘
98.                 │                                                  │
99.                 └──────────────────────┬───────────────────────────┘
100.                                        │
101.                                 ┌───────┴────────┐
102.                                 │  SQLite DB     │
103.                                 │  + sqlite-vec  │
104.                                 │  (per corpus)  │
105.                                 └────────────────┘
106. ```
107. 
108. ### Component responsibilities
109. 
110. | Component | Responsibility |
111. |---|---|
112. | **scholar MCP server (this plugin's core)** | Owns the SQLite schema (Drizzle-managed migrations). Exposes corpus, ingestion, annotation, digest, prompt, search, and UI-resource tools. Spawns and supervises the vendored pdf MCP as a child process; acts as the MCP client for that session, answering `roots/list` requests with the active corpus's PDF roots. |
113. | **vendored mcp-pdf-server (unmodified)** | `@modelcontextprotocol/server-pdf@1.7.2` shipped as-is in `src/vendor/pdf-server/`. Receives root paths through MCP `roots/list` (it asks; scholar answers) and re-asks on `notifications/roots/list_changed` — no subprocess respawn for root changes. |
114. | **Ollama (local)** | Embedding production (`nomic-embed-text:v1.5` default tag), digest/synthesis chat (`qwen3:8b` default tag), reading-prompts. Scholar discovers running Ollama via `http://127.0.0.1:11434/api/tags` and falls back to a queue if Ollama is offline. |
115. | **scholar.nu module** | User-facing thin CLI wrapper. `use scholar.nu *` then `scholar status --corpus daisy` etc. Each command does one MCP call and shapes the response into nu tables. |
116. | **scholar UI bundle** | Single-file HTML produced by **Bun's HTML bundler** (`bun build ./src/ui/index.html --target=browser`, which inlines JS, CSS, and assets without a separate `vite-plugin-singlefile` step); React. Five views routed by tool input. Reads from scholar MCP via `app.callServerTool`. Composes with the pdf MCP for paper-detail rendering. |
117. | **nushell-mcp (already installed)** | Used as a generic command runner if scholar needs to invoke external scripts (e.g., the `bibtex-tidy` CLI already on the user's PATH). Not load-bearing. |
118. 
119. ## 5. Project Layout
120.
````

</details>


---

<sub>⏱️ 1m 26s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 396-414)

<details>
<summary>19 lines</summary>

````
396. `scholar.snapshot.take` and the delta-digest computation that diffs against the most recent snapshot.
397. **Touches:** §5.13.
398. **Depends-on:** 6.1.
399. 
400. ### 6.13 Plugin build
401. `scripts/build-plugin.ts` — the build orchestrator that assembles the `scholar.plugin` archive. The first-run PDF-root wizard is owned by cycle 6.3, not here.
402. **Touches:** §5.36.
403. **Depends-on:** 6.9, 6.10.
404. 
405. ## 7. Plugin Manifest and MCP Server Design
406. 
407. ### 7.1 Plugin manifest
408. 
409. `.claude-plugin/plugin.json`:
410. ```json
411. {
412.   "name": "scholar",
413.   "version": "0.1.0",
414.   "description": "Literature review workspace. Multi-corpus reading, annotation, semantic search, Ollama-powered syntheses, and a vendored pdf MCP. Inspired by but independent of the Daisy Lit Review artifact.",
````

</details>


---

<sub>⏱️ 1m 26s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 492-515)

<details>
<summary>24 lines</summary>

```
492. 6. Registers MCP tools and the UI resource (see §10 and §11).
493. 
494. **Per-step failure-recovery posture (Arch F13).** Each step has a documented degradation behaviour rather than a uniform "abort startup" stance — steps 4–6 can fail transiently and scholar must keep the operator's options open:
495. 
496. | Step | Failure mode | Recovery posture |
497. |---|---|---|
498. | 4 — migrations + raw-ddl | A Drizzle migration that already ran in part, a vec0 load failure, a partial `chunk_vec` materialization. | Idempotent. `IF NOT EXISTS` covers raw DDL; Drizzle migrations are content-addressed and self-heal on retry. The `initOnce` retry-on-reject semantics above re-drive the factory; an operator who fixed the underlying issue (e.g., pulled the embed model) re-triggers via any corpus tool call. |
499. | 5 — pdf-child spawn | Spawn `EACCES`, missing `build/runtime/bun` (pipeline regression), the Job Object FFI binding (Windows) failing to load, or the child crashing during the initial handshake. | Degrade — do not abort the corpus open. Scholar publishes a typed `PDF_CHILD_UNAVAILABLE` error from every `pdf.*` proxy call; `corpus.*`, `papers.search` (lexical), `digest.*`, and `prompts.*` continue to work. The lifecycle module supervises with exponential backoff (1s, 2s, 4s, 8s, capped at 30s) and clears the error once a spawn succeeds. |
500. | 6 — tool registration | A `server.registerTool` rejection (duplicate name, schema validation), the resource registration failing. | Abort startup with a structured error to the host. This is a programmer error (a downstream plan introduced a duplicate or malformed schema) that no operator can fix at runtime; failing fast surfaces the bug instead of silently shipping a half-registered toolset. |
501. 
502. ### 7.4 Native query / backup / inspect surfaces
503. 
504. Scholar implements query, backup, and inspect surfaces natively (no external delegation):
505. 
506. | Need | Scholar tool | Implementation |
507. |---|---|---|
508. | Schema migrations | — | Drizzle (§7.3 step 4) |
509. | Domain-specific reads/writes | scholar.papers.*, scholar.annotations.*, etc. | Tool modules under `src/server/tools/` |
510. | Ad-hoc SQL exploration | `scholar.query` (cycle 6.14) | `bun:sqlite` direct `prepare`/`run`; BEGIN/ROLLBACK gate on write-intent |
511. | Schema/table inspection | `scholar.inspect` (cycle 6.14) | `bun:sqlite` `sqlite_master` reads; no-args structured response |
512. | Backups | `scholar.backup` (cycle 6.14) | SQLite `VACUUM INTO` sole implementation |
513. | Cross-host corpus distribution | (manual) | Filesystem copy of `scholar-<corpus>.db` (see §14.2) |
514. 
515. The earlier sqlite3-mcp-delegation plan (Sessions 1–3) is retired (user ruling 2026-05-24): the upstream sqlite3-mcp is a Python/uv FastMCP server and is unvendorable for the scholar plugin's `bun build --compile` single-file distribution model. The new tools are added by cycle 6.14 (added by a separate chore: `amend-spec-add-cycle-6.14`).
```

</details>


---

<sub>⏱️ 1m 26s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 511-545)

<details>
<summary>35 lines</summary>

````
511. | Schema/table inspection | `scholar.inspect` (cycle 6.14) | `bun:sqlite` `sqlite_master` reads; no-args structured response |
512. | Backups | `scholar.backup` (cycle 6.14) | SQLite `VACUUM INTO` sole implementation |
513. | Cross-host corpus distribution | (manual) | Filesystem copy of `scholar-<corpus>.db` (see §14.2) |
514. 
515. The earlier sqlite3-mcp-delegation plan (Sessions 1–3) is retired (user ruling 2026-05-24): the upstream sqlite3-mcp is a Python/uv FastMCP server and is unvendorable for the scholar plugin's `bun build --compile` single-file distribution model. The new tools are added by cycle 6.14 (added by a separate chore: `amend-spec-add-cycle-6.14`).
516. 
517. ### 7.5 Nushell module
518. 
519. `nu/scholar.nu` exports user-facing commands. All commands shell out to the scholar MCP via a small `nu_invoke` helper that wraps the official MCP client CLI invoked as a child process. **Transport is decided: the MCP client CLI** — the named-pipe alternative considered earlier is dropped. One example:
520. 
521. ```nu
522. export def main [] { scholar status }
523. 
524. export def status [
525.   --corpus(-c): string  # corpus name; defaults to active
526. ] {
527.   let payload = {tool: "corpus.status", args: {corpus: $corpus}}
528.   $payload | to json | nu_invoke | from json | get papers | sort-by status
529. }
530. ```
531. 
532. This file is purely user ergonomics. No business logic. The `nu-fluency` skills (`nushell-idioms`, `nushell-records`) inform style; the `nu-audit` hook keeps it idiomatic.
533. 
534. ### 7.6 Module skeleton and shared contracts
535. 
536. To keep the seven plans' blast-radii content-disjoint — and therefore the `worktree="not-required"` decision in the splits file sound rather than aspirational — cycle 6.1 (`foundation`) scaffolds the entire compile-able module skeleton, and **every cross-plan contract is pinned in this section** so no later plan needs to edit a foundation-owned file.
537. 
538. **Scaffolding (cycle 6.1).** Foundation creates, as no-op stubs, every file that `src/server/index.ts`, `src/server/tools/registry.ts`, or `src/server/db/migrations.ts` transitively imports but whose *body* it does not own:
539. 
540. - `src/server/tools/registry.ts` — the tool-registration barrel (foundation content). Statically imports all nine tool stubs and exposes `registerAll(server, ctx)`.
541. - A stub for each of the nine tool modules: `corpus.ts`, `roots.ts`, `snapshot.ts`, `ingest.ts`, `pdf.ts`, `papers.ts`, `digest.ts`, `prompts.ts`, `annotations.ts`. Each exports `registerTools` (signature below) with an empty body.
542. - `src/server/db/raw-ddl.ts` — a stub exporting `runRawDdl` (signature below) with an empty body.
543. 
544. Each stub compiles immediately, so `registry.ts`, `index.ts`, and `migrations.ts` typecheck at cycle 6.1 before any downstream plan runs. A downstream plan **fills the body** of its own stub(s) only; it never edits `registry.ts`, `index.ts`, `migrations.ts`, or a sibling's file. The splits-file blast-radii denote *content ownership* (who fills a body), not file creation; foundation's wave-0 stub creation is strictly ordered before any fill, so no two plans ever modify the same file's content. The one concurrent wave (wave 2 — `ingest`, `extraction`, `annotations`) is content-disjoint.
545.
````

</details>


---

<sub>⏱️ 1m 26s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 1324-1332)

<details>
<summary>9 lines</summary>

```
1324. - Metadata sources → **CrossRef + arXiv + BibTeX/RIS**. (No Semantic Scholar, no OpenAlex.)
1325. - Reading queue → **simple priority** (no FSRS).
1326. - Semantic search → **sqlite-vec + local Ollama**.
1327. - Nushell wiring → **user-facing CLI only**.
1328. - PDF root default → **prompt at install** with `%USERPROFILE%/mcp-data/literature/` as the suggested override path.
1329. - Mechanical LLM work → **Ollama by default**; `cowork.askClaude` is opt-in only.
1330. - pdf MCP → **bundled unmodified vendor of v1.7.2** (`@modelcontextprotocol/server-pdf@1.7.2` `dist/` shipped as-is under `src/vendor/pdf-server/`). Root injection rides the MCP `roots/list` protocol — scholar's MCP client advertises `capabilities.roots.listChanged` and serves `ListRootsRequestSchema` from the active corpus's `pdf_roots` rows; `notifications/roots/list_changed` fires on root mutation, no subprocess respawn. The earlier "two-line patch + `MCP_PDF_CLIENT_ROOTS_PATHS` env var" plan is retired (Session 3 / Integration F2/F3) — the patch existed only because scholar wasn't holding up its client-side end of the protocol.
1331. - Query / backup / inspect surfaces → **native** (`scholar.query`, `scholar.backup`, `scholar.inspect`; cycle 6.14). sqlite3-mcp **not used** — its upstream is a Python/uv FastMCP server and is unvendorable for the scholar plugin's `bun build --compile` single-file distribution (user ruling 2026-05-24).
1332. - Tool wiring → **registry barrel + foundation-scaffolded stubs** (§7.6) so the seven plans' blast-radii stay file-disjoint.
```

</details>


---

<sub>⏱️ 1m 26s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 1358-1365)

```
1358. 
1359. End of spec. Hand off to `spec-pipeline:spec-pipeline` for `spec-to-multi-plan` synthesis.
1360. 
```


---

<sub>⏱️ 1m 30s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 486-495)

<details>
<summary>10 lines</summary>

```
486. 1. Resolves `SCHOLAR_RUNTIME_ROOT`, ensures `runtime/dbs/` exists.
487. 2. Reads `runtime/config.json` (corpora list, active corpus, default PDF root, Ollama model overrides).
488. 3. First-run handling is **not** done at startup. When a corpus tool (`scholar.corpus.list` / `scholar.corpus.activate`) runs and finds no corpus configured, it calls the first-run routine in `scripts/first-run.ts`, which uses the live MCP session's `elicitInput` request to ask the host for the initial PDF root, then drives `scholar.corpus.create` with the elicited path as `initial_pdf_root`. The wizard writes (a) `runtime/config.json` for the active-corpus pointer and (b) the cross-DB `corpora` row plus a `pdf_roots` row with `is_default = true` (the latter is the canonical location of the default root — `corpora` no longer carries a `pdf_root` column, per §8.1 / Data F18). `first-run.ts` is a module imported by `src/server/tools/corpus.ts` (both `corpus`-plan owned) — not a standalone executable.
489. 4. Opens the active corpus's `scholar-<corpus>.db` via `bun:sqlite` wrapped by `drizzle-orm/bun-sqlite` (through `openWithPragmas` from §5.3, so `PRAGMA foreign_keys = ON` is set before any other SQL), loads the `sqlite-vec` extension, runs Drizzle migrations, then re-probes the embed dimension via `loadVecAndProbeDim` from §12.0 and compares against the persisted `settings.embed.{model,dim}` row written at corpus creation (§5.5) — a mismatch surfaces the "drop `chunk_vec` and re-embed" remediation rather than failing at insert time. Finally calls `runRawDdl(db)` (§7.6) to create the `reading_queue` view unconditionally, and the `chunk_vec` virtual table only when the embed dimension is known (either persisted from create-time or freshly probed at open). When `chunk_vec` does not yet exist (Ollama was offline at corpus creation and is still offline now), semantic-search code paths gate on its presence and degrade to lexical-only with a "still indexing" pill, exactly as for partially-embedded chunks. After the open succeeds, the corpus-open initializer also writes `corpora.last_opened_at = nowIso()` to the config DB — consumed by `scholar.corpus.status` (§10). (Deferred until a corpus is active.)
490. 5. Spawns the pdf child with the active corpus's roots. (Deferred until a corpus is active.)
491. All server-side initialization — first-run elicitation, corpus-open (step 4), and pdf-child spawn (step 5) — is guarded by a single promise-memoized initializer per corpus, via `initOnce` from §12.0 keyed on the corpus id. Concurrent tool calls on a fresh install (e.g. the UI opening the dashboard while the model calls `corpus.list`) await one initialization rather than racing `runtime/config.json` writes, issuing duplicate `elicitInput` prompts, or double-spawning the pdf child. **Retry-on-reject semantics:** `initOnce` clears the slot when the factory rejects, so a transient failure (Ollama not yet up, vec0 binary momentarily inaccessible, user dismissed the first-run `elicitInput`) does not permanently break the corpus. Only errors the factory explicitly classifies as fatal (e.g., a permanent schema mismatch) are retained as stuck. **Manual escape hatch:** `scholar.corpus.reset-init` is exposed as a `["model"]`-only tool that clears the init slot for a named corpus, used when an operator wants to force a re-init after fixing an environment issue without restarting the server.
492. 6. Registers MCP tools and the UI resource (see §10 and §11).
493. 
494. **Per-step failure-recovery posture (Arch F13).** Each step has a documented degradation behaviour rather than a uniform "abort startup" stance — steps 4–6 can fail transiently and scholar must keep the operator's options open:
495.
```

</details>


---

<sub>⏱️ 1m 33s</sub>

### ✅ `rg`

**The user can later distribute a \*corpus\*|filesystem copy of the per-corpus**

"The user can later distribute a \*corpus\*|filesystem copy of the per-corpus" (docs/superpowers/specs/2026-05-22-scholar-plugin-design.md)

```
/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:1297:- The user can later distribute a *corpus* (not the plugin itself) via filesystem copy of the per-corpus `scholar-<corpus>.db` file; the recipient drops it into their `runtime/dbs/` directory and registers it via `scholar.corpus.create` with the existing file path.
```


---

<sub>⏱️ 1m 46s</sub>

### 💬 Copilot

Edits are in place; I’m staging the spec file, creating the commit message file, committing, and then capturing the SHA.

---

<sub>⏱️ 1m 47s</sub>

### ✅ `bash`

**Stage spec, write commit msg, commit, and print SHA**

$ git add docs/superpowers/specs/2026-05-22-scholar-plugin-design.md && cat > /tmp/commit_msg_amend-spec-drop-sqlite3-mcp.txt <<'EOF'
spec(amend): drop sqlite3-mcp delegation (posture-B)

Remove sqlite3-mcp from spec §1, §3, §4, §6.12 (deleted), §7.3,
§7.4 (rewritten as Native query/backup/inspect surfaces),
§14.2, §17. Forward-reference cycle 6.14 (added by a separate
chore: amend-spec-add-cycle-6.14) for the native query/backup/
inspect tools. Driver: user ruling 2026-05-24 — upstream
sqlite3-mcp is Python/uv FastMCP and is unvendorable for
scholar's bun --compile single-file distribution.

Closes chore: amend-spec-drop-sqlite3-mcp.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
EOF
git commit -F /tmp/commit_msg_amend-spec-drop-sqlite3-mcp.txt && git rev-parse HEAD

```
[ingest/2026-05-22-scholar-plugin 60d7f4e] spec(amend): drop sqlite3-mcp delegation (posture-B)
 1 file changed, 27 insertions(+), 59 deletions(-)
60d7f4e623eabdd8b4436d117e1341956266e037
<exited with exit code 0>
```


---

<sub>⏱️ 1m 54s</sub>

### ✅ `task_complete`

**Completed. I applied all 12 scoped edits in `docs/superpo...**

<details>
<summary>Arguments</summary>

```json
{
  "summary": "Completed. I applied all 12 scoped edits in `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` only, including removing sqlite3-mcp delegation references, deleting §6.12, renumbering §7.3 steps/table entries, replacing §7.4 with the new native query/backup/inspect subsection, updating §14.2 distribution text, and updating the §17 decision-log bullet. I also removed the sqlite3-mcp box/row from the §4 architecture diagram/table while preserving diagram connectivity.\n\nCommitted on branch `ingest/2026-05-22-scholar-plugin` with the requested message (plus required co-author trailer).\n\nWORK_COMMIT_SHA=60d7f4e623eabdd8b4436d117e1341956266e037"
}
```

</details>

```
Completed. I applied all 12 scoped edits in `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` only, including removing sqlite3-mcp delegation references, deleting §6.12, renumbering §7.3 steps/table entries, replacing §7.4 with the new native query/backup/inspect subsection, updating §14.2 distribution text, and updating the §17 decision-log bullet. I also removed the sqlite3-mcp box/row from the §4 architecture diagram/table while preserving diagram connectivity.

Committed on branch `ingest/2026-05-22-scholar-plugin` with the requested message (plus required co-author trailer).

WORK_COMMIT_SHA=60d7f4e623eabdd8b4436d117e1341956266e037
```


---

<sub>⏱️ 1m 54s</sub>

### ✓ Task Complete

Completed. I applied all 12 scoped edits in `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` only, including removing sqlite3-mcp delegation references, deleting §6.12, renumbering §7.3 steps/table entries, replacing §7.4 with the new native query/backup/inspect subsection, updating §14.2 distribution text, and updating the §17 decision-log bullet. I also removed the sqlite3-mcp box/row from the §4 architecture diagram/table while preserving diagram connectivity.

Committed on branch `ingest/2026-05-22-scholar-plugin` with the requested message (plus required co-author trailer).

WORK_COMMIT_SHA=60d7f4e623eabdd8b4436d117e1341956266e037

---

<sub>Generated by [GitHub Copilot CLI](https://github.com/features/copilot/cli)</sub>

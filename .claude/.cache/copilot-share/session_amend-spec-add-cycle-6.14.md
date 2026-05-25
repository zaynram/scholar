# 🤖 Copilot CLI Session

> [!NOTE]
> - **Session ID:** `43b6628c-f7aa-431f-9d8c-0c50bceb9ce4`  
> - **Started:** 5/24/2026, 9:30:21 PM  
> - **Duration:** 1m 52s  
> - **Exported:** 5/24/2026, 9:32:14 PM  

---

<sub>⏱️ 1s</sub>

### 👤 User

# Chore: amend-spec-add-cycle-6.14

## Dispatch header
- chore-id: amend-spec-add-cycle-6.14
- vehicle: copilot-cli (simple-chore via spec-pipeline)
- model: gpt-5-mini
- tier: mechanical
- tier rationale: Insert one new cycle section at a well-defined location with verbatim text supplied below. Single-section append; no judgment required on phrasing — the dispatch prompt provides the exact replacement text. Per spec-pipeline taxonomy, mechanical-tier simple-chores route to gpt-5-mini (0x cost).
- blast-radius: docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (ONLY this file)
- working dir: /home/ramda/code/scholar (same-repo)
- branch: ingest/2026-05-22-scholar-plugin (do NOT create a new branch)

## Context
The user-ratified posture B (2026-05-24) replaces the dropped sqlite3-mcp delegation with three first-party scholar tools: `scholar.query`, `scholar.inspect`, `scholar.backup`. These tools live in a new spec cycle 6.14. The companion chore `amend-spec-drop-sqlite3-mcp` has already deleted §6.12 (cycle obsolete post-pivot), so the current §6 sequence reads 6.11 → 6.13. This chore inserts §6.14 after §6.13.

The canonical narrative for cycle 6.14 lives verbatim in `docs/superpowers/plans/2026-05-22-scholar-plugin-extraction.md` lines 1878–1903 (the cycle header + intro + sub-cycle ordering). For the spec, condense that into the standard §6-cycle format used elsewhere in §6 (single paragraph + Touches + Depends-on lines).

## Scope: exactly this one edit

### EDIT — Insert §6.14 immediately after the existing §6.13 block
Find the end of the §6.13 block in `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md`. The §6.13 block looks like:

```
### 6.13 Plugin build
`scripts/build-plugin.ts` — the build orchestrator that assembles the `scholar.plugin` archive. The first-run PDF-root wizard is owned by cycle 6.3, not here.
**Touches:** §5.36.
**Depends-on:** 6.9, 6.10.
```

Immediately after the last line of §6.13's body (the `**Depends-on:** 6.9, 6.10.` line) and BEFORE the next section heading (`## 7. Plugin Manifest and MCP Server Design`), INSERT the following text — first an empty line, then the new §6.14 cycle block:

```

### 6.14 First-party SQL/backup/inspect surface
Fills the three foundation-scaffolded stubs `src/server/tools/{query,backup,inspect}.ts` with first-party implementations using `bun:sqlite` directly. `scholar.query` exposes multi-query batch execution via prepared statements with parameter binding (no string interpolation) and a BEGIN/ROLLBACK engine-gate for write-intent classification — a `sqlite_master` escape hatch is intentionally permitted so power users can introspect schema via the same surface. `scholar.inspect` is a no-args structured dump of `sqlite_master` table list plus per-table schemas. `scholar.backup` is a WAL-safe online backup whose sole implementation is SQLite's `VACUUM INTO` against a path resolved via §12.0 `resolveUnderRoot(backupRoot, args.dest)` (path-traversal payloads cannot escape the configured backup root). The §10 tool-surface table is updated by the same cycle to add the three new entries. Driver: user-ratified posture B (2026-05-24) — scholar drops the unvendorable Python sqlite3-mcp child and reimplements query/backup/inspect natively.
**Touches:** §5.41, §10, §12.0.
**Depends-on:** 6.1, 6.3.
```

CRITICAL formatting notes:
- The blank line BEFORE `### 6.14` is required (matches the spacing between every other §6.N cycle in the file).
- The `**Touches:**` and `**Depends-on:**` lines use the same `**bold-label**` format every other §6.N cycle uses — verify by reading §6.11, §6.12 (if still present — note chore 1 should have removed it), and §6.13.
- Do NOT add a trailing blank line after the §6.14 block before `## 7.` — match the existing spacing where §6.13 leads into §7 with exactly one blank line.

## What is OUT OF SCOPE for this chore
- DO NOT add new tool entries to §10's tool surface table. (Separate work; §6.14's body mentions §10 is updated by the same cycle but that's documentation of WHAT the cycle does in the implementation phase, not work for THIS chore. THIS chore only adds the §6.14 cycle definition; the §10 table edits land later.)
- DO NOT edit §6.12 (it should already be deleted by chore 1; verify it's absent — if it's still there, ABORT).
- DO NOT edit any other §6.N cycle.
- DO NOT touch any file under `src/`, `tests/`, `scripts/`, `nu/`, `.github/`, `.claude-plugin/`, or `docs/superpowers/plans/`.
- DO NOT edit `.claude/context/plans.xml`, `.claude/context/chores.xml`, splits.xml, sequence.xml.

## Output: commit conventions
After applying the edit:

1. Verify: `git diff --stat docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` — expect ONE file changed, net +5 lines (a 5-line block inserted plus surrounding spacing).

2. Stage: `git add docs/superpowers/specs/2026-05-22-scholar-plugin-design.md`

3. Write commit message to `/tmp/commit_msg_amend-spec-add-cycle-6.14.txt`:
   ```
   spec(amend): add cycle 6.14 — first-party SQL/backup/inspect surface

   Insert §6.14 between §6.13 and §7. Cycle 6.14 owns the bodies of
   src/server/tools/{query,backup,inspect}.ts (foundation scaffolds
   the stubs at 6.1; extraction fills them per this cycle). Driver:
   user-ratified posture B (2026-05-24) — sqlite3-mcp dropped,
   scholar reimplements query/backup/inspect natively.

   Closes chore: amend-spec-add-cycle-6.14.
   ```

4. Commit: `git commit -F /tmp/commit_msg_amend-spec-add-cycle-6.14.txt`

5. Final stdout line: `WORK_COMMIT_SHA=\<sha\>` (capture via `git rev-parse HEAD`).

## Success criteria
- Exactly 1 file modified.
- §6.14 cycle block present immediately after §6.13, formatted identically to surrounding §6.N cycles.
- §6.12 cycle remains ABSENT (verify chore 1's deletion still holds).
- Single new commit; message contains "Closes chore: amend-spec-add-cycle-6.14".
- Final stdout: `WORK_COMMIT_SHA=\<sha\>`.

## Abort
If §6.12 is unexpectedly present, or §6.13 layout doesn't match the BEFORE block above, STOP and emit `ABORT: \<one-line reason\>`.

---

<sub>⏱️ 23s</sub>

### 💬 Copilot

Reading the spec file to verify §6.13 matches the expected block and that §6.12 is absent, then will insert §6.14 immediately after §6.13. Running file read now. (reporting intent + view)

---

<sub>⏱️ 23s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md

```
File too large to read at once (118.4 KB). Consider using the grep tool to search within the file, or view with view_range to read specific sections.
```


---

<sub>⏱️ 29s</sub>

### ✅ `grep`

**### 6.13 Plugin build**

"### 6.13 Plugin build"

<details>
<summary>5 matches</summary>

```
Output too large to read at once (22.1 KB). Saved to: /tmp/copilot-tool-output-1779676251807-q6mg1a.txt
Consider using tools like grep (for searching), head/tail (for viewing start/end), view with view_range (for specific sections), or jq (for JSON) to examine portions of the output.

Preview (first 500 chars):
./.claude/.cache/copilot-share/session_amend-spec-drop-sqlite3-mcp.md:222:/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:406:### 6.13 Plugin build
./.claude/.cache/copilot-share/session_amend-spec-drop-sqlite3-mcp.md-223-/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:495:4. Opens the active corpus's `scholar-<corpus>.db` via `bun:sqlite` wrapped by `drizzle-orm/bun-sqlite` (through `openWithPragmas` from §5.3, so `PRAGMA f
```

</details>


---

<sub>⏱️ 35s</sub>

### ✅ `grep`

**### 6.12**

"### 6.12"

```diff
./.claude/.cache/copilot-share/session_amend-spec-drop-sqlite3-mcp.md:85:DELETE these 5 lines entirely (the `### 6.12 sqlite3-mcp registration integration` heading and its 4-line body). The result: §6.11 is followed directly by §6.13 with NO §6.12 header in between. (Cycle 6.12 is OBSOLETE post-pivot; cycle 6.14 will be added later by a separate chore. The numbering gap at §6.12 is intentional.)
./.claude/.cache/copilot-share/session_amend-spec-drop-sqlite3-mcp.md:221:/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md:401:### 6.12 sqlite3-mcp registration integration
./.claude/.cache/copilot-share/session_amend-spec-drop-sqlite3-mcp.md:352:401. ### 6.12 sqlite3-mcp registration integration
./.claude/.cache/copilot-share/session_amend-spec-drop-sqlite3-mcp.md:674:"*** Begin Patch\n*** Update File: /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md\n@@\n-This spec proposes `scholar`, a new Cowork plugin that takes the Daisy artifact as inspiration only: it adopts the proven UX patterns (status / depth / digest / reading prompts / per-paper actions) and discards the constraint workarounds. It builds the system on a real backend (Bun + TypeScript MCP server, SQLite via Drizzle, sqlite-vec for embeddings, local Ollama for mechanical LLM work) and orchestrates the UI through `mcp-apps` views that compose with the vendored (unmodified) pdf MCP and the existing `sqlite3-mcp` and `nushell-mcp` servers already on the user's machine.\n+This spec proposes `scholar`, a new Cowork plugin that takes the Daisy artifact as inspiration only: it adopts the proven UX patterns (status / depth / digest / reading prompts / per-paper actions) and discards the constraint workarounds. It builds the system on a real backend (Bun + TypeScript MCP server, SQLite via Drizzle, sqlite-vec for embeddings, local Ollama for mechanical LLM work) and orchestrates the UI through `mcp-apps` views that compose with the vendored (unmodified) pdf MCP and the existing `nushell-mcp` server already on the user's machine.\n@@\n-5. **Persistence** — `bun:sqlite` + Drizzle ORM (`drizzle-orm/bun-sqlite`) with the `sqlite-vec` extension loaded for embedding columns. Schema migration is owned by scholar; ad-hoc query/inspect surfaces are delegated to `sqlite3-mcp` via `register_db`.\n+5. **Persistence** — `bun:sqlite` + Drizzle ORM (`drizzle-orm/bun-sqlite`) with the `sqlite-vec` extension loaded for embedding columns. Schema migration is owned by scholar; ad-hoc query/inspect surfaces are natively implemented as `scholar.query` and `scholar.inspect` (cycle 6.14 — added by a separate chore).\n@@\n-13. **Backup / distribution** — delegated to `sqlite3-mcp` (`configure_backup` → `backup_to_repo`, `pack_repo` / `unpack_from_git_ref`).\n+13. **Backup / distribution** — natively implemented as `scholar.backup` (VACUUM INTO; cycle 6.14 — added by a separate chore). Cross-host corpus distribution is a manual filesystem copy of `scholar-<corpus>.db` (see §14.2).\n@@\n-        ┌───────┴─────────┐    ┌───────────────────┐    ┌─────────────────┴────┐\n-        │  vendored:      │    │  sqlite3-mcp      │    │  Local services      │\n-        │  mcp-pdf-server │    │  (existing)       │    │  - Ollama (embeds +  │\n-        │  (child proc,   │    │  registers        │    │    chat)             │\n-        │   unmodified)   │    │  scholar DB       │    │                      │\n-        └─────────────────┘    └───────────────────┘    └──────────────────────┘\n-                │                       │                          │\n-                └───────────────────────┼──────────────────────────┘\n-                                        │\n+        ┌───────┴─────────┐                            ┌─────────────────┴────┐\n+        │  vendored:      │                            │  Local services      │\n+        │  mcp-pdf-server │                            │  - Ollama (embeds +  │\n+        │  (child proc,   │                            │    chat)             │\n+        │   unmodified)   │                            │                      │\n+        └─────────────────┘                            └──────────────────────┘\n+                │                                                  │\n+                └──────────────────────┬───────────────────────────┘\n+                                       │\n@@\n-| **sqlite3-mcp (already installed)** | Provides `query_database`, `inspect_database`, `table_schema`, `configure_backup`, `backup_to_repo`, `pack_repo`, `unpack_from_git_ref`. Scholar calls `register_db` once per corpus DB at activation. We do **not** reimplement query/backup tools. |\n@@\n-### 6.12 sqlite3-mcp registration integration\n-`register_db` on corpus activation (wired into `src/server/tools/corpus.ts`). The backup/distribution recipe is specified in §14.2; this cycle produces no separate doc file.\n-**Touches:** §5.5.\n-**Depends-on:** 6.1.\n-\n ### 6.13 Plugin build\n `scripts/build-plugin.ts` — the build orchestrator that assembles the `scholar.plugin` archive. The first-run PDF-root wizard is owned by cycle 6.3, not here.\n **Touches:** §5.36.\n@@\n-6. Registers itself with sqlite3-mcp by calling `mcp__sqlite3-mcp__register_db` once per corpus DB (best-effort; ignored if sqlite3-mcp is not running).\n-\n-All server-side initialization — first-run elicitation, corpus-open (steps 4 and 6), and pdf-child spawn (step 5) — is guarded by a single promise-memoized initializer per corpus, via `initOnce` from §12.0 keyed on the corpus id. Concurrent tool calls on a fresh install (e.g. the UI opening the dashboard while the model calls `corpus.list`) await one initialization rather than racing `runtime/config.json` writes, issuing duplicate `elicitInput` prompts, or double-spawning the pdf child. **Retry-on-reject semantics:** `initOnce` clears the slot when the factory rejects, so a transient failure (Ollama not yet up, vec0 binary momentarily inaccessible, user dismissed the first-run `elicitInput`) does not permanently break the corpus. Only errors the factory explicitly classifies as fatal (e.g., a permanent schema mismatch) are retained as stuck. **Manual escape hatch:** `scholar.corpus.reset-init` is exposed as a `[\"model\"]`-only tool that clears the init slot for a named corpus, used when an operator wants to force a re-init after fixing an environment issue without restarting the server.\n-7. Registers MCP tools and the UI resource (see §10 and §11).\n+All server-side initialization — first-run elicitation, corpus-open (step 4), and pdf-child spawn (step 5) — is guarded by a single promise-memoized initializer per corpus, via `initOnce` from §12.0 keyed on the corpus id. Concurrent tool calls on a fresh install (e.g. the UI opening the dashboard while the model calls `corpus.list`) await one initialization rather than racing `runtime/config.json` writes, issuing duplicate `elicitInput` prompts, or double-spawning the pdf child. **Retry-on-reject semantics:** `initOnce` clears the slot when the factory rejects, so a transient failure (Ollama not yet up, vec0 binary momentarily inaccessible, user dismissed the first-run `elicitInput`) does not permanently break the corpus. Only errors the factory explicitly classifies as fatal (e.g., a permanent schema mismatch) are retained as stuck. **Manual escape hatch:** `scholar.corpus.reset-init` is exposed as a `[\"model\"]`-only tool that clears the init slot for a named corpus, used when an operator wants to force a re-init after fixing an environment issue without restarting the server.\n+6. Registers MCP tools and the UI resource (see §10 and §11).\n@@\n-| 6 — sqlite3-mcp `register_db` | sqlite3-mcp not running, MCP connection refused, the tool rejecting the call. | Log through `ctx.log.warn` and continue. Re-attempted on every `scholar.corpus.activate` and `scholar.corpus.status` (Arch F4 + Integration F5) — both are idempotent against sqlite3-mcp, so retrying is safe. Loss of registration only degrades the model's ad-hoc-SQL surface, not any scholar tool. |\n-| 7 — tool registration | A `server.registerTool` rejection (duplicate name, schema validation), the resource registration failing. | Abort startup with a structured error to the host. This is a programmer error (a downstream plan introduced a duplicate or malformed schema) that no operator can fix at runtime; failing fast surfaces the bug instead of silently shipping a half-registered toolset. |\n+| 6 — tool registration | A `server.registerTool` rejection (duplicate name, schema validation), the resource registration failing. | Abort startup with a structured error to the host. This is a programmer error (a downstream plan introduced a duplicate or malformed schema) that no operator can fix at runtime; failing fast surfaces the bug instead of silently shipping a half-registered toolset. |\n@@\n-### 7.4 sqlite3-mcp integration\n-\n-Scholar treats sqlite3-mcp as a **complementary** service:\n-\n-| Need | Scholar implements | Delegated to sqlite3-mcp |\n-|---|---|---|\n-| Schema migrations | ✔ via Drizzle | — |\n-| Domain-specific reads/writes | ✔ as MCP tools | — |\n-| Ad-hoc SQL exploration | — | `query_database`, `inspect_database`, `table_schema`, `list_tables` |\n-| Backups | — | `configure_backup`, `backup_local`, `backup_to_repo`, `get_backup_config` |\n-| Distribution (corpus snapshots) | — | `pack_repo`, `pack_local`, `unpack_from_git_ref`, `unpack_from_tarball` |\n-| Cross-corpus copy | — | `copy_database` |\n-\n-When scholar opens a corpus, it calls `register_db` with that corpus's path under name `scholar:<corpus>`. When the user runs `/sqlite3-mcp query_database scholar:daisy \"SELECT count(*) FROM papers\"` they get the result without scholar mediating.\n-\n-**Lifecycle hooks against sqlite3-mcp (Integration F4).** The `register_db` call is one event in a larger lifecycle that scholar maintains symmetrically:\n-\n-| Scholar event | sqlite3-mcp action | Notes |\n-|---|---|---|\n-| `scholar.corpus.create` | `register_db` under `scholar:<id>` | Wrapped in the same `initOnce` slot as the corpus-open path so a first-run failure doesn't permanently break the corpus. |\n-| `scholar.corpus.activate` | `register_db` (idempotent retry) | Re-attempted on every activate so a sqlite3-mcp restart re-establishes the binding without a scholar restart. Also re-attempted as a side effect of `scholar.corpus.status` so the operator can force-heal by polling status (Arch F4 + Integration F5). |\n-| `scholar.corpus.archive` (sets `corpora.archived_at`) | `unregister_db scholar:<id>` if the API exposes it; otherwise log + skip and surface the stale entry through `scholar.corpus.status` | Verified at cycle 6.12 against the live sqlite3-mcp version; the table-row above records the contract scholar depends on. |\n-| Corpus delete (physical removal — no v1 caller; documented for v2) | `unregister_db scholar:<id>` then `bun.unlink` the .db file | Order matters: unregister first so sqlite3-mcp doesn't try to hand out a soon-deleted DB. |\n-| Corpus rename | `register_db scholar:<new-name>` then `unregister_db scholar:<old-name>` | New first, old second, so an interrupted rename leaves both names pointing at the live file rather than neither. |\n-\n-**Joint-ownership write discipline (Open Q2 / Integration F6).** Scholar's per-corpus DB is jointly owned: scholar holds the schema, caches, and reconciler state, but sqlite3-mcp's `query_database` exposes raw SQL to the model. Two access surfaces operate against the same file with different semantics:\n-\n-- **`bun:sqlite` (scholar code)** — the only path that maintains scholar's invariants. All writes from inside scholar's own tool handlers go through Drizzle on `bun:sqlite`. The transaction boundaries from §11 and §13 hold here.\n-- **`sqlite3-mcp.query_database` (model ad-hoc)** — bypasses every scholar invariant. A `DELETE FROM paper_chunks` issued through this path silently desyncs `chunk_vec` (no FK cascade), drops the §13 reconciler's view of paper history, and invalidates any digest whose `scope_signature` covered the removed rows. The model has no awareness of which writes are safe.\n-\n-This is **not** an opportunity to swap to a `bun:sqlite`-native alternative — the two paths serve different roles. `bun:sqlite` is a Bun runtime API only scholar's TypeScript can call; `sqlite3-mcp` exposes MCP tools the model invokes from chat. Dropping `sqlite3-mcp` would remove the model's ad-hoc query surface, which is plan 1.2's deliverable.\n-\n-v1 discipline:\n-\n-1. Scholar documents the joint-ownership semantics in the `scholar.corpus.status` output and in any operator-facing message that references sqlite3-mcp by name — including a one-line warning that destructive SQL via `query_database` can desync caches.\n-2. The skill `skills/scholar-workflow/SKILL.md` (cycle 6.10) carries the model-facing version of the same warning: **SELECT-only against `scholar:*` DBs unless you've read the schema and understand which caches your write disturbs.**\n-3. v2 candidates recorded in §16: investigate whether sqlite3-mcp exposes a read-only registration mode that scholar could prefer when the operator hasn't opted into write access, and whether scholar can subscribe to sqlite3-mcp write events to invalidate caches reactively.\n+### 7.4 Native query / backup / inspect surfaces\n+\n+Scholar implements query, backup, and inspect surfaces natively (no external delegation):\n+\n+| Need | Scholar tool | Implementation |\n+|---|---|---|\n+| Schema migrations | — | Drizzle (§7.3 step 4) |\n+| Domain-specific reads/writes | scholar.papers.*, scholar.annotations.*, etc. | Tool modules under `src/server/tools/` |\n+| Ad-hoc SQL exploration | `scholar.query` (cycle 6.14) | `bun:sqlite` direct `prepare`/`run`; BEGIN/ROLLBACK gate on write-intent |\n+| Schema/table inspection | `scholar.inspect` (cycle 6.14) | `bun:sqlite` `sqlite_master` reads; no-args structured response |\n+| Backups | `scholar.backup` (cycle 6.14) | SQLite `VACUUM INTO` sole implementation |\n+| Cross-host corpus distribution | (manual) | Filesystem copy of `scholar-<corpus>.db` (see §14.2) |\n+\n+The earlier sqlite3-mcp-delegation plan (Sessions 1–3) is retired (user ruling 2026-05-24): the upstream sqlite3-mcp is a Python/uv FastMCP server and is unvendorable for the scholar plugin's `bun build --compile` single-file distribution model. The new tools are added by cycle 6.14 (added by a separate chore: `amend-spec-add-cycle-6.14`).\n@@\n-- The user can later distribute a *corpus* (not the plugin itself) via sqlite3-mcp's `pack_repo` against `scholar-<corpus>.db`, producing a git ref another user can `unpack_from_git_ref` into their scholar installation.\n+- The user can later distribute a *corpus* (not the plugin itself) via filesystem copy of the per-corpus `scholar-<corpus>.db` file; the recipient drops it into their `runtime/dbs/` directory and registers it via `scholar.corpus.create` with the existing file path.\n@@\n-- sqlite3-mcp integration → **delegate query/backup/pack** surfaces to it via `register_db`.\n+- Query / backup / inspect surfaces → **native** (`scholar.query`, `scholar.backup`, `scholar.inspect`; cycle 6.14). sqlite3-mcp **not used** — its upstream is a Python/uv FastMCP server and is unvendorable for the scholar plugin's `bun build --compile` single-file distribution (user ruling 2026-05-24).\n*** End Patch\n"
```


---

<sub>⏱️ 35s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 396-440)

<details>
<summary>45 lines</summary>

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
415.   "author": { "name": "zayn" },
416.   "keywords": ["literature-review", "research", "mcp-apps", "annotations", "ollama", "sqlite-vec"],
417.   "license": "MIT"
418. }
419. ```
420. 
421. `.mcp.json`:
422. ```json
423. {
424.   "mcpServers": {
425.     "scholar": {
426.       "command": "${CLAUDE_PLUGIN_ROOT}/build/scholar",
427.       "args": [],
428.       "env": {
429.         "SCHOLAR_RUNTIME_ROOT": "${HOME}/mcp-data/scholar/runtime",
430.         "SCHOLAR_OLLAMA_URL": "http://127.0.0.1:11434",
431.         "SCHOLAR_OLLAMA_EMBED_MODEL": "nomic-embed-text:v1.5",
432.         "SCHOLAR_OLLAMA_CHAT_MODEL": "qwen3:8b"
433.       }
434.     }
435.   }
436. }
437. ```
438. 
439. Note: `command` points at the self-contained executable produced by `bun build --compile` (§14.1). The path is written without a platform-specific extension so a future POSIX build slots in without a `.mcp.json` edit; the Session 4 decision (Open Q3 — *cross-platform placeholder*) is recorded in §17. The §14.1 Windows build step writes the compiled binary at both `build/scholar.exe` (Windows-canonical) and an extension-less sibling at `build/scholar` so the literal `${CLAUDE_PLUGIN_ROOT}/build/scholar` resolves regardless of the MCP host's filename-resolution behavior; the implementation choice between symlink, copy, and a `.bat` shim is finalized in cycle 6.13.
440.
````

</details>


---

<sub>⏱️ 1m 18s</sub>

### 💬 Copilot

Applying the insertion: replace the exact §6.13 block with the same block plus the required blank line and the new §6.14 text. Running an edit operation now (reporting intent + edit).

---

<sub>⏱️ 1m 18s</sub>

### ✅ `edit`

**edit the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md

```
File /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md updated with changes.
```


---

<sub>⏱️ 1m 31s</sub>

### ✅ `bash`

**Show diff stat, stage file, write commit msg, commit, and print commit SHA**

$ git diff --stat docs/superpowers/specs/2026-05-22-scholar-plugin-design.md && git add docs/superpowers/specs/2026-05-22-scholar-plugin-design.md && cat > /tmp/commit_msg_amend-spec-add-cycle-6.14.txt <<'MSG'
spec(amend): add cycle 6.14 — first-party SQL/backup/inspect surface

Insert §6.14 between §6.13 and §7. Cycle 6.14 owns the bodies of
src/server/tools/{query,backup,inspect}.ts (foundation scaffolds
the stubs at 6.1; extraction fills them per this cycle). Driver:
user-ratified posture B (2026-05-24) — sqlite3-mcp dropped,
scholar reimplements query/backup/inspect natively.

Closes chore: amend-spec-add-cycle-6.14.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
MSG

git commit -F /tmp/commit_msg_amend-spec-add-cycle-6.14.txt && git rev-parse HEAD && echo "WORK_COMMIT_SHA=$(git rev-parse HEAD)"

<details>
<summary>7 lines</summary>

```
docs/superpowers/specs/2026-05-22-scholar-plugin-design.md | 5 +++++
 1 file changed, 5 insertions(+)
[ingest/2026-05-22-scholar-plugin 73ed88c] spec(amend): add cycle 6.14 — first-party SQL/backup/inspect surface
 1 file changed, 5 insertions(+)
73ed88c8818cc28a86e17a5783f7f45595acb7d8
WORK_COMMIT_SHA=73ed88c8818cc28a86e17a5783f7f45595acb7d8
<exited with exit code 0>
```

</details>


---

<sub>⏱️ 1m 39s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 396-410)

<details>
<summary>15 lines</summary>

```
396. `scholar.snapshot.take` and the delta-digest computation that diffs against the most recent snapshot.
397. **Touches:** §5.13.
398. **Depends-on:** 6.1.
399. 
400. ### 6.13 Plugin build
401. `scripts/build-plugin.ts` — the build orchestrator that assembles the `scholar.plugin` archive. The first-run PDF-root wizard is owned by cycle 6.3, not here.
402. **Touches:** §5.36.
403. **Depends-on:** 6.9, 6.10.
404. 
405. ### 6.14 First-party SQL/backup/inspect surface
406. Fills the three foundation-scaffolded stubs `src/server/tools/{query,backup,inspect}.ts` with first-party implementations using `bun:sqlite` directly. `scholar.query` exposes multi-query batch execution via prepared statements with parameter binding (no string interpolation) and a BEGIN/ROLLBACK engine-gate for write-intent classification — a `sqlite_master` escape hatch is intentionally permitted so power users can introspect schema via the same surface. `scholar.inspect` is a no-args structured dump of `sqlite_master` table list plus per-table schemas. `scholar.backup` is a WAL-safe online backup whose sole implementation is SQLite's `VACUUM INTO` against a path resolved via §12.0 `resolveUnderRoot(backupRoot, args.dest)` (path-traversal payloads cannot escape the configured backup root). The §10 tool-surface table is updated by the same cycle to add the three new entries. Driver: user-ratified posture B (2026-05-24) — scholar drops the unvendorable Python sqlite3-mcp child and reimplements query/backup/inspect natively.
407. **Touches:** §5.41, §10, §12.0.
408. **Depends-on:** 6.1, 6.3.
409. 
410. ## 7. Plugin Manifest and MCP Server Design
```

</details>


---

<sub>⏱️ 1m 44s</sub>

### ✅ `grep`

**### 6.12**

"### 6.12" (docs/superpowers/specs/2026-05-22-scholar-plugin-design.md)

```
No matches found.
```


---

<sub>⏱️ 1m 52s</sub>

### ✅ `task_complete`

**Inserted §6.14 first-party SQL/backup/inspect surface int...**

<details>
<summary>Arguments</summary>

```json
{
  "summary": "Inserted §6.14 first-party SQL/backup/inspect surface into docs/superpowers/specs/2026-05-22-scholar-plugin-design.md and committed as 73ed88c8818cc28a86e17a5783f7f45595acb7d8."
}
```

</details>

```
Inserted §6.14 first-party SQL/backup/inspect surface into docs/superpowers/specs/2026-05-22-scholar-plugin-design.md and committed as 73ed88c8818cc28a86e17a5783f7f45595acb7d8.
```


---

<sub>⏱️ 1m 52s</sub>

### ✓ Task Complete

Inserted §6.14 first-party SQL/backup/inspect surface into docs/superpowers/specs/2026-05-22-scholar-plugin-design.md and committed as 73ed88c8818cc28a86e17a5783f7f45595acb7d8.

---

<sub>Generated by [GitHub Copilot CLI](https://github.com/features/copilot/cli)</sub>

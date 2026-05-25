# 🤖 Copilot CLI Session

> [!NOTE]
> - **Session ID:** `4c1d9a29-dc84-4558-a206-f07f3ca37fdb`  
> - **Started:** 5/24/2026, 1:27:39 AM  
> - **Duration:** 1m 14s  
> - **Exported:** 5/24/2026, 1:28:54 AM  

---

<sub>⏱️ 1s</sub>

### 👤 User

SIMPLE CHORE DISPATCH — clarify-claude-md-initonce-vs-memoizeonce
==================================================================

CONTEXT
You are a simple-chore executor for the scholar plugin spec-pipeline. You
operate in the repository at /home/ramda/code/scholar on the feature branch
`ingest/2026-05-22-scholar-plugin`. Your only job is the text edit below
and the resulting commit. Do nothing else.

SCOPE (HARD)
Edit ONLY this file:
  /home/ramda/code/scholar/CLAUDE.md
DO NOT touch:
  - /home/ramda/.claude/CLAUDE.md (the user's GLOBAL CLAUDE.md — different
    file, must not be modified).
  - .claude/context/chores.xml or .claude/context/plans.xml (dispatcher
    owns those edits — invariant #5).
  - Spec files, plan-mds, src/, tests/, package.json, bun.lock, or any
    other file.
DO NOT run any package manager or build command.

TASK
In /home/ramda/code/scholar/CLAUDE.md, find the bullet under the
"Load-bearing invariants" section that enumerates the seven §12.0
primitives. It currently reads (or close to):

  §12.0 primitives mandatory. Every untrusted-input boundary routes
  through the seven foundation-owned helpers in
  `src/server/ingest/primitives.ts`: `sanitizeText`, `wrapUntrusted`,
  `resolveUnderRoot`, `encodeDoi`, `validateArxivId`,
  `loadVecAndProbeDim`, `memoizeOnce`.

Make EXACTLY this change:
  Rename `memoizeOnce` to `initOnce` (preserve backticks; preserve case).
  No other edits. Do not reorder primitive names, do not add commentary,
  do not refactor surrounding text, do not introduce new bullets.

If `memoizeOnce` appears elsewhere in CLAUDE.md outside this bullet,
rename those occurrences too (it is a strict identifier swap).

RATIONALE
Spec §12.0 is the source-of-truth for primitive names and defines the
helper as `initOnce\<T\>(key, factory, classify?)`. CLAUDE.md's
`memoizeOnce` is a text-only drift. Spec wins; CLAUDE.md is corrected.

COMMIT
Write the commit message to a file to avoid shell-escape issues:

  printf 'docs(claude-md): primitive name fix — initOnce per spec §12.0\n\nCloses chore clarify-claude-md-initonce-vs-memoizeonce. CLAUDE.md bullet\nlisted memoizeOnce; spec §12.0 names it initOnce. Text-only correction;\nno behaviour change.\n\nCo-Authored-By: GitHub Copilot \<noreply@github.com\>\n' \> /tmp/clarify_claude_md_msg.txt

Then stage and commit:

  git add CLAUDE.md
  git commit -F /tmp/clarify_claude_md_msg.txt

BRANCH SAFETY
Before committing, run:
  test "$(git branch --show-current)" = "ingest/2026-05-22-scholar-plugin" || { echo "WRONG BRANCH"; exit 1; }
Abort if not on the feature branch.

REPORTING
After a successful commit, print the work-commit SHA on its own line
prefixed exactly with "WORK_COMMIT_SHA=" so the dispatcher can parse it:

  echo "WORK_COMMIT_SHA=$(git rev-parse HEAD)"

If the edit cannot be completed (`memoizeOnce` not present, branch wrong,
etc.), print a single line prefixed "ABORT: " with the reason and exit
non-zero. Do not partial-commit.

---

<sub>⏱️ 10s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/CLAUDE.md.**

/home/ramda/code/scholar/CLAUDE.md

<details>
<summary>83 lines</summary>

````
1. # CLAUDE.md
2. 
3. This file orients future Claude Code instances working in this repository. It captures the load-bearing invariants of the scholar plugin spec; for the full design, read `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md`.
4. 
5. ## Repository state
6. 
7. Pre-implementation. The repository contains:
8. 
9. - `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` — the design spec (1.3k lines, frozen by the four-session 2026-05-22 reconciliation pass).
10. - `docs/superpowers/specs/2026-05-22-scholar-plugin-splits.xml` — the plan-split derivation that maps §6 cycles to seven plans (foundation → corpus → {ingest, extraction, annotations} → frontends → packaging).
11. - `.claude/context/plans.xml` — the spec-pipeline plan registry (one plan-group, seven children).
12. - `.claude/context/chores.xml` — the spec-pipeline chore registry (three seeded cross-cutting chores).
13. 
14. Foundation cycle 6.1 is the first plan to execute; it creates `src/`, `package.json`, `tsconfig.json`, `drizzle.config.ts`, the plugin manifest, `.mcp.json`, and the full module skeleton (stubs for every later-plan-owned file). Until then, the only sources of truth are the spec, splits.xml, plans.xml, and chores.xml.
15. 
16. ## Workflow
17. 
18. Plan authoring and execution go through the `spec-pipeline` skill. The next step from the current state is `spec-pipeline:spec-to-multi-plan`, which reads the spec + splits.xml and writes one `docs/superpowers/plans/<plan-id>.md` per plan, then sets each plan's `plan-md` attribute in `plans.xml`. Plan execution is the `exec-plan` (single-plan) or `exec-multi-plan` (concurrent wave) workflow; cycles run TDD inside each plan.
19. 
20. Chores are cross-cutting work that doesn't belong to any single §6 cycle (license audit, CI setup, re-vendor process). Add new chores through the spec-pipeline scope-maintenance protocol — not by editing chores.xml directly mid-task.
21. 
22. ## Architecture (target system)
23. 
24. - **scholar MCP server** — Bun + `bun:sqlite` + `drizzle-orm/bun-sqlite` + `sqlite-vec`, shipped as a `bun build --compile` single-file executable. Exposes corpus, ingestion, annotation, digest, prompts, search, and UI-resource tools. Spawns the vendored pdf MCP as a child.
25. - **vendored pdf MCP** — `@modelcontextprotocol/server-pdf@1.7.2` shipped **unmodified** under `src/vendor/pdf-server/`. Root injection rides the standard MCP `roots/list` + `notifications/roots/list_changed` protocol; scholar implements the client-side responder in `src/server/pdf/lifecycle.ts`. No source patch.
26. - **single-file UI bundle** — React, built by Bun's HTML bundler (`bun build src/ui/index.html --target=browser`, no vite). Five views: corpus dashboard, paper detail, digest panel, reading prompts, reader progress.
27. - **nu CLI module** — `nu/scholar.nu`, user-facing wrapper that calls scholar MCP tools and shapes responses into nu tables.
28. - **sqlite3-mcp delegation** — query/backup/pack surfaces are delegated; scholar calls `register_db` per corpus and does **not** reimplement those tools.
29. - **Ollama (local)** — embeddings (`nomic-embed-text:v1.5` default) and chat (`qwen3:8b` default). The `cowork.askClaude` host fallback is opt-in per request.
30. 
31. ## Load-bearing invariants
32. 
33. These are pinned by the spec and frozen for v1; downstream plans must not violate them:
34. 
35. - **§12.0 primitives mandatory.** Every untrusted-input boundary routes through the seven foundation-owned helpers in `src/server/ingest/primitives.ts`: `sanitizeText`, `wrapUntrusted`, `resolveUnderRoot`, `encodeDoi`, `validateArxivId`, `loadVecAndProbeDim`, `memoizeOnce`. Bare string concatenation into prompts, paths, or HTTP requests is forbidden.
36. - **§7.6 frozen contracts.** `ServerContext`, `PdfChild`, `ConfigAccessor`, `Logger`, `registerTools`, `runRawDdl` are pinned. `ctx.db` is *snapshot-at-entry* (a tool handler snapshots into a local on its first line; `corpus.activate` mutates `ctx.db` in place). Cross-plan helpers take a `tx` first arg; the Ollama client is a foundation singleton imported directly (not on `ServerContext`).
37. - **Module-skeleton ownership.** Foundation cycle 6.1 *scaffolds* nine tool-module stubs (`corpus.ts`, `roots.ts`, `snapshot.ts`, `ingest.ts`, `pdf.ts`, `papers.ts`, `digest.ts`, `prompts.ts`, `annotations.ts`) and `raw-ddl.ts` as no-ops. Downstream plans *fill bodies*; no plan creates a new tool file or edits a sibling plan's file.
38. - **No downstream `bun add` or `package.json` edit.** Foundation pre-declares the entire v1 dep set at cycle 6.1 (enumerated in §6.1's "Pre-declaration of dependencies" paragraph). Later cycles `import` from those packages but never edit `package.json` or `bun.lock`. This is what makes the splits.xml `worktree="not-required"` invariant defensible.
39. - **Mechanical LLM → local Ollama.** Embeddings, digest, and reading-prompts default to local Ollama. `cowork.askClaude` is an explicit per-request opt-in only — never the default path.
40. - **`raw-ddl.ts` for non-Drizzle objects.** `chunk_vec` (sqlite-vec virtual table) and `reading_queue` (view) are not Drizzle-modelled; their DDL lives in `src/server/db/raw-ddl.ts` and runs through the `runRawDdl(db)` hook invoked by `migrations.ts` after Drizzle migrations.
41. - **Per-corpus DB files.** Each corpus is its own SQLite file at `runtime/dbs/scholar-<corpus>.db`; the config DB is separate at `runtime/dbs/scholar-config.db`. `PRAGMA foreign_keys = ON` runs on every connection (the pragma is per-connection in SQLite, not per-database).
42. - **Annotation reconciliation discipline (§13).** Phase 1 reads → phase 2 MCP I/O → phase 3 `db.transaction(...)` with **no awaits inside** the transaction closure. Concurrent `annotations.list` correctness depends on keeping pdf-child round-trips outside the write-lock window.
43. - **Single active session.** Scholar acquires an exclusive `flock` on `runtime/scholar.lock` at startup; a second instance refuses to start with a structured `SCHOLAR_LOCKED` error.
44. 
45. ## Conventions
46. 
47. - **Tool namespace.** All scholar MCP tools start with `scholar.` (e.g., `scholar.corpus.activate`, `scholar.papers.search`). Pdf-child tools surface as `scholar.pdf.*` proxies — never as raw `pdf.*` to the host.
48. - **TDD per cycle.** Each §6 cycle is independently testable; plans execute cycles Red → Green → optional Refactor. `bun test` is the test runner; tests live next to source as `*.test.ts`.
49. - **Runtime data gitignored.** Everything under `runtime/` (DBs, locks, downloaded PDFs, snapshots) is per-user state and never committed.
50. - **Spec is the source of truth.** Section numbers (§7.2, §12.0, §13, etc.) are referenced from code comments and PR descriptions. When the spec disagrees with the code, the spec wins until a deliberate spec edit lands.
51. 
52. ## Bun conventions (project-wide)
53. 
54. Default to Bun over Node.js for every operation in this repo:
55. 
56. - Use `bun <file>` instead of `node <file>` or `ts-node <file>`.
57. - Use `bun test` instead of `jest` or `vitest`.
58. - Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`.
59. - Use `bun install` instead of `npm install` / `yarn install` / `pnpm install`.
60. - Use `bun run <script>` instead of `npm run <script>` / `yarn run <script>` / `pnpm run <script>`.
61. - Use `bunx <package> <command>` instead of `npx <package> <command>`.
62. - Bun automatically loads `.env`, so don't use `dotenv`.
63. 
64. APIs:
65. 
66. - `Bun.serve()` for HTTP/WebSocket (don't add `express`).
67. - `bun:sqlite` for SQLite (don't add `better-sqlite3`).
68. - Built-in `fetch` for HTTP clients (don't add `undici` or `ofetch`).
69. - `Bun.file` for file I/O (prefer over `node:fs`'s readFile/writeFile).
70. - `Bun.$\`ls\`` for shell-outs (don't add `execa`).
71. 
72. Testing:
73. 
74. ```ts
75. import { test, expect } from "bun:test";
76. 
77. test("hello world", () => {
78.   expect(1).toBe(1);
79. });
80. ```
81. 
82. UI bundling uses Bun's HTML bundler (no `vite`, no `vite-plugin-singlefile`). See spec §14.1 step 2 for the exact invocation.
83.
````

</details>


---

<sub>⏱️ 50s</sub>

### ✅ `edit`

**edit the file at /home/ramda/code/scholar/CLAUDE.md.**

/home/ramda/code/scholar/CLAUDE.md

```
File /home/ramda/code/scholar/CLAUDE.md updated with changes.
```


---

<sub>⏱️ 58s</sub>

### ✅ `bash`

**Branch check, write commit message file, add and commit CLAUDE.md, print commit SHA**

$ test "$(git branch --show-current)" = "ingest/2026-05-22-scholar-plugin" || { echo "ABORT: WRONG BRANCH"; exit 1; }
printf 'docs(claude-md): primitive name fix — initOnce per spec §12.0

Closes chore clarify-claude-md-initonce-vs-memoizeonce. CLAUDE.md bullet
listed memoizeOnce; spec §12.0 names it initOnce. Text-only correction;
no behaviour change.

Co-Authored-By: GitHub Copilot <noreply@github.com>
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
' > /tmp/clarify_claude_md_msg.txt

git add CLAUDE.md

git commit -F /tmp/clarify_claude_md_msg.txt

echo "WORK_COMMIT_SHA=$(git rev-parse HEAD)"


```
[ingest/2026-05-22-scholar-plugin c97de4f] docs(claude-md): primitive name fix — initOnce per spec §12.0
 1 file changed, 1 insertion(+), 1 deletion(-)
WORK_COMMIT_SHA=c97de4f3b570e18b12f6740b0f97056d5d1aad48
<exited with exit code 0>
```


---

<sub>⏱️ 1m 2s</sub>

### 💬 Copilot

WORK_COMMIT_SHA=c97de4f3b570e18b12f6740b0f97056d5d1aad48

---

<sub>⏱️ 1m 14s</sub>

### ✅ `task_complete`

**Renamed memoizeOnce → initOnce in CLAUDE.md (the §12.0 pr...**

<details>
<summary>Arguments</summary>

```json
{
  "summary": "Renamed memoizeOnce → initOnce in CLAUDE.md (the §12.0 primitives bullet and all other occurrences). Changes staged and committed on branch ingest/2026-05-22-scholar-plugin. WORK_COMMIT_SHA=c97de4f3b570e18b12f6740b0f97056d5d1aad48. Text-only correction per spec §12.0; no behavior change."
}
```

</details>

```
Renamed memoizeOnce → initOnce in CLAUDE.md (the §12.0 primitives bullet and all other occurrences). Changes staged and committed on branch ingest/2026-05-22-scholar-plugin. WORK_COMMIT_SHA=c97de4f3b570e18b12f6740b0f97056d5d1aad48. Text-only correction per spec §12.0; no behavior change.
```


---

<sub>⏱️ 1m 14s</sub>

### ✓ Task Complete

Renamed memoizeOnce → initOnce in CLAUDE.md (the §12.0 primitives bullet and all other occurrences). Changes staged and committed on branch ingest/2026-05-22-scholar-plugin. WORK_COMMIT_SHA=c97de4f3b570e18b12f6740b0f97056d5d1aad48. Text-only correction per spec §12.0; no behavior change.

---

<sub>Generated by [GitHub Copilot CLI](https://github.com/features/copilot/cli)</sub>

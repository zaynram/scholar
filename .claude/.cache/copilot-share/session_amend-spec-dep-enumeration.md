# 🤖 Copilot CLI Session

> [!NOTE]
> - **Session ID:** `50ca06eb-6e83-420b-8875-a4dc228d829d`  
> - **Started:** 5/24/2026, 9:33:05 PM  
> - **Duration:** 1m 21s  
> - **Exported:** 5/24/2026, 9:34:26 PM  

---

<sub>⏱️ 1s</sub>

### 👤 User

# Chore: amend-spec-dep-enumeration

## Dispatch header
- chore-id: amend-spec-dep-enumeration
- vehicle: copilot-cli (simple-chore via spec-pipeline)
- model: gpt-5-mini
- tier: mechanical
- tier rationale: Line-by-line additions to a single bulleted list, plus one in-place rename. Verbatim source available in foundation plan-md. No interpretation required; mechanical tier (gpt-5-mini, 0x cost).
- blast-radius: docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (ONLY this file)
- working dir: /home/ramda/code/scholar (same-repo)
- branch: ingest/2026-05-22-scholar-plugin

## Context
Spec §6.1's "Pre-declaration of dependencies" paragraph enumerates the v1 npm dep set foundation pre-declares. The foundation plan-md (`docs/superpowers/plans/2026-05-22-scholar-plugin-foundation.md`) absorbed 5 additional deps during plan-md authoring that the spec doesn't yet reflect: `zod`, `typescript`, `pdfjs-dist`, `ulidx`, `fflate`. This chore brings the spec in line with the plan-md.

Additionally, the spec currently lists `pdf.js` — that is the defunct 2012 npm package (`pdf.js@0.1.0`); the canonical Mozilla dist is `pdfjs-dist`. Foundation plan-md corrects this inline; the chore must apply the same correction to the spec.

Note: foundation plan-md also enumerates `koffi` (for §16 FFI). The chore-author chose NOT to include koffi in this chore's scope — koffi enumeration is deferred. Do NOT add koffi.

## Scope: exactly these edits

The current §6.1 "Pre-declaration of dependencies" list lives at approximately lines 335–344 in the spec file. The exact content is:

```
- `@modelcontextprotocol/sdk` `^1.29.0` — MCP server runtime (latest stable at S4 close; pin recorded in §17).
- `drizzle-orm` + `drizzle-kit` — schema, migrations, query builder (uses the `drizzle-orm/bun-sqlite` driver — see §7.6).
- `sqlite-vec` — vec0 virtual-table extension; loaded via `Database.loadExtension` against Bun's bundled SQLite (§16).
- `@retorquere/bibtex-parser` — BibTeX import (RIS handled by an in-house adapter in `src/server/ingest/bibtex.ts`, §5.14).
- `js-tiktoken` — pure-JS tokenizer for the chunker's 512/64 windowing (no native build; matches the Bun-first stance).
- `chart.js` — bundled progress charts (`src/ui/views/ReaderProgress.tsx`; uPlot swap candidate documented in §17 gated on §14.1's bundle measurement).
- `pdf.js` — bundled paper-detail renderer (worker resource split is the §14.1 fallback if bundle measurement exceeds 90% of the 5 MB iframe-resource cap).
- `react` + `react-dom` — UI runtime (Preact swap candidate documented in §17, same gate as Chart.js).
- `bun:test` — test runner (built-in to the Bun runtime; zero deps; replaces vitest per the Bun-everywhere project convention pinned in CLAUDE.md).
```

### EDIT 1 — Rename `pdf.js` to `pdfjs-dist`
Find the bullet starting with `` - `pdf.js` — bundled paper-detail renderer ``. REPLACE that line with:

```
- `pdfjs-dist` — bundled paper-detail renderer for `src/ui/views/PaperDetail.tsx` (worker resource split is the §14.1 fallback if bundle measurement exceeds 90% of the 5 MB iframe-resource cap). The defunct `pdf.js` npm package (`pdf.js@0.1.0`) is **not** the same thing; `pdfjs-dist` is the canonical Mozilla distribution.
```

### EDIT 2 — Insert 4 new bullets at the end of the list
Find the LAST bullet `` - `bun:test` — test runner ...``. AFTER that line and BEFORE the next paragraph (the "Foundation does **not** add..." paragraph), INSERT these 4 new bullets in this exact order:

```
- `zod` — input validation at MCP-SDK tool boundaries (`inputSchema: z.object({...})` across every `src/server/tools/*.ts` registration).
- `ulidx` — ULID generation for `paper_chunks`, `papers`, `annotations`, `digests`, `reading_prompts` id columns (per §11.5 Ruling B 2026-05-24; UPSERT-on-natural-key replaces SHA-256 content-addressed IDs). The `ulidx` package is preferred over the original `ulid` package because it is the maintained TypeScript fork.
- `fflate` — zip-creation for the `.plugin` archive assembled by `scripts/build-plugin.ts` at cycle 6.13 (per §14.1 step 7, Ruling #2 2026-05-24).
- `typescript` — `tsc --noEmit` typecheck step. Dev/build dep; the binary is implied by the `typecheck` script but enumerated here for completeness so foundation pre-declares the full toolchain.
```

CRITICAL formatting:
- Match the existing bullet style (`-` not `*`, single backticks around dep names, em-dash separator).
- Do NOT add a blank line between the new bullets.
- Preserve a single blank line between the last new bullet (`typescript`) and the next paragraph (`Foundation does **not** add...`).

## What is OUT OF SCOPE for this chore
- DO NOT add `koffi`. (Deferred; out-of-scope per chore-author.)
- DO NOT modify the "Foundation does **not** add..." paragraph (negative list), even though `pdf.js` may be referenced there as a swap target.
- DO NOT modify any other §6.N cycle.
- DO NOT modify foundation plan-md or any other plan-md.
- DO NOT touch any file outside the one in blast-radius.

## Output: commit conventions
1. `git diff --stat docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` — expect ONE file, net +5 lines (1 line replaced longer + 4 lines inserted).

2. `git add docs/superpowers/specs/2026-05-22-scholar-plugin-design.md`

3. Write `/tmp/commit_msg_amend-spec-dep-enumeration.txt`:
   ```
   spec(amend): enumerate 4 new deps + correct pdf.js → pdfjs-dist

   Add zod, ulidx, fflate, typescript to §6.1 dependency
   pre-declaration list. Rename pdf.js (defunct 2012 package)
   to pdfjs-dist (canonical Mozilla distribution). Brings spec
   in line with foundation plan-md's deps absorbed during plan
   authoring. koffi deferred (out of this chore's scope).

   Closes chore: amend-spec-dep-enumeration.
   ```

4. `git commit -F /tmp/commit_msg_amend-spec-dep-enumeration.txt`

5. Final stdout: `WORK_COMMIT_SHA=\<sha\>`.

## Success criteria
- Exactly 1 file modified.
- `pdf.js` bullet replaced by `pdfjs-dist` bullet.
- Four new bullets (zod, ulidx, fflate, typescript) present after `bun:test` and before the next paragraph.
- Single new commit; message contains "Closes chore: amend-spec-dep-enumeration".

## Abort
If the existing bullets don't match the BEFORE block exactly (e.g., bullets were modified by chore 1 in unexpected ways), STOP and emit `ABORT: \<one-line reason\>`.

---

<sub>⏱️ 34s</sub>

### 💬 Copilot

Reading the spec to verify the §6.1 dependency list matches the provided "BEFORE" block exactly. Will fetch the file for inspection before making edits. Running file view now. (Includes intent report).

---

<sub>⏱️ 34s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md

```
File too large to read at once (119.5 KB). Consider using the grep tool to search within the file, or view with view_range to read specific sections.
```


---

<sub>⏱️ 40s</sub>

### 💬 Copilot

Reading the chunk around lines ~330–360 to locate the §6.1 dependency list exactly; this narrows the view to the relevant lines.

---

<sub>⏱️ 40s</sub>

### ✅ `view`

**view the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md (lines 320-380)

<details>
<summary>61 lines</summary>

```
320. 
321. ### 5.44 src/server/db/raw-ddl.ts
322. Idempotent raw-SQL DDL that Drizzle cannot manage: the `chunk_vec` `vec0` virtual table and the `reading_queue` view (`CREATE ... IF NOT EXISTS`). Owned by the `extraction` plan (cycle 6.5 creates `chunk_vec`, cycle 6.6 creates `reading_queue`).
323. 
324. ## 6. Implementation Cycles
325. 
326. **Complexity:** 8 (high — multi-process orchestration, vendored upstream pdf MCP with client-side MCP roots responder, embeddings, UI, and CLI wired together).
327. 
328. The following cycles capture TDD-structured work units. Each cycle is independently testable; the dependency relationships are documented per cycle and inform the plan-split (multi-plan) overlap analysis.
329. 
330. ### 6.1 Project scaffolding
331. `package.json`, `tsconfig.json`, `drizzle.config.ts`, Bun runner, basic CI. Owns the server skeleton (`src/server/index.ts`), the Drizzle schema (`src/server/db/schema.ts`), the migration bootstrap (`src/server/db/migrations.ts`), the `sqlite-vec` loader (`src/server/db/sqlite-vec.ts`), and the config DB. Scaffolds the full module skeleton — `src/server/tools/registry.ts`, a no-op stub for every tool module (`corpus`, `roots`, `snapshot`, `ingest`, `pdf`, `papers`, `digest`, `prompts`, `annotations`), `src/server/ingest/primitives.ts` (the seven §12.0 helpers), and a `src/server/db/raw-ddl.ts` stub — and pins the cross-plan contracts (`ServerContext`, `PdfChild`, `ConfigAccessor`, `Logger`, `registerTools`, `runRawDdl`) so downstream plans fill bodies without editing a foundation file (see §7.6). Authors the plugin manifest (`.claude-plugin/plugin.json`) and `.mcp.json`.
332. 
333. **Pre-declaration of dependencies.** Cycle 6.1 is the sole writer of `package.json` and `bun.lock` in v1. It pre-declares every npm dependency any later cycle will need; later cycles `import` from those packages but never edit either file. The v1 dependency set foundation installs at 6.1, resolved by the 2026-05-22 Session 4 tech-currency pass:
334. 
335. - `@modelcontextprotocol/sdk` `^1.29.0` — MCP server runtime (latest stable at S4 close; pin recorded in §17).
336. - `drizzle-orm` + `drizzle-kit` — schema, migrations, query builder (uses the `drizzle-orm/bun-sqlite` driver — see §7.6).
337. - `sqlite-vec` — vec0 virtual-table extension; loaded via `Database.loadExtension` against Bun's bundled SQLite (§16).
338. - `@retorquere/bibtex-parser` — BibTeX import (RIS handled by an in-house adapter in `src/server/ingest/bibtex.ts`, §5.14).
339. - `js-tiktoken` — pure-JS tokenizer for the chunker's 512/64 windowing (no native build; matches the Bun-first stance).
340. - `chart.js` — bundled progress charts (`src/ui/views/ReaderProgress.tsx`; uPlot swap candidate documented in §17 gated on §14.1's bundle measurement).
341. - `pdf.js` — bundled paper-detail renderer (worker resource split is the §14.1 fallback if bundle measurement exceeds 90% of the 5 MB iframe-resource cap).
342. - `react` + `react-dom` — UI runtime (Preact swap candidate documented in §17, same gate as Chart.js).
343. - `bun:test` — test runner (built-in to the Bun runtime; zero deps; replaces vitest per the Bun-everywhere project convention pinned in CLAUDE.md).
344. 
345. Foundation does **not** add a dedicated HTTP client; CrossRef and arXiv calls use Bun's native `fetch`. Foundation does **not** add `vite`, `vite-plugin-singlefile`, `better-sqlite3`, `citation.js`, `undici`, `ofetch`, or `gpt-tokenizer`. Native `vec0` build orchestration (compile-from-source when prebuilt Windows ABI mismatches Bun's linked SQLite) is scaffolded as a build script invoked by cycle 6.1 — see §16. Any subsequent change to this list lands as a single foundation-cycle edit; no later cycle gains write authority over `package.json` or `bun.lock`. This pre-declaration is what makes the splits-file `worktree="not-required"` invariant defensible: with `package.json` and `bun.lock` owned only by foundation, no two wave-2 worktrees can collide on dependency edits. The matching invariant lands in the splits.xml header (Session 4).
346. 
347. **Touches:** §5.1, §5.2, §5.3, §5.4, §5.38, §5.40, §5.41, §5.42, §5.43, §5.44, §12.0.
348. **Depends-on:** none.
349. 
350. ### 6.2 Vendored pdf MCP + protocol-based roots responder
351. Vendor `@modelcontextprotocol/server-pdf@1.7.2` `dist/` unmodified into `src/vendor/pdf-server/`. Implement scholar's MCP client side for the pdf-child session in `src/server/pdf/lifecycle.ts`: advertise `capabilities.roots.listChanged = true`, register a `ListRootsRequestSchema` handler that returns the active corpus's PDF roots as `file://` URIs, and expose a `setRoots(paths[])` API that updates `currentRoots` and emits `notifications/roots/list_changed`. Add the spawn wrapper that passes `--use-client-roots --stdio` and (on Windows) attaches the child to a `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job Object. Tests: spawn lifecycle, roots/list responder fixture, list_changed round-trip, viewUUID survival across a root mutation.
352. **Touches:** §5.19, §5.28.
353. **Depends-on:** 6.1.
354. 
355. ### 6.3 Corpus + roots tools
356. `scholar.corpus.*` and `scholar.roots.*` tools. First-run wizard wired so the wizard's output flows to the config DB.
357. **Touches:** §5.5, §5.6, §5.37.
358. **Depends-on:** 6.1, 6.2.
359. 
360. ### 6.4 Ingestion adapters and tools
361. `@retorquere/bibtex-parser` (BibTeX) + in-house RIS adapter / CrossRef / arXiv adapters plus the `scholar.ingest.*` tools. All remotely-sourced metadata is treated as untrusted: sanitized and length-capped on ingest, and downloaded file paths are constrained under the corpus root (see §12).
362. **Touches:** §5.11, §5.14, §5.15, §5.16.
363. **Depends-on:** 6.1, 6.3.
364. 
365. ### 6.5 Text extraction + chunk embeddings
366. `scholar.pdf.refresh-extraction`, chunker, Ollama client. Fills the `runRawDdl` hook in `src/server/db/raw-ddl.ts` (stub from cycle 6.1) to create the `chunk_vec` virtual table; consumes the `sqlite-vec` loader from cycle 6.1. **Vec0 smoke test (per §16):** the first test in this cycle opens an empty per-corpus DB, calls `db.loadExtension(<resolved path to build/vendor/sqlite-vec/vec0>)`, creates a `vec0(emb FLOAT[768])` virtual table, inserts one row, and reads it back — verifying ABI compatibility between Bun's bundled SQLite and the bundled `vec0` shared library before any embedding code runs. The test is the canary that catches Windows-DLL/Bun-SQLite ABI mismatches at the build-pipeline boundary instead of at first-paper-ingest time.
367. **Touches:** §5.12, §5.17, §5.18, §5.44.
368. **Depends-on:** 6.1, 6.2, 6.3.
369. 
370. ### 6.6 Search + reading queue
371. `scholar.papers.search` (hybrid lexical + sqlite-vec), the `reading_queue` view (raw DDL in `src/server/db/raw-ddl.ts`), `scholar.papers.update` for status/priority/depth/role/section.
372. **Touches:** §5.7, §5.44.
373. **Depends-on:** 6.1, 6.5.
374. 
375. ### 6.7 Annotation round-trip
376. `scholar.annotations.*` tools and the bidirectional reconciliation with the child pdf MCP.
377. **Touches:** §5.8.
378. **Depends-on:** 6.1, 6.2, 6.3.
379. 
380. ### 6.8 Digest + reading prompts
```

</details>


---

<sub>⏱️ 52s</sub>

### 💬 Copilot

Applying two edits: (1) replace the `pdf.js` bullet with a `pdfjs-dist` sentence, (2) append 4 new dependency bullets after the `bun:test` line. Including intent report with the edits.

---

<sub>⏱️ 55s</sub>

### ✅ `edit`

**edit the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md

```
File /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md updated with changes.
```


---

<sub>⏱️ 59s</sub>

### ✅ `edit`

**edit the file at /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md.**

/home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md

```
File /home/ramda/code/scholar/docs/superpowers/specs/2026-05-22-scholar-plugin-design.md updated with changes.
```


---

<sub>⏱️ 1m 6s</sub>

### 💬 Copilot

Committing changes: show git diff stat, stage file, write the commit message file with the requested content plus Co-authored-by trailer, run git commit, and print the new commit SHA. Including intent report with the commit step.

---

<sub>⏱️ 1m 10s</sub>

### ✅ `bash`

**git diff --stat, add, write commit msg, commit, print sha**

$ git --no-pager diff --stat docs/superpowers/specs/2026-05-22-scholar-plugin-design.md && git add docs/superpowers/specs/2026-05-22-scholar-plugin-design.md && cat > /tmp/commit_msg_amend-spec-dep-enumeration.txt <<'MSG'
spec(amend): enumerate 4 new deps + correct pdf.js → pdfjs-dist

Add zod, ulidx, fflate, typescript to §6.1 dependency
pre-declaration list. Rename pdf.js (defunct 2012 package)
to pdfjs-dist (canonical Mozilla distribution). Brings spec
in line with foundation plan-md's deps absorbed during plan
authoring. koffi deferred (out of this chore's scope).

Closes chore: amend-spec-dep-enumeration.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
MSG

git commit -F /tmp/commit_msg_amend-spec-dep-enumeration.txt && git rev-parse --short HEAD

<details>
<summary>6 lines</summary>

```
docs/superpowers/specs/2026-05-22-scholar-plugin-design.md | 6 +++++-
 1 file changed, 5 insertions(+), 1 deletion(-)
[ingest/2026-05-22-scholar-plugin 541ffcb] spec(amend): enumerate 4 new deps + correct pdf.js → pdfjs-dist
 1 file changed, 5 insertions(+), 1 deletion(-)
541ffcb
<exited with exit code 0>
```

</details>


---

<sub>⏱️ 1m 21s</sub>

### ✅ `task_complete`

**Replaced `pdf.js` with `pdfjs-dist` and added zod, ulidx,...**

<details>
<summary>Arguments</summary>

```json
{
  "summary": "Replaced `pdf.js` with `pdfjs-dist` and added zod, ulidx, fflate, typescript to §6.1 in docs/superpowers/specs/2026-05-22-scholar-plugin-design.md. Committed changes (Closes chore: amend-spec-dep-enumeration)."
}
```

</details>

```
Replaced `pdf.js` with `pdfjs-dist` and added zod, ulidx, fflate, typescript to §6.1 in docs/superpowers/specs/2026-05-22-scholar-plugin-design.md. Committed changes (Closes chore: amend-spec-dep-enumeration).
```


---

<sub>⏱️ 1m 21s</sub>

### ✓ Task Complete

Replaced `pdf.js` with `pdfjs-dist` and added zod, ulidx, fflate, typescript to §6.1 in docs/superpowers/specs/2026-05-22-scholar-plugin-design.md. Committed changes (Closes chore: amend-spec-dep-enumeration).

---

<sub>Generated by [GitHub Copilot CLI](https://github.com/features/copilot/cli)</sub>

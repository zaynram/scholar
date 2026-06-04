# Invariant Enforcement Matrix — Scholar Plugin

**Date:** 2026-06-04
**Author:** Claude (opus-4-8), under explicit user direction to exercise judgment.
**Motivation:** The codebase pins load-bearing invariants in *prose* (CLAUDE.md
§"Load-bearing invariants", the spec's frozen §7.6 contracts). Two recent bugs
(the nu `out+err>|` stream merge; the CLI `ctx.db` rehydration gap, Bug #2b) were
the same shape — a fact treated as true by *convention*, untested, silently broken
when the convention was violated. This audit maps the gap between invariants the
project *asserts* and invariants anything *enforces*, so the bluffing ones are a
punch-list instead of a surprise.

**Method:** each invariant classified as one of —
`enforced-in-test` (a test fails if violated) ·
`enforced-in-code` (structurally prevented / used at the boundary) ·
`enforced-by-construction` (impossible to violate after a refactor) ·
`convention-only` (honored by discipline; nothing checks it) ·
`documented-unimplemented` (asserted in docs, absent in code) ·
`unverified` (not checked this pass).

Receipts are `file:line` from direct reads, not memory.

---

## Matrix

| # | Invariant (source) | Status | Receipt |
|---|---|---|---|
| 1 | §12.0 primitives at every untrusted boundary | **was `enforced-in-code (use) + convention (coverage)` → now enforced-in-test (coverage)** | Primitives unit-proven against hostile input (`primitives.test.ts`: bidi/tag-block reject, parent-traversal + symlink `PathEscapeError`, malformed DOI/arXiv reject). Boundaries proven to *fire* the primitive: ingest (`ingest.test.ts:168/176/184` → `PathEscapeError`/`InvalidDoiError`/`InvalidArxivIdError`), digest/prompts nonce envelope (`digest.test.ts:84-99,119`, `prompts.test.ts:105`), annotations body+anchor (`annotations.test.ts:461,476` → bidi-override rejected before write/push). `papers.search` SQL-binding pinned behaviorally (`papers.test.ts` "SQL-injection safety"). Per-module classification of the no-primitive boundaries in Δ6. |
| 2 | §7.6 `ctx.db` snapshot-at-entry | **enforced-in-test** + code | `index.test.ts:52` "ServerContext.withCorpus snapshots ctx.db at entry"; pervasive `const _db = ctx.db` across all tool modules; `corpus.activate` mutates in place (`corpus.ts:342`). |
| 3 | §7.6 frozen contracts (`ServerContext`/`PdfChild`/…) pinned for v1 | convention-only | No automated guard. Honored. *This pass declined to add a `ServerContext` field (INV-3 fix) precisely to respect this freeze.* |
| 4 | Per-corpus DB + `PRAGMA foreign_keys=ON` per connection | **enforced-in-test** (strong) | `openWithPragmas`; `migrations.test.ts` pins "sets PRAGMA foreign_keys = ON on every open" **and** "applyMigrations refuses to run when PRAGMA foreign_keys is OFF". |
| 5 | Single active session — flock on `runtime/scholar.lock`, `SCHOLAR_LOCKED` refusal | **was `documented-unimplemented` → now enforced-in-test + real-artifact** | Implemented this pass: `session-lock.ts`; `session-lock.test.ts` (5 cases); two real `bun run … index.ts` servers proven (see below). *Mechanism changed from flock → pidfile; see Δ1.* Release is no longer signal-dependent — the F1 graceful-shutdown fix (Δ3) releases on stdin EOF too, closing the host-shutdown-mode hazard the first pass surfaced. |
| 6 | Single runtime-root source of truth | **was `convention-only` → now enforced-by-construction** | `main()` now delegates to `resolveRuntimeRoot()` (`index.ts`), the same resolver handlers use. See Δ2. |
| 7 | No downstream `bun add` / `package.json` edit | convention-only | Honored. The lock impl used only `node:fs` — no new dep. |
| 8 | §13 annotation discipline — no pdf round-trip inside a write-lock window | **was `unverified` → now enforced-by-construction + enforced-in-test** | The v1.0 `db.transaction` reconciler was **retired** (2026-05-27 §13 v1.1 amendment; `server-pdf@1.7.2` has no enumeration verb). v1.1 is write-then-push: `handleUpsert`/`handleDelete` (`annotations.ts`) do read-check → **no await** → single-statement `.run()` write → `await pdf.interact` (push *after* commit). Single-threaded loop + no-await-between-read-and-write ⇒ effectively atomic; no transaction window exists to hold across a round-trip. Tests: `annotations.test.ts` write-then-push ordering for upsert (`:202`) and delete (`:321`) + dirty-row failure-safety (`:280`). See F2 resolution (Δ4). |
| 9 | `raw-ddl.ts` for non-Drizzle objects (`chunk_vec`, `reading_queue`) | **enforced-in-code + enforced-in-test** | `raw-ddl.ts` owns both (`CREATE VIRTUAL TABLE … vec0` deferred behind `embed.dim`+`chunk_vec.created`; `CREATE VIEW reading_queue`, both `IF NOT EXISTS`); `migrations.ts:65-66` runs `migrate()` **then** `runRawDdl(db)`; `schema.ts:127,267` marks both "NOT Drizzle". Tests: `raw-ddl.test.ts` vec0 ABI smoke, chunk_vec materialization (`:62`), M4/A1 invariant errors (`:77,:94`). See Δ5. |
| 10 | Mechanical LLM → local Ollama default; `askClaude` opt-in only | **enforced-in-code + enforced-in-test** | `digest.ts:128` / `prompts.ts:120`: `if (use_claude === true)` → return sentinel, **else** `ollama.chat(DEFAULT_CHAT_MODEL)`; embeddings via `ollama.embed(DEFAULT_EMBED_MODEL)` (`pdf.ts:162`, `primitives.ts:151`). `use_claude` defaults false; scholar never calls Claude — it emits a sentinel the host *may* forward to `cowork.askClaude`. Tests: `digest.test.ts:101/113` + `prompts.test.ts:106/115` (default→qwen3:8b, opt-in→sentinel-without-Ollama); `client.test.ts:33/41` pins the default models. See Δ5. |

---

## Δ Changes landed this pass

### Δ1 — INV-5: single-active-session lock implemented (server-scoped)
- **What:** `src/server/session-lock.ts` `acquireSessionLock(runtimeRoot)`; wired into `runServer` **only** (not `runCli`/`buildServer`).
- **Mechanism fork (deliberate):** the spec's literal word is "flock" (and `bin/ensure-bun.sh:30` uses `flock(1)` for its *provisioning* guard — a decoy: it does **not** guard the session). A launcher-held flock would auto-release on death, including SIGKILL. We chose a **TS pidfile** (`O_EXCL` create + `process.kill(pid,0)` liveness reclaim) because a dev `bun run` bypasses the launcher and **win32 has no flock** (`ensure-bun.ps1` already falls back to an atomic lock-dir). The cost is hand-rolled stale-reclaim.
- **Why server-only:** `runCli` (`--call`) is single-shot; Bug #2b runs *many* concurrent CLI processes. An exclusive lock there would break the CLI.
- **Verification (real artifact, `bun run src/server/index.ts`):**
  - server 1 acquires; pidfile holds its real pid;
  - server 2 (same root) refuses with `{"error":"SCHOLAR_LOCKED", …}` + **exit 1**, message names the file and how to recover;
  - SIGTERM to server 1 **releases** the lock;
  - dead-pid / unparseable lockfile → **reclaimed** (unit).

### Δ2 — INV-6: runtime-root dual source collapsed
- **What:** `main()` was inlining `process.env.SCHOLAR_RUNTIME_ROOT ?? join(HOME…, "mcp-data/scholar/runtime")` — byte-identical to `resolveRuntimeRoot()` (`corpus.ts:108`) but a *second* source. Handlers open corpus DBs via `resolveRuntimeRoot()`; `buildServer` opens the config DB via `deps.runtimeRoot`. They aligned only because `main()` happened to match. Now `main()` calls `resolveRuntimeRoot()` → single source, zero behavior change.
- **Not done (deliberate refusal):** threading `runtimeRoot` through `ServerContext` so handlers stop calling `resolveRuntimeRoot()` directly. That is the "real" fix but it **mutates a §7.6 frozen contract** — out of maintenance-mode authority; needs a deliberate spec unfreeze. Recorded, not done.

### Δ3 — F1: graceful stdin-EOF shutdown implemented (was a surfaced follow-up)
- **What:** `src/server/index.ts` `makeServerTeardown(...)` — one idempotent teardown (reap pdf child → release lock → exit) wired to stdin `'end'`/`'close'`, SIGINT, **and** SIGTERM, registered *before* `server.connect()` to avoid an already-EOF race. `index.test.ts` pins the injectable reap+release+exit+idempotency logic (4 cases).
- **Root cause (verified by source reads):** `StdioServerTransport` (SDK `server/stdio.js`) registers only `'data'`/`'error'` on stdin — no `'end'` handler — and the live pdf child keeps the event loop alive, so the server never self-exits on EOF. The host then falls back to its `stdin.end()`→2s→`SIGTERM`→2s→`SIGKILL` ladder (SDK `client/stdio.js`), i.e. a dead ~2s wait on **every** session close, and on Linux the pdf child is orphaned (`lifecycle.ts:388` already named a "scholar's own shutdown handler" that did not exist; `PR_SET_PDEATHSIG` unavailable, Job Object win32-only).
- **Why a direct pid signal, not `handle.shutdown()`:** the pdf child runs the *same* transport and also hangs on its own stdin EOF, so `shutdown()`→`client.close()` would re-incur the ~2s ladder against the child. On a host-driven teardown there is nothing to flush → a direct `SIGTERM` to `childPid` is instant and correct.
- **Also fixes (blind spot caught in review):** the prior SIGINT/SIGTERM handlers released the lock but did **not** reap the child — so the host-SIGTERM path that fires today already leaked the pdf child on Linux. Reap now lives on every path.
- **Verification (real artifact):**
  - `sleep N | bun src/server/index.ts` (faithful EOF-mid-session): **exit 0 in ~2.0s** (pre-fix: 25s+ → `timeout` exit 124); lock file removed; real pdf child (`bun run dist/pdf-server/index.js --stdio`) **reaped dead**, no `--stdio` survivors.
  - SIGTERM path (stdin held open via FIFO to isolate it): **exit 0**, lock removed, pdf child reaped.

### Δ4 — F2: §13 INV-8 verified (was "unverified"); CLAUDE.md corrected
- **Finding:** the audit's worry ("no literal `transaction(` token") was correct but benign — the `db.transaction` reconciler was **retired** in the 2026-05-27 §13 v1.1 amendment (spec §13 lines 1186–1192; `server-pdf@1.7.2` exposes no enumeration verb). v1.1 is **write-then-push**, a *stronger* guarantee than "no awaits inside the txn": there is no transaction window at all. `handleUpsert`/`handleDelete` do read-check → **no await** → single-statement `.run()` → `await pdf.interact` (push after commit). On the single-threaded loop the await-free read→write window is effectively atomic (no TOCTOU), and concurrent `annotations.list` (a pure sync read) never contends with an open write lock.
- **Enforcement:** by-construction (no `db.transaction`; single-statement writes) **and** in-test — `annotations.test.ts` snapshots DB state inside the `interact` mock to prove the write committed before the push, for both upsert (`:202`) and delete (`:321`), plus a dirty-row-persists-on-push-throw failure-safety case (`:280`). All 24 annotations tests green.
- **Doc fix:** CLAUDE.md §13 invariant rewritten (it had described the retired v1.0 `db.transaction` model — same "documented invariant describes dead code" shape as the earlier flock→pidfile correction). Also synced the INV-1 line: the lock now releases on stdin EOF too (F1/Δ3), so the prior "stdin-EOF-hung holder" caveat no longer applies — only a hard SIGKILL leaves a reclaimable file.
- **No code change** — the implementation was already correct.

### Δ5 — INV-9 + INV-10 verified (were "unverified"; no code change)
- **INV-9 (`raw-ddl.ts`):** confirmed `chunk_vec` (deferred vec0 virtual table) and `reading_queue` (view) are owned by `raw-ddl.ts`, created via `runRawDdl(db)` which `migrations.ts:65-66` invokes **after** Drizzle `migrate()`; `schema.ts:127,267` annotates both as "NOT Drizzle". Enforced-in-code (sole creation path + ordering) and in-test (`raw-ddl.test.ts`: vec0 ABI smoke, chunk_vec materialization, M4/A1 settings-desync invariant errors).
- **INV-10 (Ollama default / askClaude opt-in):** confirmed `digest.ts:128` and `prompts.ts:120` take the local Ollama path (`ollama.chat(DEFAULT_CHAT_MODEL)` = qwen3:8b) unless `use_claude === true`, which only returns a sentinel for the host to forward — scholar never calls Claude itself. Embeddings default to `ollama.embed(DEFAULT_EMBED_MODEL)` (nomic-embed-text:v1.5). Enforced-in-test (`digest.test.ts`, `prompts.test.ts`, `client.test.ts`).

### Δ6 — INV-1 §12.0 boundary coverage verified + behaviorally pinned (was the last convention-only row)
- **Reframing (load-bearing).** "Every boundary routes through a §12.0 primitive" is the *wrong* invariant — and a naive check enforcing it would be the exact bluffing test this audit exists to kill. Parameterized SQL binding is the §12.0-sanctioned no-primitive path (CLAUDE.md §12.0 forbids "bare string concatenation into prompts, paths, or HTTP requests" — bound `?` values are not concatenation). So the honest coverage claim is **per-module, justified by what the untrusted input flows into**, not by "imports a primitive".
- **Boundaries that DO use a primitive — enforced-in-test:**
  - **ingest** (`ingest.ts`): `validateArxivId` / `encodeDoi` / `resolveUnderRoot` on arXiv id, DOI, pdfPath. Proven to fire: `ingest.test.ts:168` (PathEscapeError, pdf outside roots), `:176` (InvalidDoiError), `:184` (InvalidArxivIdError).
  - **digest / prompts** (`digest.ts`, `prompts.ts`): `sanitizeText` + `wrapUntrusted` wrap paper title/abstract in a per-request nonce envelope before the LLM. Proven: `digest.test.ts:84-99` (user msg carries `<untrusted_data id="…">`, system prompt carries the §12.0 clause), `:119` (askClaude path also wrapped), `prompts.test.ts:105`.
  - **annotations** (`annotations.ts`): `sanitizeText` on user-supplied body **and** anchor (`:197-198`); proven in-test — `annotations.test.ts:461` (body bidi-override U+202E rejected *before* DB write or `pdf.interact`) and `:476` (anchor bidi-override rejected).
  - The primitives themselves are unit-proven against hostile input in `primitives.test.ts` (U+202E bidi + Unicode-tag-block rejection, NFC normalize, length cap; parent-traversal + symlink-leaf + missing-root `PathEscapeError`; malformed DOI/arXiv rejection).
- **Boundaries that correctly use NO primitive — justified per module:**
  - **papers** (`papers.ts`): untrusted `q` → `%${q}%` **bound via `?`** (`:101`,`:107`); the dynamic `UPDATE` SET clause is built from a **fixed column-token enum**, values bound via `?` (`:190-216`, comment `:214-215`). Injection is defused by binding, not a primitive. **Now pinned behaviorally** — `papers.test.ts` "SQL-injection safety": a `'; DROP TABLE papers; --` query is matched as a *literal substring* (the load-bearing assertion — a refactor to interpolation closes the string literal early and turns it red), plus a weaker assertion that the table survives (which guards a future switch to a multi-statement exec path).
  - **roots** (`roots.ts`): the `path` arg is a **user-designated** corpus root (trusted by definition — the user is naming their own filesystem location), stored via parameterized SQL (`:45` drizzle tagged-template; `:65-70` `?` binds). Traversal *within* a root is confined later, at read-time, by `resolveUnderRoot` in the ingest boundary.
  - **snapshot** (`snapshot.ts`): all values flow through parameterized SQL (`:68-69` `INSERT … VALUES (?, ?, ?, ?)`); no path / prompt / HTTP sink.
  - **inspect** (`inspect.ts`): read-only schema introspection — `z.object({}).passthrough()` (`:67`) over static `sqlite_master` SELECTs (`:42-49`); takes no untrusted input that reaches a sink.
- **Ratchet deliberately NOT added.** A "new tool module must import a primitive" structural check was considered and rejected: it catches only a *new unclassified module*, not the realistic regression (a new unsafe sink added to an *already-classified* module — e.g. string-built SQL appearing in `papers.ts` later). That failure mode is caught instead by the behavioral binding test above. A structural ratchet would add the *appearance* of enforcement without its substance — the precise thing this audit exists to remove.
- **No source change to the boundaries** — investigation found no real §12.0 defect; the only code added is the one behavioral regression test (`papers.test.ts`).

---

## Surfaced follow-ups (NOT actioned)

### F3 — pid-reuse residual hazard (mitigated, documented)
- A dead holder's pid recycled to an unrelated live process reads as "alive" → false `SCHOLAR_LOCKED`. Inherent to pidfile locking. Mitigated by the self-rescuing error message. Documented in `session-lock.ts`.

---

## Next rows to grind
All ten matrix rows are now classified at `enforced-*` or justified `convention-only`. Remaining deliberate work:
- **§7.6 unfreeze (row 3):** thread `runtimeRoot` through `ServerContext` so handlers stop calling `resolveRuntimeRoot()` directly — the "real" fix deferred in Δ2 as out-of-maintenance-authority. Mutates a frozen §7.6 contract, so it needs a deliberate spec unfreeze; selected as the next thread.
- **F3:** pid-reuse residual — accepted/documented (above), not selected.

*(INV-8 done — Δ4; INV-9, INV-10 done — Δ5; INV-1 §12.0 done — Δ6.)*

# Scholar v1 Production-Readiness Roadmap

**Created:** 2026-05-27
**Source:** `2026-05-27-synthesis.md` + AgentA/B/C reports.
**Scope:** Personal-use v1 ship. Defensive hardening (M-class) optional.

---

## Decision log

| Decision | Choice | Rationale |
|---|---|---|
| §13 reconciler architecture | **(A) drop inbound reconciliation** | Personal-use scope. Forking the vendor (option B) violates §7.2; `get_viewer_state` (option C) only returns selected-annotation IDs, not the full set. |

---

## Showstopper batch (S1–S3) — must land first

### S1 — pdf-viewer interop rewrite + §13 spec amendment ✅ landed 2026-05-27

Branch: `worktree-pre-v1-roadmap` (consolidated showstopper branch; S1 commits 04a39ed → 6dd56cf, cherry-picked from the now-deleted `worktree-s1-pdf-interop-and-13-amendment`).

- [x] **Spec edit** §13 v1.1 — inbound reconciliation removed; one-way push contract documented; all 6+ `list_annotations` references purged (commit 04a39ed).
- [x] **Spec edit** §7.6 PdfChild contract — `interact(cmd, {viewUUID, ...})`; envelope `{type, ...rest}` → `{viewUUID, action: type, ...rest}` translation pinned. `displayPdf()` added as a sibling vendor tool (commits 04a39ed, 6dd56cf).
- [x] **Spec add** §16 vendor-tool truth invariant — vendor commands.d.ts pinned as source of truth (commit 04a39ed).
- [x] **Code** `src/server/pdf/lifecycle.ts` `interact()` rewrite + `getText()` routed through interact + `displayPdf()` added (commit 5500004).
- [x] **Code** `src/server/tools/pdf.ts` `refreshExtraction` viewUUID lookup via `ctx.pdfViews`; new `scholar.pdf.open` tool registers viewUUIDs; broken v1.0 proxies dropped (commit d97f3cf).
- [x] **Code** `src/server/tools/annotations.ts` push-only rewrite + serializeForViewer maps scholar rows → vendor's NoteAnnotation shape (commit d97f3cf).
- [x] **Test** real-vendor contract test `src/server/pdf/lifecycle.contract.test.ts` — navigate + add/remove_annotations envelopes, gated by `SCHOLAR_PDF_E2E=1` (commit d47298e; both fixtures pass against the real vendor process).
- [x] **Test** `annotations.test.ts` rewritten — 22 tests covering NO_OPEN_VIEWER, write-then-push, idempotency, vendor note shape; v1.0 reconciler tests (Red-4/5/7b/7c/8b/9) retired with the reconciler (commit d97f3cf).

### S2 — CLI mode argv + SIGINT ✅ landed 2026-05-27

Branch: `worktree-pre-v1-roadmap` (S2 commits 2454b4c → 8e204ec; precedes S1 on the branch since S2 was authored first off `main`, then S1 cherry-picked atop).

- [x] **Code** `scripts/start-server.ts`: replace `Bun.$` with `Bun.spawn`; forward `process.argv.slice(2)` to the child.
- [x] **Code** `scripts/start-server.ts`: SIGINT handler forwards to the child; parent awaits `child.exited` and propagates its code instead of `process.exit(0)`.
- [x] **Test** `tests/start-server.test.ts` — fixture stub `build/scholar` binary asserts `--help` reaches the child (stdout marker + exit 0).
- [x] **Test** `tests/start-server.test.ts` — same fixture, `--block` mode installs a child SIGINT handler exiting 42; the test sends SIGINT to the parent and asserts exit 42 (not 0).

### S3 — Ollama client timeouts ✅ landed 2026-05-27

Branch: `worktree-pre-v1-roadmap` (S3 commit 6dbd990).

- [x] **Code** `src/server/ollama/client.ts` `postJson()` parameterized with `timeoutMs`; `AbortSignal.timeout` wired through; `TimeoutError` mapped to `OllamaUnavailableError`. Defaults: embed 60s, chat 120s. Env-overridable via `SCHOLAR_OLLAMA_{EMBED,CHAT}_TIMEOUT_MS` so tests can use short windows.
- [x] **Code** `embed()` passes `embedTimeoutMs()`; `chat()` passes `chatTimeoutMs()` — both methods (not stored constants) so env-var overrides take effect at call time, mirroring `baseUrl()`.
- [x] **Test** `src/server/ollama/client.test.ts` — two regression tests using a `Bun.serve` fixture whose fetch handler returns a never-resolving promise; env override sets a 250ms timeout; assertion: throws `OllamaUnavailableError` in well under 5s (would hang indefinitely without the fix). Pre-fix the tests deadlock the runner; post-fix they pass in ~0.5s.

---

## High-priority batch (H1–H5) — land before personal-use ship

| ID | Defect | File:line | Fix |
|---|---|---|---|
| H1 | `corpus.export` shells `sh -c` with interpolation | `corpus.ts:384-387` | Replace with `Bun.spawn([cp, src, dest])` direct argv |
| H2 | View-opener tools wrap structured response into `text` block | `registry.ts:168-173` | Detect `result.openView` and emit `structuredContent` |
| H3 | `papers.test.ts` divergent inline DDL hides schema drift | `papers.test.ts:43-49` | Use `applyMigrations` against in-memory DB; delete inline DDL |
| H4 | `resolveVec0Path` uses `process.cwd()` | `sqlite-vec.ts:24-35` | Use `import.meta.dir` with relative traversal |
| H5 | No PRAGMA assertion in `applyMigrations` | `migrations.ts:39-55` | Assert `PRAGMA foreign_keys` is on before migrate |

Each H-item: one TDD cycle, regression test mocks at the layer above the bug (not the layer containing the bug).

---

## Medium-priority batch (M1–M9) — optional defensive hardening

Land as a single follow-up plan or skip until first real-world bug bites.

| ID | Defect | File:line | Why deferrable |
|---|---|---|---|
| M1 | `runtime-config.ts` no parent-dir fsync after rename | `runtime-config.ts:24-49` | App-crash bar met; OS-crash gap rare |
| M2 | Win32 Job Object attach-after-spawn race | `lifecycle.ts:148-155` | Microsecond race window |
| M3 | Float32Array view binding risk | `papers.ts:115-122` | Bun handles correctly; defensive |
| M4 | Settings serialization mismatch (`pdf.ts` writer vs `raw-ddl.ts` reader) | `pdf.ts:105-112` / `raw-ddl.ts:42-47` | Single field |
| M5 | RRF LIMIT 200 truncation bias | `papers.ts:115-122` | Acceptable at v1 corpus scale |
| M6 | Chunker tail-chunk insufficient new content | `chunker.ts:31-39` | Low-impact edge |
| M7 | `countBundledMigrations` swallows errors | `migrations.ts:68-77` | Defensive logging only |
| M8 | Phase-2 throw timing in `annotations.ts` | `annotations.ts:254-256` | Self-healing per §13; add test only |
| M9 | `resolveUnderRoot` doesn't wrap `realpathSync(root)` ENOENT | `primitives.ts:75-91` | Fires only on backup-dest path |

---

## Effort estimate

| Batch | Estimate | Outputs |
|---|---|---|
| S1 | 1–2 sessions | Spec amendment + transport rewrite + reconciler rewrite + contract test |
| S2 | <1 session | Two small fixes + tests |
| S3 | <1 session | Two fetch wraps + tests |
| H1–H5 | 1 session | Five small TDD cycles |
| M1–M9 | 1 session (or skip) | Nine defensive patches |

**Critical path to personal-use v1:** S1 + S2 + S3 + H1–H5 ≈ 3–4 focused sessions.

---

## Workflow

Each batch should be:

1. A chore opened in `.claude/context/chores.xml` against the appropriate blast-radius.
2. Or a single plan-md if the work is plan-shaped (S1 likely warrants this since it touches spec + multiple modules).

S1 is plan-shaped (spec edit + multi-module rewrite + new test surface). S2, S3, H1–H5 are chore-shaped (single-module fixes).

M-batch can be a single hardening plan or deferred indefinitely.

---

## Out of scope (filed elsewhere)

- Spec-pipeline governance work (G1–G5 + adjacent forensics) — tracked in `~/code/claude-lib/.claude/context/chores.xml` chore 95 → `docs/2026-05-27-scholar-audit-deferrals.md`.
- Claude-marketplace subrepo retirement — `~/code/claude-lib/.claude/context/chores.xml` chore 94.

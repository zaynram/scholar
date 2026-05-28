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

### S1 — pdf-viewer interop rewrite + §13 spec amendment

- [ ] **Spec edit** `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` §13: drop inbound reconciliation phase. Document the one-way push contract. Remove every `list_annotations` reference (6+ sites).
- [ ] **Spec edit** §7.6 `PdfChild` contract: change `interact(commands: PdfCommand[])` → `interact(cmd: PdfCommand)`. Wire envelope translates `{type, ...rest}` → `{action: type, ...rest}` at transport boundary. Cite `src/vendor/pdf-server/dist/src/commands.d.ts` as source of truth for the `PdfCommand` union.
- [ ] **Spec add** §16 vendor-tool truth invariant: every command name in the spec must be exported by `src/vendor/pdf-server/dist/server.js`. The spec MAY NOT invent vendor capabilities.
- [ ] **Code** `src/server/pdf/lifecycle.ts` `interact()`: rewrite to take a single `PdfCommand`, translate `type` → `action`, always call `callTool({ name: "interact", arguments: {...} })`. Drop the per-command tool-name routing at `lifecycle.ts:208`.
- [ ] **Code** `src/server/tools/pdf.ts:244` envelope: route through `lifecycle.interact()`. Delete the `{tool, args}` envelope.
- [ ] **Code** `src/server/tools/annotations.ts`: rewrite reconciler against the chosen §13 path. Drop the `list_annotations` enumeration phase. Treat DB as source of truth; push-only outbound.
- [ ] **Test** add a contract-level test that spawns the actual vendor process and exercises at least one real `interact` call. Pick `navigate` as the smoke target (simplest payload).
- [ ] **Test** rewrite `annotations.test.ts` injections to mock at the `lifecycle.interact()` boundary, not at the handler's `ctx.pdf.interact` injection point — that gap is what hid the bug.

### S2 — CLI mode argv + SIGINT ✅ landed 2026-05-27

Branch: `worktree-s2-cli-argv-sigint` (off `main`, post-S1 audit batch).

- [x] **Code** `scripts/start-server.ts`: replace `Bun.$` with `Bun.spawn`; forward `process.argv.slice(2)` to the child.
- [x] **Code** `scripts/start-server.ts`: SIGINT handler forwards to the child; parent awaits `child.exited` and propagates its code instead of `process.exit(0)`.
- [x] **Test** `tests/start-server.test.ts` — fixture stub `build/scholar` binary asserts `--help` reaches the child (stdout marker + exit 0).
- [x] **Test** `tests/start-server.test.ts` — same fixture, `--block` mode installs a child SIGINT handler exiting 42; the test sends SIGINT to the parent and asserts exit 42 (not 0).

### S3 — Ollama client timeouts

- [ ] **Code** `src/server/ollama/client.ts:60-83`: wrap embed fetch in `AbortSignal.timeout(60_000)`; surface `OllamaUnavailableError` on timeout.
- [ ] **Code** `src/server/ollama/client.ts:85-96`: wrap chat fetch in `AbortSignal.timeout(120_000)`; same error shape.
- [ ] **Test** add timeout tests using a fixture server that hangs past the timeout.

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

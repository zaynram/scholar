# Scholar Audit Synthesis — Cross-Repo Forensic Action Plan

**Generated:** 2026-05-27
**Scope:** Three-axis investigation across scholar/, the design spec, and `~/code/claude-lib` (spec-pipeline).
**Sources:** `AgentA-report.md` (20 source-level findings), `AgentB-report.md` (pdf-server interop deep dive), `AgentC-report.md` (cross-repo governance gap analysis). Reports archived alongside this synthesis.

---

## Part 1 — Showstopper triad (must fix before v1)

These three defects compound into one failure: **the pdf-viewer interop layer is broken end-to-end and was never structurally validated.**

### S1. `pdf.interact` — every layer disagrees, *and* the chosen envelope shape is wrong against the vendor

Primary-source read of `src/vendor/pdf-server/dist/server.js`:

- The vendor exposes **ONE MCP tool**: `interact` (`server.js:30859`), plus `poll_pdf_commands` (`server.js:31094`) and `list_pdfs` (`server.js:30069`).
- `interact` accepts a flat object: `{action, viewUUID?, page?, query?, matchIndex?, scale?, annotations?, ids?, color?, content?, fields?, intervals?, path?, overwrite?}` (`server.js:30422-30451`).
- The discriminator field is **`action`**, NOT `type`. Valid actions: `navigate, search, find, search_navigate, zoom, add_annotations, update_annotations, remove_annotations, highlight_text, fill_form, get_text, get_screenshot, get_viewer_state, save_as`.
- The vendor does **not** accept a `commands: [...]` array. One command per `interact` call.

Scholar's layers all encode this wrong, and each layer is wrong differently:

| Layer | What scholar sends | What the vendor expects |
|---|---|---|
| `annotations.ts:235-237, 254, 268, ...` (caller) | `pdf.interact([{type: "list_annotations" \| "add_annotations" \| ...}])` — uses `type`, sends an array, references the invented `list_annotations` | one `interact` call per command, field name `action`, no `list_annotations` capability |
| `lifecycle.ts:204-211` (transport) | strips `type` from the command object and calls `callTool({ name: type, arguments: rest })` — treats `type` as an MCP tool name | the MCP tool name is *always* `"interact"`; `action: type` goes into `arguments` |
| `pdf.ts:237-249` (proxy) | uses `{tool, args}` envelope — different again from `lifecycle.ts` | same shape as above; both proxy and transport are wrong, in different ways |
| `lifecycle.ts:217` | `callTool({ name: "get_text", ... })` — treats `get_text` as a tool name | `get_text` is an `action`, not a tool name |

**Verified: this routing is broken for every command, not just `list_annotations`.** The vendor exposes one tool (`interact`); scholar treats the `PdfCommand.type` field as the MCP tool name and skips the wrapping tool. The `list_annotations` invention is the loudest symptom but the entire transport layer is misaligned.

**Why nothing caught this in tests:** `annotations.test.ts` injects a fake `pdf.interact` directly into the handler context. The fake never sees the broken transport. The transport never sees a real vendor surface. The vendor surface is never reached. The test mocks the bug it is supposed to find. Same pattern in `pdf.test.ts`.

**Spec contribution:** §13 (reconciler) and §7.6 (`PdfChild` contract) describe a `list_annotations` call against the pdf-viewer that has no protocol implementation in v1.7.2. Six §13 paragraphs depend on it. AgentB confirmed by reading `dist/server.js`: no `list_annotations` string anywhere.

**Option (C) verification result — NOT a viable escape hatch.** Per `server.js:30902`: `get_viewer_state` returns `{currentPage, pageCount, zoom, displayMode, selectedAnnotationIds, selection: {text, contextBefore, contextAfter, boundingRect} | null}`. It only returns IDs of *selected* annotations, not the full annotation set. Cannot back §13 inbound reconciliation.

**Spec amendment required (showstopper, user decision):** Either
- **(A) drop inbound reconciliation** — treat scholar→viewer as one-way push, accept that user-created annotations in the viewer are not reflected back to scholar's DB until the viewer adds an enumeration capability upstream. Minimum-scope path; cleanest spec edit.
- **(B) fork the vendored package** — add a `list_annotations` action upstream and either patch the vendor or fork it. Violates the "unmodified vendor" invariant in CLAUDE.md and §7.2, demoting the cleanest claim in the design.

**Recommendation: (A).** Personal-use scope does not justify forking the upstream MCP server.

**Code amendment required (regardless of which spec path):**
1. Rewrite `lifecycle.ts:interact()` to take a single `PdfCommand`-shaped object (drop the array), translate the internal `type` field to `action`, and always call `callTool({ name: "interact", arguments: {...} })`.
2. Reconcile `pdf.ts:244` to call through the same `lifecycle.interact()` rather than re-implementing the envelope.
3. Rewrite `annotations.ts` reconciler against the chosen §13 path (likely: drop list-style enumeration; treat the DB as the source of truth and push only).
4. Add a contract-level test that spawns the actual vendor process and exercises at least one real `interact` call. The current test harness cannot detect this entire bug class.

### S2. CLI mode is dead on arrival

`scripts/start-server.ts` ships the compiled-binary launcher with **no argv forwarding** (AgentA #1, confidence 95) — `Bun.spawn(["/path/to/scholar"])` ignores `process.argv.slice(2)`. The CLI subcommands (`scholar serve`, `scholar build`, etc., per §8) cannot be invoked. The `--help` flag never reaches the binary.

Compounding (AgentA #2, confidence 90): the SIGINT handler at `start-server.ts:5` immediately calls `process.exit(0)`, masking child exit codes. A Ctrl-C during a corpus operation reports success even if the child died mid-write.

**Fix (one commit):** Forward `process.argv.slice(2)` into `Bun.spawn`; on SIGINT, forward to child and `await` its exit, propagating the child's exit code.

### S3. Ollama client has no timeout

`src/server/ollama/client.ts:60-83, 85-96` (AgentA #3, confidence 90): `fetch(url, {...})` with no `AbortSignal.timeout(...)`. A hung Ollama (model not loaded, GPU stuck, OOM) wedges scholar indefinitely. This is the embedding path that gates ingestion and search.

**Fix:** Wrap fetch in `AbortSignal.timeout(60_000)` for embed, `120_000` for chat; surface `OllamaUnavailableError` on timeout. No retry inside the client — leave that to callers who understand the cost.

---

## Part 2 — High-priority defects (block production for personal use)

| # | Defect | Location | Confidence | Fix sketch |
|---|---|---|---|---|
| H1 | `corpus.ts:384-387` shells `sh -c` with interpolated `${src}`/`${dest}` — broken on win32, future injection vector | corpus.ts:384 | 80 | Replace with `Bun.$` or `Bun.spawn([cp, src, dest])` direct argv |
| H2 | `registry.ts:168-173` wraps tool results into `text` content blocks — view-opener tools (dashboard, paper.show, progress, digest) ship the `openView` envelope as a JSON string inside `text`, so the host re-parses or misses it entirely | registry.ts:168 | 70 | Detect `result.openView` and emit `structuredContent` per MCP 2025+ spec |
| H3 | `papers.test.ts:43-49` defines a divergent inline DDL that does not match the migration-generated schema — tests pass against the test fixture, prod runs against the real schema | papers.test.ts:43 | 85 | Use `applyMigrations` against an in-memory DB for the test setup; delete the inline DDL |
| H4 | `sqlite-vec.ts:24-35` resolves vec0 path against `process.cwd()` — packaged binary launched from any cwd ≠ repo root cannot find vec0 | sqlite-vec.ts:24 | 60 | Use `import.meta.dir` with relative traversal; keep `CLAUDE_PLUGIN_ROOT` override as the packaged-binary case |
| H5 | `migrations.ts:21` runs `PRAGMA foreign_keys = ON` per-connection at `openWithPragmas` correctly, but test code paths can bypass `openWithPragmas` and open raw `Database` — no assertion catches this | migrations.ts:39-55 | 60 | Add an assertion in `applyMigrations` that PRAGMA is on before migrate runs |

---

## Part 3 — Medium-priority defects (file as chores, do not block v1)

| # | Defect | Location | Conf. | Why deferrable |
|---|---|---|---|---|
| M1 | `runtime-config.ts:24-49` rename atomicity without parent-dir fsync | 70 | Application-crash bar is met; OS-crash gap is rare |
| M2 | `lifecycle.ts:148-155` Win32 Job Object attach-after-spawn race | 70 | Race window is microseconds; cleanup-on-parent-death is the primary use |
| M3 | `papers.ts:115-122` Float32Array view binding risk | 60 | Bun's bun:sqlite handles this correctly; flagged defensively |
| M4 | `pdf.ts:105-112` vs `raw-ddl.ts:42-47` settings serialization mismatch | 60 | Single field, easy to align |
| M5 | `papers.ts:115-122` LIMIT 200 truncation bias on vec KNN | 65 | Recall acceptable at v1 scale; revisit when corpus > 5k chunks |
| M6 | `chunker.ts:31-39` tail-chunk with insufficient new content | 60 | Edge case, low practical impact |
| M7 | `migrations.ts:68-77` `countBundledMigrations` swallows errors silently | 65 | Defensive logging, not correctness |
| M8 | `annotations.ts:254-256` phase-2 throw before cursor advance | 65 | Self-healing per §13 constraint; add regression test |
| M9 | `primitives.ts:75-91` `resolveUnderRoot` doesn't wrap `realpathSync(root)` failure | 65 | Backup-dest path; only fires when root ENOENT |

---

## Part 4 — Spec-pipeline (claude-lib) governance gaps

AgentC's cross-repo analysis lands on a structural pattern:

> spec-pipeline's hardened gates (XSD) only protect the registry layer. Its plan-md and execution layers rely on textual protocols + LLM review — exactly the gate shape that chore #89 documented as silently override-able. Scholar's bug class is the broader-surface symptom of the same root cause.

Five proposed governance chores, mapped to scholar bug classes:

| Proposal | Class | Mechanism | Scholar bug it would have caught |
|---|---|---|---|
| **G1** vendor-tool reality check at ingest-spec | external-reality (Class 1) | `vendor_tool_reference_check.py` greps spec for tool-name patterns, verifies against `src/vendor/*/dist/*.js` | `list_annotations` invented by spec |
| **G2** load-bearing-invariant citation rule | spec→plan binding (Class 3+4) | extend structural-validation rule (f) — cited §X invariant must name enforcement gate | §13 no-await-in-tx, §12.0 primitives mandate |
| **G3** smoke-build completion criterion | build orchestration (Class 5) | add criterion to `exec-plan.xml` requiring smoke invocation of artifact | noop-wiring + comma-typo bugs in build-vec0 (already fixed but never structurally prevented) |
| **G4** spec-internal-consistency lint | spec self-contradiction (Class 6) | `spec_consistency_check.py` at `ingest-spec` step 2 + 4 | hypothetical pattern detection |
| **G5** test-rigor audit gate | consumer-test fidelity (Class 2) | multi-component — mock-surface-detection + plan-md schema extension + test-runner integration | `annotations.test.ts` mocking the buggy surface; `papers.test.ts` schema drift |

**Triage call (mine, advisory):** G1 + G3 are the highest-leverage shovel-ready fixes — concrete scripts wired into existing XSD-gated steps. G2 is the most architecturally important but threads through the structural-validation rule set and needs careful invariant authoring. G4 is general-purpose insurance. G5 is research-grade and should be a separate plan-review.

---

## Part 5 — Recommended chore openings (claude-lib unstable) — DRAFT PROSE

> Each synopsis below is draft prose, NOT ready-to-paste XML. Before insertion into `chores.xml`, each must be:
> - trimmed to ≤250 characters (XSD `maxLength` on `synopsis`),
> - have all `<`, `>`, `&` escaped (`&lt;`, `&gt;`, `&amp;`),
> - validated with `xmllint --noout --schema .claude/context/chores.xsd .claude/context/chores.xml`.
>
> See chore 94 commit history (commits 6fbba34 → d667d89 → c358751 → 89226ed) for the exact pattern.

**Chore: `vendor-tool-reality-check`**
Synopsis (draft): Add a script to grep design specs for backtick-quoted lowercase identifiers near "mcp"/"pdf"/vendored-package mentions and verify each is exported by `src/vendor/*/dist/*.js` or declared in a consumer manifest. Wire into `ingest-spec` step 4 as a halt-on-mismatch gate. Origin: scholar audit 2026-05-27, AgentC Proposal 1.

**Chore: `load-bearing-invariant-citation-rule`**
Synopsis (draft): Extend structural-validation in `spec-to-multi-plan` with rule f — every spec-cited load-bearing invariant referenced in a plan-md must name its enforcement gate. Closes the §13/§12.0 prose-only citation gap. Origin: scholar audit 2026-05-27, AgentC Proposal 2.

**Chore: `smoke-build-completion-criterion`**
Synopsis (draft): Add a smoke-build criterion to `exec-plan`/`exec-multi-plan` completion blocks. Plan-md declares a smoke command + expected artifact path; closure gate runs it. Catches build-orchestration cascade bugs that `pixi run check` misses. Origin: scholar audit 2026-05-27, AgentC Proposal 3.

---

## Part 6 — Recommended spec amendments (scholar repo)

These amend `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md`:

### A1 — §13 reconciler redesign (showstopper)
Drop inbound reconciliation from v1 (recommended path A above). Treat scholar→viewer as one-way push. Re-spec §13 to remove `list_annotations`, drop the inbound dirty-flag phase, and document that user-created annotations in the viewer are not reflected back to scholar's DB in v1.

### A2 — §7.6 `PdfChild.interact` signature
Replace the `commands: PdfCommand[]` envelope. The vendor accepts one command per `interact` call with the discriminator field `action` (not `type`). New signature: `interact(cmd: PdfCommand): Promise<...>` where `PdfCommand` is the typed union derived from `src/vendor/pdf-server/dist/src/commands.d.ts`, but the wire envelope translates `{type, ...rest}` → `{action: type, ...rest}` at the transport boundary.

### A3 — §12.0 primitives enforcement
Require every plan-md to declare which primitives its blast radius depends on AND name the test that asserts non-bypass. Today the mandate is honored in spirit but not structurally bound.

### A4 — §16 vendor-tool truth invariant (new load-bearing invariant)
Add: "Every command name referenced in this spec MUST be exported by `src/vendor/pdf-server/dist/server.js` (verified by `scripts/check-vendor-tools.sh`). The spec MAY NOT invent vendor capabilities." This is a tombstone preventing the §13 bug class from recurring.

---

## Part 7 — Suggested execution sequence

**Now (durable):**
1. User decision on §13 path. Recommendation: option (A) drop inbound reconciliation.
2. File the three governance chores (Part 5) against `~/code/claude-lib` unstable — trim + escape before paste.

**Next exec-plan cycle (scholar):**
3. Land showstopper fixes S1, S2, S3 as a single chore-typed batch (cross-cuts annotations/pdf/lifecycle/start-server/ollama; blast radius warrants it).
4. Land H1-H5 as follow-up cycles, each TDD-driven with a regression test that mocks at the *right* layer (one above the bug, not the layer containing the bug).

**Subsequent waves:**
5. Land M1-M9 as a single hardening plan.
6. Land governance chores G1/G3 first (mechanical), then G2 (architectural).

---

## Confidence summary

- **AgentA**: 20 findings at 60-95 confidence, source-grounded with `file:line(range)` citations, surfaces-cleared manifest demonstrates scope completion.
- **AgentB**: deep dive on PdfCommand union, primary-source vendor read, confirmed `list_annotations` absence.
- **AgentC**: cross-repo governance frame, identified that all scholar bugs trace to gate-type misfit (textual protocol where structural lint was needed), proposed five concrete gates.
- **This synthesis**: primary-source vendor read at `server.js:30422-30451` and `server.js:30902` confirmed the wire protocol (one `interact` tool, `action` discriminator, no array, no `list_annotations`); ruled out option (C) by reading the `get_viewer_state` response schema.

The single biggest leverage move is **A4 (vendor-tool truth invariant)** + **G1 (vendor-tool reality check script)** — together they close the failure mode that produced the worst bug in the scholar codebase. Everything else is hygiene.

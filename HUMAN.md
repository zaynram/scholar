# HUMAN.md — operator actions Claude can't complete autonomously

Things that need *you* (real hardware, accounts, external installs, or upstream
repos). Created 2026-06-02. Delete items as you clear them.

---

## 1. Ollama models — RESOLVED ✅ (2026-06-03)

Scholar talks to Ollama over the REST API (`/api/tags`, `/api/embeddings`,
`/api/chat`) at `SCHOLAR_OLLAMA_URL` (default `http://127.0.0.1:11434`). On this
machine that is served by the GPU-accelerated **ipex-llm-ollama** systemd
service (`~/.ipex-llm-ollama`, Intel iGPU via Level Zero/SYCL), which binds the
same default host:port — so **no config change is needed**.

Verified end-to-end through scholar's own `src/server/ollama/client.ts`:

- `ipex-llm-ollama.service`: enabled + active + reachable at the default URL.
- `nomic-embed-text:v1.5` pulled (274 MB) — `/api/embeddings` → **768-dim** vector.
- `qwen3:8b` pulled (5.2 GB) — `/api/chat` → clean answer (`hasThinkTag=false`).

**Thinking-model handling:** qwen3:8b is a reasoning model; left alone it prefixes
answers with a `<think>…</think>` monologue that would leak into digests. Scholar
now passes `think:false` **and** defensively strips any residual block in
`chat()`. Swapping to a non-thinking model via `SCHOLAR_OLLAMA_CHAT_MODEL` leaves
that handling as a harmless no-op. (A different *embed* model would change the
vector dimension — start a fresh corpus, don't mix dims.)

If the service ever stops: `sudo systemctl start ipex-llm-ollama` (it's enabled,
so it also comes up on boot).

---

## 2. Run the end-to-end smoke test  ⟵ the real gate to "reliable daily use"

Nothing has driven a live corpus workflow yet (only unit/contract/headless
tests). Follow **`docs/runbooks/e2e-smoke-test.md`**. Highest-risk leg: the
annotation + PDF-viewer path (§7), which has *zero* automated coverage because it
hangs headless — a live viewer is the only way to prove it works. Do this in a
real Claude Code session so it also validates install + spawn (G3).

**Update 2026-06-03 — the pdf-child blocker is cleared.** Driving the first real
smoke test surfaced that production never spawned the pdf child (#3) and that
`corpus.activate` both hard-failed on an absent child (#2a) and never opened
`ctx.db` on a fresh process with a persisted active corpus (#2a′) — so steps 3 & 7
would have thrown `PDF_CHILD_UNAVAILABLE` / no-active-corpus in your session. All
three are now fixed (TDD, suite 334/0) and confirmed headless: a fresh
runServer-shape process against your real `daisy-lit-review` corpus now activates
to a **live** pdf child (`pdf_child.alive=true`) with `ctx.db` open. So when you log
in: `scholar.corpus.activate {slug:"daisy-lit-review"}` should return
`pdf_child.alive=true` — that field is your discriminator. If you ever see
`alive=false`, the child failed to spawn (check stderr), NOT that the wiring is
missing. Steps 1-6 logic + Ollama were already driven green headless; the live
session is for the **viewer/annotation leg (step 7)**, which can only be proven by a
human at the desktop. Steps 2/4/5/6 via the **nu CLI** remain blocked on #2b (§4).

**Also fixed: the packaged plugin could never migrate a DB (Bug #5).** Driving the
real `dist/server.js` bundle (what the manifest actually launches, not `src/`)
revealed the drizzle migrations were never staged into `dist/` — so the bundled
server died on the first DB op with `Can't find meta/_journal.json`. `build:server`
and `scripts/build-plugin.ts` now stage `src/server/db/migrations → dist/migrations`
(new `scripts/stage-migrations.ts`); the real bundle was then driven over stdio
host-shape and activates to a live pdf child against your real corpus. **Action for
you:** if you run an *installed* `scholar.plugin` (not the dev checkout), rebuild +
reinstall (`bun run build:linux` → `out/scholar.plugin`) so the install carries the
staged migrations. If you point `CLAUDE_PLUGIN_ROOT` at this checkout, `dist/` is
already rebuilt and ready.

---

## 3. Reconcile the spec-pipeline registry XSDs upstream  (dropped chore)

The chore `redesign-registry-schemas` was **dropped** from scholar's
`.claude/context/chores.xml` (2026-06-02) — it's spec-pipeline *meta-tooling*
debt, not scholar product. The desired schema changes are recorded here so you
can apply them against the upstream `spec-pipeline` schemas (wherever the
canonical `.claude/context/schema/*.xsd` live), not in this product repo.

**Goal:** make the XSDs match the shape the pipeline actually emits, then
re-enable `xmllint --schema` in spec-pipeline workflow step 2.

Concrete drifts to fix (observed against scholar's closed registries):

- **plans.xsd** — `<reference>` required-attrs are declared but unused by emitted
  files; `plan-group` synopsis is emitted as a child **element**, not an attr.
- **chores.xsd** — requires `type` / `origin` / `baseline` attributes that **none**
  of the real chores carry; `chore.id` pattern `\d{4}-\d{2}-\d{2}-...` rejects
  every actual **slug-style** id (e.g. `redesign-registry-schemas`).
- **Common emitted shape the XSDs must allow:** `modified-at`, `fulfillment`,
  `blast-radius`, `blocks-plans` attributes; `<synopsis>` as an element.
- **splits.xsd** — the 250-char `_long_desc` cap is exceeded by real content (the
  extraction plan synopsis is 435 chars). Either raise the cap or tighten the
  emitted bodies — and add a `maxLength` to keep chore/synopsis bodies terse.

**Decision still yours:** schema-then-data retrofit, rewrite-schema-to-fit-data,
or drop the XSDs entirely. (Full original framing: the dropped chore's `<synopsis>`
in `.claude/context/chores.xml`.)

---

## 4. nu CLI `ingest` is broken (field-name + tool-name drift)  ⟵ you said you'd fix nu

Found driving the first real smoke test (2026-06-03). `bin/scholar.nu`'s `ingest`
subcommand (lines ~102-122) sends payloads whose field/tool names don't match the
registered MCP tools. 3 of 4 ingest paths are broken:

| nu flag    | nu sends (line)                        | tool expects                         | result |
|------------|----------------------------------------|--------------------------------------|--------|
| `--arxiv`  | `{arxiv_id, corpus_id}` → ingest.arxiv | `{id, downloadPdf?}`                 | **broken** — `arxiv_id`≠`id`, zod rejects |
| `--ris`    | `{file_path, corpus_id}` → ingest.ris  | *no such tool* (RIS rides bibtex w/ `format:"ris"`) | **broken** — unknown_tool |
| `--bibtex` | `{file_path, corpus_id}` → ingest.bibtex | `{content?, filePath?, format?}`   | **broken** — `file_path`≠`filePath` → `INGEST_NO_CONTENT` |
| `--doi`    | `{doi, corpus_id}` → ingest.doi        | `{doi}`                              | shape OK (extra `corpus_id` ignored) |

nu-side fixes (yours): rename `file_path`→`filePath`, `arxiv_id`→`id`; route `--ris`
to `scholar.ingest.bibtex` with `{filePath, format:"ris"}`; drop the dead `corpus_id`
arg (every ingest tool is active-corpus based — it's ignored, see §below). The nu tests
only assert `--help` text, so none catch this — add a payload-shape assertion per flag.

**Necessary but NOT sufficient — there's a server-side prerequisite (Bug #2b).**
`main` (bin/scholar.nu:69) shells out a *fresh* `bun … --call <tool>` process per call.
Each `--call` builds a new server with `ctx.db = undefined` and never re-opens the
persisted active corpus, so **every active-corpus tool returns `SCHOLAR_NO_ACTIVE_CORPUS`**
regardless of correct field names (verified: `ingest.manual` headless → that error).
`status`/`list` work only because they read the config DB, not `ctx.db`. So fixing nu's
field names alone won't make `ingest`/`query`/`digest` work — `runCli`
(`src/server/index.ts`) must first bootstrap the persisted active corpus into `ctx.db`
before dispatch. That server fix is scholar-src, not nu; it's part of the init-layer
repair decision (see the session report / `init-layer-findings`), and gates whether the
nu CLI can ever drive a stateful workflow.

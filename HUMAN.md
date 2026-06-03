# HUMAN.md — operator actions Claude can't complete autonomously

Things that need *you* (real hardware, accounts, external installs, or upstream
repos). Created 2026-06-02. Delete items as you clear them.

---

## 1. Install the required Ollama models  ⟵ gates day-to-day use

The plugin defaults to `nomic-embed-text:v1.5` (embeddings) and `qwen3:8b`
(chat). Without them, ingestion (embed) and digest/reading-prompts (chat) fail.

**Status:** deferred — the Windows `ollama.exe` was **not reachable from this WSL
instance** (not on `PATH`, not under the usual `/mnt/c/.../Programs/Ollama/`,
`/mnt/c/Program Files/Ollama/`, or `/mnt/c/ProgramData/Ollama/` paths). The
WSL-native `ollama` on `PATH` is installed but only has vision models
(`granite3.2-vision:2b`, `qwen2.5vl:7b`) — neither default is present.

Pick one and run it yourself:

- **Windows-side (your intent):** from PowerShell/CMD, or once `ollama.exe` is on
  the WSL `PATH`:
  ```
  ollama.exe pull nomic-embed-text:v1.5
  ollama.exe pull qwen3:8b
  ```
  Then make sure scholar points at it: `SCHOLAR_OLLAMA_URL` (manifest default
  `http://127.0.0.1:11434`) must reach the Windows daemon from where the server
  runs. From WSL that's typically the Windows host IP, not `127.0.0.1`.
- **WSL-native:** `ollama pull nomic-embed-text:v1.5 && ollama pull qwen3:8b`
  (uses the daemon already on `PATH`; `127.0.0.1:11434` works as-is).
- **Use models you already have:** set `SCHOLAR_OLLAMA_EMBED_MODEL` /
  `SCHOLAR_OLLAMA_CHAT_MODEL` in the manifest env (note: a different embed model
  changes the vector dimension — start a fresh corpus, don't mix).

---

## 2. Run the end-to-end smoke test  ⟵ the real gate to "reliable daily use"

Nothing has driven a live corpus workflow yet (only unit/contract/headless
tests). Follow **`docs/runbooks/e2e-smoke-test.md`**. Highest-risk leg: the
annotation + PDF-viewer path (§7), which has *zero* automated coverage because it
hangs headless — a live viewer is the only way to prove it works. Do this in a
real Claude Code session so it also validates install + spawn (G3).

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

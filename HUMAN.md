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

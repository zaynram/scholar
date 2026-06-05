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

**⟵ FIRST, confirm WHICH scholar your session runs — this decides everything.**
All the headless proofs below used the **dev checkout** as the plugin root. Three
cases, only you know which is yours:
- **Dev checkout** (`CLAUDE_PLUGIN_ROOT=/home/ramda/code/scholar`): `dist/` is
  rebuilt and carries every fix — you're ready.
- **Fresh `out/scholar.plugin`** built today (`bun run build:linux`) and
  reinstalled: ready — it carries the staged migrations + wiring.
- **A previously-installed `scholar.plugin`** (unzipped before 2026-06-03):
  carries **none** of commit f293b18 — you'll hit the old no-op pdf child and
  `Can't find meta/_journal.json` again. **Rebuild + reinstall before logging in.**

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

**Launcher chain proven end-to-end (2026-06-03).** The earlier proofs used the dev
bun; the *actual* manifest path is `/bin/sh bin/launch.sh` → `sh ensure-bun.sh`
(provisions the pinned **1.3.11** bun into `${CLAUDE_PLUGIN_DATA}/bun`) →
`exec ${CLAUDE_PLUGIN_DATA}/bun/bun dist/server.js`. Both legs now verified
headless: `ensure-bun.sh` cold-provisions exactly 1.3.11 (download→unzip→exec, ~2s),
and driving `/bin/sh launch.sh` with **no dev bun on PATH** through the provisioned
1.3.11 runtime still returns `activate isError=false, dbOpen=true,
pdf_child.alive=true` against `daisy-lit-review` (child logs the real publications
root). So the provisioning + spawn + migrate + activate spine is no longer an
assumption — the **only** unproven leg is the PDF *viewer* (`displayPdf`/`getText`,
step 7), which can only be exercised by a human at the desktop.

> **Note (2026-06-04):** the PDF viewer is an **MCP App** the Claude Code terminal
> can't render — the actual home for that leg is **Claude Desktop** via the `.mcpb`
> extension. See **§5** for the build + install + the Windows verification legs
> (the viewer-render check there is the same leg as step 7). **Caveat:** that render
> leg is now known to be **non-conformant at the source level** — scholar doesn't
> yet declare the mcp-apps `_meta.ui.resourceUri` / `text/html;profile=mcp-app`
> contract, so the panel won't render on Desktop *or* anywhere until the (additive)
> conformance fix lands. See **§5 leg 6** for the gap and the fix.

---

## 5. Install + verify the `.mcpb` on Claude Desktop (Windows)  ⟵ NEW 2026-06-04

The Claude Desktop distribution is built and structurally proven. The Windows
*launch* legs can only be exercised by you on the target machine — but the
headline *render* leg is already known to fail at the **source** level (leg 6
below): scholar does not yet speak the mcp-apps host-render protocol, so the
PDF/UI panels will not appear until a small conformance fix lands. The packaging
is correct and shippable; the feature it carries is not yet wired to render. See
leg 6 for the exact gap and the (additive) fix.

**Build it** (on any host with `bun` + the `mcpb` CLI):
```
bun run build:mcpb        # -> out/scholar.mcpb (win32, ~2.9 MB, 20 files)
```
The build runs `mcpb validate` then `mcpb pack`. The manifest is `manifest.json`
at the bundle root (mcpb schema **0.2**), `server.type:"binary"`, command
`cmd.exe /c ${__dirname}\bin\launch.cmd`. It does **not** modify the launcher: the
manifest `env` aliases the two vars `launch.cmd`/`ensure-bun.ps1` already read —
`CLAUDE_PLUGIN_ROOT := ${__dirname}` and `CLAUDE_PLUGIN_DATA := ${user_config.data_dir}`
— so the win32 launch chain runs byte-identical to the Claude Code plugin.

**Install it:** Claude Desktop → Settings → Extensions → *Install Extension…* →
pick `out/scholar.mcpb` (or double-click the file). At install you'll be prompted
for the **Scholar data directory** (default `%USERPROFILE%\scholar`) and, optionally,
the Ollama URL/model tags. The data dir must be writable — it holds the provisioned
bun runtime, the SQLite DBs, downloaded PDFs, and snapshots.

**Prereqs on the Windows box:** Ollama running and reachable at the configured URL,
with `nomic-embed-text:v1.5` + `qwen3:8b` pulled (same as §1). If Ollama is on a
different host, set the Ollama URL field at install.

### What is proven vs. what is your leg

Proven from Linux: the manifest validates against the real `mcpb` schema (0.1–0.4
all pass — no version-specific field), packs + unpacks to the correct structure
(manifest at root; `bin/launch.cmd`, `dist/server.js`, `dist/pdf-server/{index.js,
mcp-app.html}`, `build/vendor/sqlite-vec/vec0.dll`, `ui/`, `nu/`, migrations all
present; no `.claude-plugin/` cruft), and the source path-resolution chain reads
the two aliased vars (vec0 + pdf entry off `CLAUDE_PLUGIN_ROOT`, bun off
`process.execPath`). **None of that proves Desktop runs it.** These legs can only
be checked on Windows — each with the symptom to watch for:

1. **Desktop accepts manifest_version 0.2** — *symptom:* the Install dialog rejects
   the extension up front. *Fix:* bump `MCPB_MANIFEST_VERSION` in
   `scripts/build-plugin.ts` (0.2 → 0.3 → 0.4), `bun run build:mcpb`, reinstall.
2. **Desktop spawns `cmd.exe`/`type:"binary"`** — *symptom:* extension installs but
   the MCP never connects ("server failed to start"). Means Desktop won't launch an
   arbitrary command for this extension type.
3. **Variable substitution** (`${__dirname}`, `${user_config.data_dir}`, `${HOME}`)
   — *symptom:* `ensure-bun: CLAUDE_PLUGIN_DATA unset` on stderr, or launch.cmd
   can't find `dist\server.js`. Means a `${…}` token wasn't expanded. (`${HOME}`
   is confirmed a documented mcpb substitution var, usable in `user_config`
   defaults — mcpb `MANIFEST.md` — and Desktop maps it to the Windows user
   profile, so the `data_dir` default `${HOME}\scholar` is portable, not a bug.)
4. **bun provisioning** (ensure-bun.ps1 downloads bun-windows-x64 **1.3.11** into
   `%CLAUDE_PLUGIN_DATA%\bun`) — *symptom:* long first-launch then `bun.exe` not
   found; or PowerShell blocked by ExecutionPolicy (the hook passes
   `-ExecutionPolicy Bypass`, but Desktop spawns via cmd.exe, not the hook). Check
   `%data_dir%\bun\bun.exe --version` prints `1.3.11`.
5. **vec0.dll loads under the provisioned bun** (the ABI is **never probed on
   Linux** — the win32 dll is fetched from npm as-is) — *symptom:* corpus
   create/activate throws on vec load / `loadVecAndProbeDim` (SQLite ABI mismatch
   between bun 1.3.11's bundled SQLite and the dll).
6. **mcp-apps PDF viewer renders** — *the headline reason Desktop is the target,*
   and **known non-conformant at the source level (confirmed 2026-06-04).** This is
   no longer a "verify on Windows" item — it is a tracked source fix. Per SEP-1865
   (the finalized mcp-apps spec) and the version-matched vendored pdf-server
   (v1.7.2, scholar's own child and an in-tree proof of the correct shape), the host
   renders a tool's UI in a sandboxed iframe **only** when (a) the tool declares
   `_meta: { ui: { resourceUri: "ui://…" } }` at registration and (b) the resource
   is served with mimeType `text/html;profile=mcp-app`. Scholar does **neither**: no
   tool carries `_meta.ui.resourceUri` (the UI tools return ad-hoc
   `openView`/`resource` fields in the *result body* — `corpus.ts:496`,
   `papers.ts:273,286`, `digest.ts:202`, `prompts.ts:181` — which the host does not
   read for rendering; they only mean something *inside* an already-rendered iframe,
   which never gets created), and `src/server/ui/resource.ts:34` serves
   `ui://scholar/app.html` as plain `text/html`. There is **no
   `structuredContent.resource` fallback** in the protocol. So the panel **will not
   render as-is.** This faithfully implements spec §9/§11 (the `structuredContent.view`
   dispatch model) — so the fix is a deliberate spec §9/§11 amendment, not a code bug.
   **The fix is additive and contained** (no foundation/§7.6 touch): point all five
   view-opener tools' `_meta.ui.resourceUri` at `ui://scholar/app.html` and flip the
   resource mime to `text/html;profile=mcp-app`; the existing `structuredContent.view`
   dispatch keeps working *inside* the iframe. SDK 1.29.0 already passes `_meta`
   through to the tool listing (`@modelcontextprotocol/sdk` `mcp.js:86`), so it is
   viable. Until it lands, install + launch can be exercised but the UI/PDF panels
   stay blank.
7. **Clean shutdown / no orphaned lock** — `launch.cmd` runs `bun.exe` as a *child*
   of cmd.exe (no exec-replace on Windows). *symptom:* after quitting/restarting
   Desktop, the next launch refuses with `SCHOLAR_LOCKED`. The pid-liveness reclaim
   in `session-lock.ts` should clear a stale `runtime\scholar.lock` on the next
   start (unless the OS reused the pid) — confirm a restart recovers cleanly.

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

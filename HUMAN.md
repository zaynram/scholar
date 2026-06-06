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

> **Superseded 2026-06-06 — bun-launcher unification.** The 2026-06-03 proof above
> was of the now-retired `/bin/sh launch.sh` path (`exec`-replace into bun). Both
> targets now launch via `bun ${CLAUDE_PLUGIN_ROOT}/bin/launch.mjs`; `launch.sh` and
> `launch.cmd` are deleted. The new Linux entry paths are **not** an assumption —
> **both** were re-driven **end-to-end headless (2026-06-06)** under a *non-pinned*
> on-PATH bun (1.3.14), each cold-provisioning the pinned **1.3.11** into a fresh
> `CLAUDE_PLUGIN_DATA` and returning a clean single-line MCP `initialize` (pdf child
> `Ready`, graceful exit on stdin-EOF): (a) the **built-bundle** path (`dist/server.js`
> present), and (b) the **source-sync from-src** path — `CLAUDE_PLUGIN_ROOT` set to the
> git-tracked ship set (no `dist/`, no `node_modules`), where `launch.mjs` falls through
> to `src/server/index.ts` and the pinned bun **cold-auto-installs the whole import
> graph** into the `BUN_INSTALL` cache under `CLAUDE_PLUGIN_DATA` (~67 MB) **without
> writing a local `node_modules`** into the shipped tree. That second path is exactly
> what the Cowork Linux sandbox runs, so the launcher's auto-install assumption is now
> validated empirically, not on faith. `ensure-bun.sh` and the server spine are
> unchanged. The **only** leg this does NOT cover is Windows — a bare `bun` resolving on
> PATH at the Claude Desktop spawn (CreateProcess PATH semantics differ from POSIX
> `execvp`); that is now the dominant residual risk, tracked in **§5 leg 2**.

> **Note (2026-06-04, updated):** the PDF viewer is an **MCP App** the Claude Code
> terminal can't render — the actual home for that leg is **Claude Desktop** via the
> `.mcpb` extension. See **§5** for the build + install + the Windows verification
> legs (the viewer-render check there is the same leg as step 7). The mcp-apps
> conformance gap flagged earlier is now **fixed at the source level** (commits
> `eb236d1` spec §9/§11/§253 amendment, `4c9aa40` server render layer, `f3c4aa9`
> client ext-apps bridge): both the host-render contract (`_meta.ui.resourceUri` +
> `text/html;profile=mcp-app`) and the in-iframe bridge (`@modelcontextprotocol/ext-apps`
> `App` over postMessage, `ontoolresult` carrier) are implemented and unit-pinned.
> The **only** remaining unproven leg is the actual live render on Claude Desktop —
> the one-shot `ontoolresult` delivery can't be exercised from Linux. See **§5 leg 6**.

---

## 5. Install + verify the `.mcpb` on Claude Desktop (Windows)  ⟵ NEW 2026-06-04

The Claude Desktop distribution is built and structurally proven. The Windows
*launch* legs can only be exercised by you on the target machine. The headline
*render* leg — flagged in an earlier draft as non-conformant at source — is now
**source-conformant** (leg 6 below): scholar speaks the mcp-apps host-render
protocol (both layers) and the UI bundle carries the `@modelcontextprotocol/ext-apps`
bridge. A follow-on **packaging defect** (the bundle served a placeholder, not the
real UI) was also found and fixed afterward (`306e3f8`) and **verified against the
real artifacts** — see the *Packaging correction* under leg 6. What remains is
purely a **live-render check on Desktop** — the one-shot notification delivery
can't be simulated from Linux. See leg 6.

**Build it** (on any host with `bun` + the `mcpb` CLI):
```
bun run build:mcpb        # -> out/scholar.mcpb (win32, ~2.9 MB, 20 files)
```
The build runs `mcpb validate` then `mcpb pack`. The manifest is `manifest.json`
at the bundle root (mcpb schema **0.2**), `server.type:"binary"` (`bun` is a binary
on PATH), command `bun` with args `[${__dirname}\bin\launch.mjs]`. It does **not**
modify the launcher: the manifest `env` aliases the two vars `launch.mjs`/`ensure-bun.ps1` already read —
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
(manifest at root; `bin/launch.mjs`, `bin/ensure-bun.ps1`, `dist/server.js`,
`dist/pdf-server/{index.js, mcp-app.html}`, `build/vendor/sqlite-vec/vec0.dll`,
`ui/`, `nu/`, migrations all present; no `.claude-plugin/` cruft), and the source
path-resolution chain reads
the two aliased vars (vec0 + pdf entry off `CLAUDE_PLUGIN_ROOT`, bun off
`process.execPath`). **None of that proves Desktop runs it.** These legs can only
be checked on Windows — each with the symptom to watch for:

1. **Desktop accepts manifest_version 0.2** — *symptom:* the Install dialog rejects
   the extension up front. *Fix:* bump `MCPB_MANIFEST_VERSION` in
   `scripts/build-plugin.ts` (0.2 → 0.3 → 0.4), `bun run build:mcpb`, reinstall.
2. **Desktop spawns `bun`/`type:"binary"` AND a bare `bun` resolves on PATH** — the
   **dominant residual risk** of the bun-launcher unification. On POSIX the host's
   `execvp` searches PATH; Windows `CreateProcess` does not search PATH the same way,
   so a bare `bun` resolves only if Desktop passes a PATH-aware spawn env. *symptom:*
   extension installs but the MCP never connects ("server failed to start") — either
   Desktop won't launch this command for `type:"binary"`, or `bun` was not found on
   PATH. *First check:* `bun --version` in a fresh Windows shell (bun must be
   installed system-wide — it is a dependency of these servers). *Fallback if PATH is
   the problem:* edit the manifest `command` to an absolute `bun.exe` path (e.g.
   `%USERPROFILE%\.bun\bin\bun.exe`) and reinstall.
3. **Variable substitution** (`${__dirname}`, `${user_config.data_dir}`, `${HOME}`)
   — *symptom:* `ensure-bun: CLAUDE_PLUGIN_DATA unset` on stderr, or `launch.mjs`
   dies with `CLAUDE_PLUGIN_ROOT is unset` / can't find `dist\server.js`. Means a
   `${…}` token wasn't expanded. (`${HOME}`
   is confirmed a documented mcpb substitution var, usable in `user_config`
   defaults — mcpb `MANIFEST.md` — and Desktop maps it to the Windows user
   profile, so the `data_dir` default `${HOME}\scholar` is portable, not a bug.)
4. **bun provisioning** (ensure-bun.ps1 downloads bun-windows-x64 **1.3.11** into
   `%CLAUDE_PLUGIN_DATA%\bun`) — *symptom:* long first-launch then `bun.exe` not
   found; or PowerShell blocked by ExecutionPolicy. (Improved by the bun
   unification: `launch.mjs` now invokes the provisioner as `powershell -NoProfile
   -ExecutionPolicy Bypass -File ensure-bun.ps1` on **both** the server-spawn path
   *and* the `--provision-only` SessionStart pre-warm — the old cmd.exe launcher
   only bypassed on the hook — so a machine ExecutionPolicy should not block it.)
   Check `%data_dir%\bun\bun.exe --version` prints `1.3.11`.
   **Field-confirmed 2026-06-05 (Cowork):** on a *brand-new* data dir the first
   connect can time out *during* this download — the ~110 MB fetch overran the
   host's 30 s MCP connect budget (`Connection timeout triggered after 30027ms`),
   so the host abandoned the connection one-shot (the SessionStart pre-warm and the
   spawn fired the same second, so neither had provisioned bun yet). *Symptom:*
   first launch on a fresh install reports "server failed to start" / no tools;
   **fix: just restart once** — warm boot reuses the provisioned bun (~2 s) and
   connects. A durable fix is a user-directed design call tracked in
   slim-plugin-pivot.md → "MCP connect timeout" (the ABI-safe option is
   exact-version system-bun reuse, **not** the "≥ pin" the field report suggested).
5. **vec0.dll loads under the provisioned bun** (the ABI is **never probed on
   Linux** — the win32 dll is fetched from npm as-is) — *symptom:* corpus
   create/activate throws on vec load / `loadVecAndProbeDim` (SQLite ABI mismatch
   between bun 1.3.11's bundled SQLite and the dll).
6. **mcp-apps PDF viewer renders** — *the headline reason Desktop is the target.*
   **Source-conformant as of 2026-06-04** (commits `eb236d1` spec amendment,
   `4c9aa40` server layer, `f3c4aa9` client layer). This is back to being a
   *verify-on-Windows* item: the source now speaks the finalized mcp-apps protocol
   (SEP-1865), proven against scholar's own version-matched vendored pdf-server
   (v1.7.2) and the `@modelcontextprotocol/ext-apps` `.d.ts`. Both layers were
   fixed:

   - **Layer 1 (host render/discovery) — DONE.** All five view-opener tools
     (`scholar.{dashboard,paper.show,digest.show,prompts.show,progress.show}`) now
     declare `_meta.ui.resourceUri = "ui://scholar/app.html"` (both the modern
     nested key and the legacy `_meta["ui/resourceUri"]`, via a `viewMeta()` helper
     applied inside scholar's own `register` chokepoint), and
     `src/server/ui/resource.ts` serves `ui://scholar/app.html` as
     `text/html;profile=mcp-app` (the pdf resource stays `application/pdf`). The
     three incompatible view vocabularies were unified onto one `ViewInput`
     discriminant carried in the result `structuredContent`; the registry wrapper
     promotes it on `"view" in result`. Capability negotiation needs nothing
     server-side (the reference registers app-tools unconditionally).
   - **Layer 2 (in-iframe runtime bridge) — DONE.** `src/ui/lib/app.ts` was
     rewritten off the host-injected `window.mcp`/`window.cowork` globals (a
     Cowork-ism no standard host populates) onto the `@modelcontextprotocol/ext-apps`
     `App` over `PostMessageTransport(window.parent, window.parent)`. The view
     discriminant arrives on **`app.ontoolresult`** (the tool-*result* notification;
     the v1.0 code read `ontoolinput`, the input channel) via
     `params.structuredContent`; `callServerTool`/`readServerResource`/`sendMessage`
     map to the `App` methods. The dep `@modelcontextprotocol/ext-apps@1.7.3` is
     client-only (verified absent from `dist/server.js`).

   **What is proven from Linux (the source ceiling):** source-conformant on both
   layers; `bun run build:server` (2.46 MB, ext-apps-free), `build:ui` (the real
   ext-apps `App` bundles for the browser target → `build/ui/app.html`, 1.41 MB),
   and `build:mcpb` (→ `out/scholar.mcpb`, 3.0 MB, 20 files) all succeed; full suite
   green (`bun test src tests`); tsc clean. The **one-shot ordering** — `lib/app.ts`
   registers `ontoolresult` *before* `app.connect()`, because the host fires that
   notification once right after the `ui/initialize` handshake — is **asserted
   in-test** (`src/ui/lib/app.test.ts`).

   **Packaging correction (2026-06-04, after this leg was first flipped to
   "source-conformant").** That source-conformance claim was necessary but **not
   sufficient**: a packaging defect meant every shipped bundle served the "Scholar
   UI not built" placeholder, so the iframe would have rendered empty regardless of
   the protocol work above. `src/server/ui/resource.ts` read a dev-only path
   (`build/ui/app.html`, which from the bundled `dist/server.js` resolves *outside*
   the plugin root → never exists in a deployed plugin → ENOENT → placeholder), and
   `build-plugin.ts` staged Bun's *multi-file* loader (`ui/index.html` +
   `chunk-*.js`) the sandboxed iframe can't fetch anyway. The source suite stayed
   green because it exercised the dev path — the verify-against-the-real-artifact
   trap. **Fixed in `eda8026`+`306e3f8`:** build now stages one self-contained `ui/app.html`
   (via a shared inliner, gated in both the `.plugin` and `.mcpb` `required[]`
   manifests) and `resource.ts` resolves it through a `CLAUDE_PLUGIN_ROOT`-anchored
   ladder. **Verified against the real artifacts** (not the dev path): all three
   rebuilt bundles (`scholar-linux.plugin`, `scholar-win32.plugin`, `scholar.mcpb`)
   ship `ui/app.html` **only** — no `index.html`/chunks — with 0 external
   `<script src>`, one inlined module block, and the `<title>Scholar</title>`
   marker; a new real-SDK `readResource` test (`src/server/ui/resource.test.ts`)
   stages the UI through build-plugin's own `buildUI`, points `CLAUDE_PLUGIN_ROOT`
   at it, and asserts the served HTML is the staged single-file bundle
   (sentinel-proven, so resolution went through the ladder, not the dev fallback)
   and not the placeholder.

   **What is your leg (only checkable on live Desktop):** that the host actually
   renders the iframe and the one-shot `ontoolresult` is delivered *and caught* —
   i.e. the handshake-then-notification timing on the real host. *symptom:* the
   panel shows **"Scholar UI not built"** → the bundle didn't reach
   `<root>/ui/app.html` (should not happen post-`306e3f8`; re-check the artifact
   actually carries `ui/app.html` and the host set `CLAUDE_PLUGIN_ROOT`);
   *symptom:* the panel renders but stays **blank/empty** (iframe appears, real UI
   chrome but no view) → the notification was missed (one-shot race) or
   `structuredContent` didn't carry the `view` key; *symptom:* iframe **never
   appears** → the host didn't honor
   `_meta.ui.resourceUri` / the profile mime (re-check the manifest reached Desktop
   and the tool list shows `_meta`). The `cowork.askClaude` "Use Claude instead"
   toggle is **expected to be absent** on standard Desktop (no Cowork global) — the
   digest/prompts UI degrades to Ollama-only by design; that is not a failure.
   *Caveat (salient uncertainty):* the conformance reading is grounded in SEP-1865 +
   the version-matched pdf-server reference + the ext-apps `.d.ts`, but the live
   render path has not been exercised on a real Claude Desktop from this environment.
7. **Clean shutdown / no orphaned lock** — `bun launch.mjs` spawns `bun.exe` as a
   *child* (the same parent+child shape on both OSes now — the prior Linux
   `exec`-replace is gone; launch.mjs forwards SIGINT/SIGTERM/SIGHUP and exits when
   the child does; see slim-plugin-pivot.md "Launch orphan"). *symptom:* after
   quitting/restarting Desktop, the next launch refuses with `SCHOLAR_LOCKED`. The
   pid-liveness reclaim
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

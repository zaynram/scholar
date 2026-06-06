# Slim-plugin pivot (2026-06-01)

Amendment to `2026-05-22-scholar-plugin-design.md`. Target platform: **Windows**;
development platform: **Linux/WSL**. Driver: the **~200 MB unpacked-plugin upload
limit**. This document records the architecture, the empirical evidence behind
each load-bearing decision, and the deviations from prior locked choices.

## Problem

The pre-pivot packaging shipped a fully self-contained runtime:

| Artifact | Size | Fate |
| --- | --- | --- |
| `bin/mcp-scholar.exe` (`bun build --compile`) | ~96 MB | **dropped** |
| bundled bun runtime (the pdf-child spawn target) | ~90 MB | **dropped** (provisioned instead) |
| vendored pdf-server `dist/` | 6.7 MB | **rebundled** to one standalone file |

The 96 MB came from `--compile` inlining all of `node_modules` into the binary.
The 90 MB bundled bun was a redundant second copy of the runtime. Together they —
not the 6.7 MB vendored pdf — were the bloat.

## Architecture (slim)

- **scholar server** ships as a single `bun build --target=bun` bundle
  (`dist/server.js`, **2.46 MB**, 419 modules inlined) — **no `--compile`**. The
  provisioned bun runs it directly: `bun dist/server.js`.
- **pdf-server@1.7.2** ships as a single rebundled standalone file
  (`dist/pdf-server/index.js`, **~4 MB**) + `mcp-app.html` beside it. pdfjs-dist
  and all deps are inlined by `bun build`; **no runtime provisioning, no network
  at first-run.** pdf remains scholar's spawned child (roots injection, the
  `scholar.pdf.*` proxy, supervisor/respawn, §13 push path all unchanged).
- **bun** (the runtime) is the *only* thing provisioned into the persistent
  per-plugin data dir `${CLAUDE_PLUGIN_DATA}`, by a SessionStart hook that fires
  before the MCP server connects. Pinned to **1.3.11** for the vec0 ABI (below).
- **vec0** ships in-package for **both** platforms (`vec0.so` for dev, `vec0.dll`
  for target) — it is KB-scale and its ABI is build-time-coupled to bun's SQLite.
- **Windows `koffi.node`** (native, used only by the Job-Object orphan-reaper on
  win32) is provisioned/shipped for the target; it can never be JS-bundled.

### Runtime resolution seams (`src/server/pdf/lifecycle.ts`)

- `resolveChildEntrypoint`: `SCHOLAR_PDF_ENTRYPOINT` → `${CLAUDE_PLUGIN_ROOT}/dist/pdf-server/index.js`
  (shipped bundle, `existsSync`-gated) → `<repo>/src/vendor/pdf-server/dist/index.js`
  (dev fallback, resolves pdfjs from repo node_modules).
- `resolveBunRuntime`: `SCHOLAR_BUN_PATH` → `process.execPath` (scholar itself
  runs under the provisioned bun, so execPath is already correct).

## Empirical evidence (verified on Linux, 2026-06-01)

1. `bun build src/server/index.ts --target=bun` → 2.46 MB `server.js`; ran from a
   dir with **no node_modules**, dispatched `scholar.corpus.list`, reached the DB
   (structured `no such table` error — expected on an empty temp root). ajv stayed
   external but **dormant** (scholar validates with zod, not ajv).
2. Rebundled pdf-server ran from `/tmp/pdf-bundle/` (no node_modules up-tree) and
   passed the **real** vendor contract gate
   (`lifecycle.contract.test.ts`, `SCHOLAR_PDF_E2E=1`, `SCHOLAR_PDF_ENTRYPOINT`
   override): **2 pass / 0 fail** — `display_pdf` parsed the PDF (pdfjs inlined),
   `interact({navigate})` + `add/remove_annotations` round-tripped.
3. Baseline preserved through the seam edits: `bunx tsc --noEmit` clean;
   `bun test` **285 pass / 8 skip / 0 fail**.
4. **Production resolution paths exercised from the assembled package under the
   pinned bun 1.3.11** (not the dev override / not a standalone probe):
   - `resolveChildEntrypoint`'s `existsSync(${CLAUDE_PLUGIN_ROOT}/dist/pdf-server/index.js)`
     branch — run with `CLAUDE_PLUGIN_ROOT` pointed at the installed package and
     **no** `SCHOLAR_PDF_ENTRYPOINT` override — spawned the pdf child under the
     provisioned bun (`process.execPath`). `lifecycle.contract.test.ts`: **2 pass**,
     `[pdf-server] Ready` confirmed on stderr, `display_pdf` parsed.
   - scholar's own `resolveVec0Path()` resolved the packaged
     `${CLAUDE_PLUGIN_ROOT}/build/vendor/sqlite-vec/vec0.so` branch; `loadExtension`
     + a `vec0` virtual table + a KNN `MATCH` all succeeded under bun 1.3.11
     (`vec_version v0.1.9`). The ABI pin-gate now passes through scholar's
     production resolver, not the build-time probe alone.

## Deviations from prior locked decisions (for user review)

- **"provision pdf-server@1.7.2 at first-run" → "ship a rebundled standalone pdf
  bundle in-package."** Evidence (2) shows the bundle parses PDFs offline with no
  node_modules; shipping ~4 MB is deterministic, offline, and avoids a first-run
  network race. pdf still ships pinned @1.7.2 and stays the child process — only
  the on-disk delivery changes. **Reversible** via `SCHOLAR_PDF_ENTRYPOINT` if a
  provisioned model is ever preferred.
- **CLAUDE.md "vendored pdf shipped unmodified / no source patch" still holds** —
  the bundle is a mechanical `bun build` of the unmodified vendor dist; the
  vendored tree stays in-repo as the §16 `.d.ts` truth source and dev fallback.

## Build system (validated 2026-06-01)

> **Superseded 2026-06-05 — bun-launcher unification.** The per-OS shell-pair
> launcher described in this section (`/bin/sh launch.sh` | `cmd.exe /c
> launch.cmd`) was retired. Both targets now launch via the single cross-OS shim
> `bun ${CLAUDE_PLUGIN_ROOT}/bin/launch.mjs` — the same command the committed
> source-sync `.claude-plugin/plugin.json` uses. `bin/launch.{sh,cmd}` are
> deleted; only `bin/launch.mjs` + the per-OS `ensure-bun.{sh,ps1}` provisioner
> ship. Rationale: a bare `node` invocation no longer resolves reliably under
> Claude Desktop (its "use bundled node" option was removed from settings), and
> bun is the operator's systemwide convention across these servers. The generated
> manifests were **re-verified against the real build artifacts 2026-06-06**:
> linux `command:"bun" args:["${ROOT}/bin/launch.mjs"]`,
> `SCHOLAR_RUNTIME_ROOT=${HOME}/mcp-data/scholar/runtime`; win32 identical bar
> `SCHOLAR_RUNTIME_ROOT=${USERPROFILE}\mcp-data\scholar\runtime`; both stage only
> `launch.mjs` + their `ensure-bun`. **Both** Linux entry paths were also driven
> **end-to-end headless (2026-06-06)** under a non-pinned on-PATH bun 1.3.14, each
> cold-provisioning the pinned 1.3.11 into a fresh `CLAUDE_PLUGIN_DATA` and returning
> a clean single-line MCP `initialize` (pdf child `Ready`, graceful exit on stdin-EOF):
> the **built-bundle** path (`dist/server.js` present) and the **source-sync from-src**
> path (`CLAUDE_PLUGIN_ROOT` = the git-tracked ship set with no `dist/` and no
> `node_modules`, where `launch.mjs` falls through to `src/server/index.ts` and the
> pinned bun **cold-auto-installs the whole import graph** into the `BUN_INSTALL` cache
> under `CLAUDE_PLUGIN_DATA` without writing a local `node_modules`). The second path is
> exactly what the Cowork Linux sandbox runs, so the launcher's auto-install assumption
> is validated, not assumed. The only unproven leg stays Windows bun-on-PATH at the
> Desktop spawn. The dated 2026-06-01 record below (sizes,
> `launch.sh`/`launch.cmd`) captures the retired shell-pair state and is kept as
> history.

`scripts/build-plugin.ts` rewritten to the slim model; `SCHOLAR_BUILD_WIN`
selects target. Both packages build on the Linux host (the 2026-06-01 sizes and
`launch.{sh,cmd}` launchers named in the two bullets below are the **retired**
shell-pair record, kept per the supersede banner above; the launcher is now the
cross-OS `bun ${ROOT}/bin/launch.mjs`):

- **linux** `scholar.plugin` 2.8 MB / 14 files — unzipped and launched via the
  generated manifest (`/bin/sh ${ROOT}/bin/launch.sh`) with a fresh
  `CLAUDE_PLUGIN_DATA`: ensure-bun provisioned bun 1.3.11, MCP `initialize`
  returned clean JSON-RPC on stdout. **Fully validated end-to-end.**
- **win32** `scholar.plugin` 2.9 MB / 14 files — `vec0.dll` (PE32+ confirmed)
  fetched from the `sqlite-vec-windows-x64` npm tarball at the version-parity
  pin; Windows launcher set + `cmd.exe /c launch.cmd` manifest staged.
  **Structure validated; launch path requires Windows hardware.**

Launch is **M2** (see `bin/`): on both OSes `bun` runs `bin/launch.mjs`, which
calls the idempotent `ensure-bun` provisioner then spawns the pinned bun on the
server entry. A `SessionStart` hook (scoped to the `startup` matcher) pre-warms
`ensure-bun` via `bun launch.mjs --provision-only` (latency only — the launcher is
the correctness gate, because SessionStart does not block MCP spawn). **Hook scope
(2026-06-06):** the pre-warm is `startup`-only — provisioning the pinned bun into
`CLAUDE_PLUGIN_DATA` is a first-session concern, so it need not re-fire on
resume/clear/compact. The plugins reference prescribes the *mechanism* — a
SessionStart hook that installs a dependency into `CLAUDE_PLUGIN_DATA` once and
reuses it across sessions and updates — but its example is *unscoped*, leaning on an
in-hook `diff` guard for idempotency. The `startup` narrowing is scholar's own
decision, not a doc prescription: scholar's guard-equivalent already exists
(`ensure-bun` is idempotent + flock-guarded) and `launch.mjs` (no flag) is the real
correctness gate, so re-firing on resume/clear/compact buys nothing. `Setup` is
deliberately *not* used: it fires only on explicit `claude --init-only` /
`-p --init|--maintenance` ("one-time preparation in CI or scripts"), never on
install or normal startup, so it would skip the pre-warm for ordinary users. **Shape change (2026-06-05):** the old
Linux launcher `exec`ed into bun, so the PID Claude Code spawned *became* the
server (no wrapper); `bun launch.mjs` instead spawns the pinned bun as a **child**
on both OSes — always a parent+child pair cross-OS. Mitigated, not a regression:
the child inherits fd0 (sees stdin-EOF directly), `launch.mjs` forwards
SIGINT/SIGTERM/SIGHUP, and `child.on("exit") → process.exit` ties parent liveness
to the child; only a hard `SIGKILL` of the wrapper leaves the pidfile, reclaimed
on next start by pid-liveness.

## Claude Desktop `.mcpb` packaging target (maintenance addendum 2026-06-04)

A **second** packaging target was added in maintenance mode: a Claude Desktop
Extension (`.mcpb`) alongside the Claude Code `.plugin`. Reason: scholar's PDF
viewer is an **MCP App** (UI resource rendered in a Desktop iframe) that the
Claude Code terminal cannot render — Claude Desktop is the only consumer of that
leg. This addendum records the *implementation*; it is **not** a ratified design.
The fuller packaging spec (target matrix, supported-OS policy, signing, sideload
vs. marketplace distribution) is human design work and remains unwritten — flagged
so the next spec pass owns it rather than inheriting it as an accidental default.

Design intent (deliberately minimal — no new launch surface):
- One staging tree, two emitters. `SCHOLAR_PACKAGE=mcpb` (`scripts/build-plugin.ts`)
  forces the win32 target and, instead of `.claude-plugin/plugin.json` + an fflate
  zip, writes a root **`manifest.json`** (mcpb schema **0.2** — the tool's broadly-
  compatible default; the manifest uses no version-specific field so 0.1–0.4 all
  validate) and packs via the official **`mcpb` CLI** (`mcpb validate` gate →
  `mcpb pack` → `out/scholar.mcpb`, ~2.9 MB / 20 files). Pure `buildMcpbManifest`
  is unit-pinned; `mcpb validate` is the authoritative schema gate.
- **The launcher is not mcpb-specific.** `server.type:"binary"` (`bun` is a
  binary on PATH), command `bun` with args `[${__dirname}\bin\launch.mjs]`. The
  manifest `env` aliases the two vars
  the launcher already reads — `CLAUDE_PLUGIN_ROOT := ${__dirname}` and
  `CLAUDE_PLUGIN_DATA := ${user_config.data_dir}` — so the launch chain runs
  byte-identical to the Code plugin. `SCHOLAR_BUN_PATH`/`SCHOLAR_VEC0_PATH`/
  `SCHOLAR_PDF_ENTRYPOINT` are intentionally unset: their defaults derive from
  `CLAUDE_PLUGIN_ROOT` (vec0, pdf entry) and `process.execPath` (the provisioned
  bun that `launch.mjs` runs `server.js` with). `data_dir` is collected at install
  via `user_config` (directory, required); Ollama URL/models are optional fields.

Proven on Linux (2026-06-04): manifest validates against the real `mcpb` schema
(0.1–0.4), packs + unpacks to the correct structure (manifest at root; launcher,
`dist/server.js`, `dist/pdf-server/{index.js,mcp-app.html}`, `vec0.dll`, `ui/`,
`nu/`, migrations present; no `.claude-plugin/` cruft), and the source
path-resolution chain reads the two aliased vars. **Not proven** (Windows-only):
Desktop accepting the manifest, spawning `bun`/`type:binary`, `${…}`
substitution, bun provisioning, and vec0 ABI under the provisioned bun — each
enumerated with its failure symptom in **HUMAN.md §5**.

> **mcp-apps viewer render — source-conformant as of 2026-06-04** (was flagged here
> as non-conformant at source; now fixed in commits `eb236d1` spec §9/§11/§253
> amendment, `4c9aa40` server render layer, `f3c4aa9` client ext-apps bridge). Per
> SEP-1865 the Desktop host renders a tool's UI iframe only when the tool declares
> `_meta.ui.resourceUri` and the resource is served as `text/html;profile=mcp-app`.
> Both layers now comply: (1) all five view-opener tools declare
> `_meta.ui.resourceUri = "ui://scholar/app.html"` (modern + legacy keys via a
> `viewMeta()` helper in scholar's `register` chokepoint) and the resource serves as
> `text/html;profile=mcp-app`, with the three prior view vocabularies unified onto one
> `ViewInput` discriminant in result `structuredContent`; (2) the in-iframe bridge
> (`src/ui/lib/app.ts`) was rewritten off the host-injected `window.mcp`/`window.cowork`
> globals onto `@modelcontextprotocol/ext-apps` `App` over `PostMessageTransport`,
> reading the view from the `ontoolresult` tool-*result* notification. The dep is
> client-only (absent from `dist/server.js`). **Packaging correction (`306e3f8`):**
> source-conformance was necessary but not sufficient — a packaging defect made
> every bundle serve the "UI not built" placeholder (`resource.ts` read a dev-only
> path that resolves outside the plugin root; the build staged Bun's multi-file
> loader the sandboxed iframe can't fetch). Fixed and **verified against the real
> artifacts**: build now stages one self-contained `ui/app.html` (gated in both
> `required[]` manifests), `resource.ts` resolves it via a `CLAUDE_PLUGIN_ROOT`
> ladder, and all three rebuilt bundles ship `ui/app.html` only (0 external
> `<script src>`), pinned by a real-SDK `readResource` test
> (`src/server/ui/resource.test.ts`). The **only** unproven leg is the live
> render on Claude Desktop — the one-shot `ontoolresult` delivery can't be exercised
> from Linux (the register-before-connect ordering it depends on is asserted in-test
> in `src/ui/lib/app.test.ts`). Tracked in **HUMAN.md §5 leg 6**.

## Resolved (was open, now verified on Linux)

- **bun pin vs vec0 ABI** — `loadExtension(vec0)` + a `vec0` virtual table
  function under the *pinned* bun 1.3.11 (sqlite-vec 0.1.9). Linux build runs
  the ABI probe as a hard gate.
- **vec0.dll for the target** — obtained from the npm tarball (no mingw cross-
  compile); 283 KB PE32+ x86-64 DLL.
- **`@napi-rs/canvas`** — confirmed benign: scholar's pdf surface has no
  rasterize/render-to-image call (grep clean); browser renders, `get_text` uses
  the text layer.

## Still open (require Windows-hardware validation — cannot verify from WSL)

- **Launch orphan (cross-OS, mitigated)**: `bun launch.mjs` spawns the pinned bun
  as a child on both OSes — the prior Linux `exec`-replace is gone (see the M2
  shape-change note above), so there is always a parent+child pair. If the host
  does not tree-kill the MCP process tree on shutdown, the child bun may orphan.
  Mitigated in `launch.mjs` (SIGINT/SIGTERM/SIGHUP forwarding + child-exit →
  `process.exit` propagation); a Job Object is **not** added (no Linux equivalent —
  would be over-engineering). Verify tree-kill on Windows hardware.
  **Update 2026-06-04:** the chained "orphan holds
  `runtime/scholar.lock` → next session `SCHOLAR_LOCKED`" path is **now live** — the
  single-active-session lock *is* implemented (a **pidfile**, not literal flock:
  `src/server/session-lock.ts`, `O_EXCL` create + `process.kill(pid,0)` liveness
  reclaim; see CLAUDE.md + `docs/audits/2026-06-04-invariant-enforcement.md` Δ1/Δ3).
  It is already hardened against a stale holder: a dead PID's lockfile is reclaimed
  on next start. The residual risk is only OS **pid reuse** (a live unrelated
  process at the recorded pid blocks reclaim). On `.mcpb`/Desktop this is HUMAN.md
  §5 leg 7 — confirm a Desktop restart recovers cleanly.
- **ensure-bun.ps1**: the PowerShell download/extract path is unexecuted on the
  dev host. Validate `Invoke-WebRequest`/`Expand-Archive` + the lock-dir guard.
- **koffi.node (win32-x64) — KNOWN REGRESSION (decided: accept + document).**
  `attachJobObject` does a runtime `require("koffi")` inside `server.js`. `bun
  build --target=bun` keeps native modules external, and the slim package ships
  **no `node_modules`**, so on Windows that `require` throws and is swallowed by
  the existing `try/catch` (lifecycle.ts:365) — Job-Object reaping of the **pdf
  child** is OFF by default. The `--compile` binary embedded koffi and had it; the
  slim bundle does not. This is accepted for the slim pivot because: (a) the reaper
  is best-effort, already `try/catch` graceful-degrade by explicit design
  (lifecycle.ts:372, "Foundation accepts the limitation"); (b) its only effect is
  pdf-child orphaning *if* Claude Code also fails to tree-kill (the open flag
  above) — the two must both fail to bite; (c) the lock-DoS escalation is moot
  (flock unimplemented). **Remediation if pdf-child orphaning is observed on
  Windows hardware:** fetch `@koromix/koffi-win32-x64`'s `.node` from npm (the
  `os:win32` native is not installed on the Linux build host) and lay it out so
  koffi's loader resolves it (e.g. `KOFFI_DIR` / a co-located
  `node_modules/koffi`), *or* tree-kill the pdf child from the cmd-side launcher.
  Not done blind here — koffi's native-binding resolution cannot be validated off
  the target.
- **UI bundling** — *RESOLVED 2026-06-04 (`eda8026`+`306e3f8`).* This bullet predicted the
  defect: `build:ui` emits a multi-file `ui/index.html` + `chunk-*.js`, and the
  sandboxed MCP-App iframe (SEP-1865) cannot fetch sibling chunks — so the
  packaged UI rendered as the "UI not built" placeholder. The follow-up landed:
  the build now stages one self-contained `ui/app.html` (Bun's multi-file output
  inlined via the shared `buildInlinedUI` helper in `scripts/build-ui.ts`, gated
  in both the `.plugin` and `.mcpb` `required[]` manifests), and
  `src/server/ui/resource.ts` resolves it via a `CLAUDE_PLUGIN_ROOT`-anchored
  ladder. Verified against the real artifacts (all three rebuilt bundles ship
  `ui/app.html` only, 0 external `<script src>`) and pinned by a real-SDK
  `readResource` test (`src/server/ui/resource.test.ts`).
- **MCP connect timeout — REPRODUCED 2026-06-05 (Cowork field test); fix is a
  user-directed design call.** First launch blocks on the bun download (~110 MB
  windows-x64). Confirmed on a fresh `scholar-inline` data dir: the SessionStart
  pre-warm and the MCP spawn fired in the *same second*, so `ensure-bun.ps1` ran
  the download inside the host's 30 s connect budget and blew it (log:
  `Connection timeout triggered after 30027ms` vs `timeout of 30000ms`). One-shot,
  no retry; the host abandons the connection. **Self-heals on restart** — warm
  boot is `Test-Ok → exit 0` (~2 s), well inside budget, and connects cleanly.
  Fix options, ascending invasiveness: (a) **fail-fast** in `launch.mjs` when the
  pinned bun is absent — a clear error beats a silent 30 s hang, but it only makes cold start
  legible, it does not remove it; (b) **generous first-run budget** — document /
  ship a larger `MCP_TIMEOUT` so the cold download fits (safe, but a real hang now
  surfaces slower; uncertain the plugin manifest can set the client-side
  `MCP_TIMEOUT` — verify); (c) **exact-version system-bun reuse** — if a
  `bun --version` on PATH *equals the pin* (`1.3.11`; one exists at `~\.bun\bin`),
  launch with it instead of downloading. ⚠️ Must be **exact-equality, NOT** the
  "`≥ pin`" the field diagnosis suggested: the pin exists for the **vec0 /
  `bun:sqlite` native ABI** (CLAUDE.md load-bearing invariant), so a
  newer-but-different bun can load an incompatible `sqlite-vec` and fail later at a
  far harder-to-diagnose point than a clean timeout. Not implemented blind — pick
  the approach, then validate on Windows.
  **Note (2026-06-05 bun-unification):** the launcher is now `bun` itself, so an
  on-PATH bun is already required to run the shim. That makes option (a)'s
  fail-fast naturally live in `launch.mjs`, and collapses option (c) to a cheap
  check the shim can do before dispatching to `ensure-bun` (if the on-PATH
  `bun --version` *equals* the pin, skip the download). Still pick + validate on
  Windows before implementing.
- **`launch.cmd` CRLF + non-ASCII — RESOLVED 2026-06-05 (Cowork field test).**
  The shipped `bin/launch.cmd` was LF-only with em-dashes in its `rem` header.
  cmd.exe seeks batch files by byte offset assuming CRLF, so LF-only lines
  misalign and chop the leading bytes off subsequent `rem` keywords — the field
  log showed `'bin' is not recognized` + `'m'` ×9 stderr noise on every launch.
  This is **noise-removal / parse-hardening, NOT** the cold-start fix above (the
  parser re-syncs before the real provision/launch commands, so lines 18/20 still
  executed on the observed build). Fix: `bin/launch.cmd` rewritten CRLF + ASCII,
  pinned by a new `.gitattributes` (`*.cmd text eol=crlf`, scoped so the POSIX
  `.sh` launchers stay LF). Verified against the real artifacts — `bin/launch.cmd`
  extracted from the rebuilt `out/scholar.plugin` (win32) and `out/scholar.mcpb`
  is 20/20 CRLF with no non-ASCII; the linux `.plugin` is unaffected (ships
  `launch.sh`). The one leg that can only run on the target — does cmd.exe stop
  emitting the noise — is the user's next Cowork session.
  **Now moot (bun-launcher unification, 2026-06-05):** `bin/launch.cmd` was deleted
  — the unified launcher is `bun launch.mjs`, no `.cmd` ships in any bundle, and the
  `*.cmd text eol=crlf` `.gitattributes` rule was removed (its only target was
  gone). cmd.exe never parses a scholar batch file now, so the CRLF byte-offset
  mangle class can no longer occur. Retained as the diagnosis record.

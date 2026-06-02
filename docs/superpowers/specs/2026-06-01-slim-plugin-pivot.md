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

`scripts/build-plugin.ts` rewritten to the slim model; `SCHOLAR_BUILD_WIN`
selects target. Both packages build on the Linux host:

- **linux** `scholar.plugin` 2.8 MB / 15 files — unzipped and launched via the
  generated manifest (`/bin/sh ${ROOT}/bin/launch.sh`) with a fresh
  `CLAUDE_PLUGIN_DATA`: ensure-bun provisioned bun 1.3.11, MCP `initialize`
  returned clean JSON-RPC on stdout. **Fully validated end-to-end.**
- **win32** `scholar.plugin` 2.9 MB / 15 files — `vec0.dll` (PE32+ confirmed)
  fetched from the `sqlite-vec-windows-x64` npm tarball at the version-parity
  pin; Windows launcher set + `cmd.exe /c launch.cmd` manifest staged.
  **Structure validated; launch path requires Windows hardware.**

Launch is **M2** (see `bin/`): an always-present shell (`/bin/sh` | `cmd.exe`)
runs `launch.{sh,cmd}`, which calls the idempotent `ensure-bun` provisioner then
runs the server. A `SessionStart` hook pre-warms `ensure-bun` (latency only —
the launcher is the correctness gate, because SessionStart does not block MCP
spawn). On Linux the launcher `exec`s into bun (no orphaned wrapper).

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

- **Windows launch orphan**: `cmd.exe /c launch.cmd` has no exec-replace, so
  `bun.exe` runs as a child of cmd. If Claude Code does not tree-kill the MCP
  process on shutdown, bun may orphan. Verify tree-kill; mitigate with a Job
  Object on the cmd side if observed. **Note:** the chained "orphan holds
  `runtime/scholar.lock` → next session `SCHOLAR_LOCKED`" DoS is **moot today** —
  the single-active-session flock is a frozen v1 *spec* invariant (CLAUDE.md) but
  is **not yet implemented** (`grep` of `src/server/index.ts` finds no lock
  acquisition). When that flock is wired, harden it against a stale holder
  (liveness/staleness check) so a dead-but-lock-holding PID cannot wedge startup.
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
- **UI bundling**: `build:ui` emits `ui/index.html` + a `chunk-*.js` (two files,
  pre-existing behavior — not single-file as CLAUDE.md §14.1 implies). Both are
  packaged; if the MCP UI resource requires a single inline file, the UI build
  config (not the slim pivot) needs a follow-up.
- **MCP connect timeout**: first launch blocks on the bun download (~tens of MB).
  If Claude Code imposes a short MCP spawn/connect timeout, the SessionStart
  pre-warm mitigates but does not guarantee; confirm the timeout is generous.

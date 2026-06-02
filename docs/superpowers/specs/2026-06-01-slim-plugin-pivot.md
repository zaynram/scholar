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

## Open flags (require Windows-hardware validation — cannot verify from WSL)

- **koffi.node (win32-x64)** must be resolvable beside the provisioned/shipped
  layout; the bundle bakes a dev `__dirname`. Linux never hits this path.
- **vec0.dll** must be fetched for the target (`sqlite-vec-windows-x64`); only
  `sqlite-vec-linux-x64` installs on the dev box.
- **bun pin vs vec0 ABI**: pin is 1.3.11 (SQLite 3.51.2); dev runs 1.3.14. Build
  gate: `loadExtension(vec0)` under the *pinned* bun must succeed.
- **`@napi-rs/canvas`**: optional pdfjs native dep for raster page-rendering;
  absent in the bundle (warns, degrades gracefully). Core flows (browser viewer,
  text, annotations) do not need it.

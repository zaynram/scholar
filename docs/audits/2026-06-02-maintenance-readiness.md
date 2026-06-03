# Scholar — Maintenance-Mode Readiness Assessment

**Created:** 2026-06-02
**Trigger:** Post-merge of PR #3; user ask — "identify any and all remaining
actionables before the project can go into maintenance mode and be reliably
used in day-to-day literature reviews."
**Method:** Static inspection of registries, source tree, build artifacts,
launch chain, and local runtime/Ollama state. No live MCP session was spawned.

---

## Verdict

The **build is done and green**; nothing in the plan/chore pipeline blocks use.
The gap to "reliably used day-to-day" is **operational, not code**: the two
required Ollama models aren't installed, and **no end-to-end workflow has ever
been run** against a live server. Everything else is tidiness.

---

## Status snapshot (verified green)

| Signal | State |
|---|---|
| Plans (`plans.xml`) | plan-group + all **7 children `closed`** with fulfillment SHAs |
| Chores (`chores.xml`) | **32 closed, 1 open** (`redesign-registry-schemas` — governance tooling, `blocks-plans=""`) |
| Test suite (`bun test src tests`) | **324 pass / 4 skip / 1 todo / 0 fail** (329 across 43 files, ~13s) |
| Build artifacts | `dist/server.js` 2.45 MB · `dist/pdf-server/{index.js 3.98 MB, mcp-app.html 4.42 MB}` present |
| UI bundle (`measure-bundle`) | 1014 KB single-file, within budget |
| Launch chain | `plugin.json` → `/bin/sh bin/launch.sh` → `ensure-bun.sh` (pins bun 1.3.11) → `exec bun dist/server.js` — statically sound, vec0-ABI pin intact |

---

## GATES — do these before relying on it for real reviews

### G1 — Required Ollama models are not installed  ⟵ trivial, highest-leverage
`plugin.json` defaults embeddings to `nomic-embed-text:v1.5` and chat to
`qwen3:8b`. Local `ollama list` has only `granite3.2-vision:2b` and
`qwen2.5vl:7b`. **Neither default model is present**, so ingestion (embed) and
digest/reading-prompts (chat) will fail on first real use.

> Fix: `ollama pull nomic-embed-text:v1.5 && ollama pull qwen3:8b`
> (or set `SCHOLAR_OLLAMA_{EMBED,CHAT}_MODEL` to models you already have).

### G2 — End-to-end workflow has never been exercised
`runtime/` contains only `vendor/` (the vec0 `.so`); **no corpus DB was ever
created, the server was never launched.** All confidence to date is unit /
contract / headless-e2e. The full path — `activate → ingest (Ollama embed) →
search (vec0) → digest (Ollama chat) → annotate` — has zero live coverage.

**Riskiest leg: annotation + UI viewer.** The browser-viewer path
(`display_pdf` / `get_text`) is *deliberately skipped* by the test suite because
it hangs headless (see `lifecycle.test.ts` FIXTURE 4 and the contract test's
"Why no C3 for get_text?" note). Nothing — automated or manual — has ever
driven a live viewer. Treat this as the single highest-risk surface in the
first real session.

### G3 — Live plugin install / spawn unverified
The launch chain is correct on paper (verified statically above), but no real
Claude Code session has loaded the plugin and spawned the MCP server. The only
untested seam is the live spawn itself (does the host set
`CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` and provision bun on first launch).
G2 naturally exercises this — they can be one session.

---

## TIDINESS — maintenance-mode polish, non-blocking

- **T1 — `CLAUDE.md` "Repository state" is stale.** Line 7 still reads
  "Pre-implementation"; all 7 plans are closed and `src/`+`dist/` exist. The
  next Claude instance will be misoriented. Rewrite the section to reflect the
  shipped state. *(Safe, recommended.)*

- **T2 — Open chore `redesign-registry-schemas` needs a user decision.** The
  spec-pipeline XSDs don't match the emitted XML shape, so `xmllint --schema`
  validation is disabled. Its synopsis poses three options: schema-then-data
  retrofit, rewrite-schema-to-fit-data, or drop schemas. Blocks nothing; decide
  the direction or close as won't-fix.

- **T3 — `skills/` naming drift.** Two generations coexist: user-invocable
  `digest` / `ingest` / `status` (with `arguments:`) alongside guide-style
  `scholar-ingest` / `scholar-workflow` (not user-invocable). `ingest` and
  `scholar-ingest` overlap in purpose. Reconcile or document the split so the
  surface is unambiguous.

- **T4 — ~200 MB of dead `--compile` binaries in `bin/`.** `bin/mcp-scholar`
  and `bin/mcp-scholar.exe` (~100 MB each) are pre-pivot relics that contradict
  the slim-plugin design. They are **gitignored** (not repo bloat — tracked
  `bin/` is ~12 KB), so this is only local disk. Safe to `rm`, but surfaced for
  confirmation rather than auto-deleted (not session-created).

- **T5 — Doc-accuracy: confirm the "~2.9 MB plugin" claim.** Uncompressed
  `dist/` is ~10.85 MB; the slim-pivot spec/CLAUDE.md cite ~2.9 MB (plausible at
  3–4× archive compression, not contradicted). `measure-bundle` covers the UI
  only. Run `bun run build` and measure the actual `.plugin` archive to settle
  it, or soften the doc wording.

- **T6 — Deferred edge (item-4).** nu-repoint with `CLAUDE_PLUGIN_DATA` unset →
  unpinned vec0 ABI. `ensure-bun.sh` itself hard-fails cleanly when the var is
  unset; the residual risk is narrowly the nu-CLI repoint path. Decide: harden
  or document-and-accept.

---

## Recommended sequence

1. **G1** (one command) → **G2 + G3** (one live session, watch the annotation/UI
   leg) — this is the actual gate to daily use.
2. **T1** (doc fix) any time; **T4** cleanup when convenient.
3. **T2 / T3 / T5 / T6** as a single "pre-maintenance tidy" pass when the above
   confirms the workflow holds.

---

## Resolution (2026-06-02)

Actioned in one pass; suite stayed green throughout.

| Item | Outcome |
|---|---|
| **G1** | **Deferred to `HUMAN.md`** — Windows `ollama.exe` not reachable from WSL; pull commands + URL caveat recorded there. |
| **G2/G3** | Runbook written: **`docs/runbooks/e2e-smoke-test.md`**, referenced from `HUMAN.md`. Still requires a live session (human). Note: the slim-pivot spec records the **linux launch handshake as already validated**; the untested frontier is the full workflow + the viewer leg. |
| **T1** | Done — `CLAUDE.md` "Repository state"/"Workflow" rewritten to the implemented/maintenance-mode reality; stale `nu/scholar.nu` → `bin/scholar.nu`. |
| **T2** | **Dropped** — chore `redesign-registry-schemas` marked `status="dropped"` in `chores.xml`; desired XSD changes summarized in `HUMAN.md` §3 for upstream reconciliation. |
| **T3** | Done — `scholar-ingest` merged into `ingest` and deleted; `scholar-workflow` renamed → `workflow` (prefix dropped, stale `nu/` + `commands/` refs fixed). `skills/` is now `{digest, ingest, status, workflow}`. |
| **T4** | Done — `bin/mcp-scholar{,.exe}` (~200 MB) removed; also removed stale `out/scholar.heavy.plugin` (81 MB). Both gitignored — local disk only. |
| **T5** | Done — rebuilt: win32 **2.9 MB / 14 files**, linux **2.8 MB / 14 files**. CLAUDE.md "~2.9 MB" claim confirmed accurate; spec file count corrected 15 → 14 (the dedup in T3 accounts for the −1). |
| **T6** | Done — `bin/scholar.nu` bun resolution hardened: honors `SCHOLAR_BUN_PATH` (parity with `lifecycle.ts`), prefers the provisioned pinned bun, and **warns loudly** when falling back to an unpinned PATH bun (the item-4 edge). Verified: warning fires on 1.3.14≠1.3.11; override honored; nu test green. |

**Remaining = G1 + G2/G3 only**, both human-gated and tracked in `HUMAN.md`.

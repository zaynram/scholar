# CLAUDE.md

This file orients future Claude Code instances working in this repository. It captures the load-bearing invariants of the scholar plugin spec; for the full design, read `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md`.

## Repository state

Pre-implementation. The repository contains:

- `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` — the design spec (1.3k lines, frozen by the four-session 2026-05-22 reconciliation pass).
- `docs/superpowers/specs/2026-05-22-scholar-plugin-splits.xml` — the plan-split derivation that maps §6 cycles to seven plans (foundation → corpus → {ingest, extraction, annotations} → frontends → packaging).
- `.claude/context/plans.xml` — the spec-pipeline plan registry (one plan-group, seven children).
- `.claude/context/chores.xml` — the spec-pipeline chore registry (three seeded cross-cutting chores).

Foundation cycle 6.1 is the first plan to execute; it creates `src/`, `package.json`, `tsconfig.json`, `drizzle.config.ts`, the plugin manifest, `.mcp.json`, and the full module skeleton (stubs for every later-plan-owned file). Until then, the only sources of truth are the spec, splits.xml, plans.xml, and chores.xml.

## Workflow

Plan authoring and execution go through the `spec-pipeline` skill. The next step from the current state is `spec-pipeline:spec-to-multi-plan`, which reads the spec + splits.xml and writes one `docs/superpowers/plans/<plan-id>.md` per plan, then sets each plan's `plan-md` attribute in `plans.xml`. Plan execution is the `exec-plan` (single-plan) or `exec-multi-plan` (concurrent wave) workflow; cycles run TDD inside each plan.

Chores are cross-cutting work that doesn't belong to any single §6 cycle (license audit, CI setup, re-vendor process). Add new chores through the spec-pipeline scope-maintenance protocol — not by editing chores.xml directly mid-task.

## Architecture (target system)

> **Slim-plugin pivot (2026-06-01):** packaging changed from a self-contained
> `--compile` binary + bundled runtime to a slim ~2.9 MB plugin. See
> `docs/superpowers/specs/2026-06-01-slim-plugin-pivot.md`. The bullets below
> reflect the post-pivot model.

- **scholar MCP server** — Bun + `bun:sqlite` + `drizzle-orm/bun-sqlite` + `sqlite-vec`, shipped as a `bun build --target=bun` bundle (`dist/server.js`, ~2.5 MB, **not** `--compile`). The `bun` runtime is **provisioned** into `${CLAUDE_PLUGIN_DATA}` by `bin/ensure-bun` at first launch (pinned to `scholar.bundledBunVersion` for the vec0 ABI), not shipped. A shell launcher (`bin/launch.{sh,cmd}`, manifest command `/bin/sh` | `cmd.exe`) provisions-then-runs the server (M2 — SessionStart does not block MCP spawn). Exposes corpus, ingestion, annotation, digest, prompts, search, and UI-resource tools. Spawns the pdf MCP as a child.
- **pdf MCP** — `@modelcontextprotocol/server-pdf@1.7.2`. The vendored `src/vendor/pdf-server/` tree stays in-repo **unmodified** as the §16 `.d.ts` truth source and dev fallback. For packaging it is mechanically **rebundled standalone** (`bun build --target=bun` inlines pdfjs-dist) to `dist/pdf-server/index.js` + `mcp-app.html` — no source patch. `resolveChildEntrypoint` (`src/server/pdf/lifecycle.ts`) prefers `SCHOLAR_PDF_ENTRYPOINT` → shipped `dist/pdf-server/` → vendored dev fallback. Root injection rides the standard MCP `roots/list` + `notifications/roots/list_changed` protocol; scholar implements the client-side responder in `lifecycle.ts`.
- **single-file UI bundle** — React, built by Bun's HTML bundler (`bun build src/ui/index.html --target=browser`, no vite). Five views: corpus dashboard, paper detail, digest panel, reading prompts, reader progress.
- **nu CLI module** — `nu/scholar.nu`, user-facing wrapper that calls scholar MCP tools and shapes responses into nu tables.
- **sqlite3-mcp delegation** — query/backup/pack surfaces are delegated; scholar calls `register_db` per corpus and does **not** reimplement those tools.
- **Ollama (local)** — embeddings (`nomic-embed-text:v1.5` default) and chat (`qwen3:8b` default). The `cowork.askClaude` host fallback is opt-in per request.

## Load-bearing invariants

These are pinned by the spec and frozen for v1; downstream plans must not violate them:

- **§12.0 primitives mandatory.** Every untrusted-input boundary routes through the seven foundation-owned helpers in `src/server/ingest/primitives.ts`: `sanitizeText`, `wrapUntrusted`, `resolveUnderRoot`, `encodeDoi`, `validateArxivId`, `loadVecAndProbeDim`, `initOnce`. Bare string concatenation into prompts, paths, or HTTP requests is forbidden.
- **§7.6 frozen contracts.** `ServerContext`, `PdfChild`, `ConfigAccessor`, `Logger`, `registerTools`, `runRawDdl` are pinned. `ctx.db` is *snapshot-at-entry* (a tool handler snapshots into a local on its first line; `corpus.activate` mutates `ctx.db` in place). Cross-plan helpers take a `tx` first arg; the Ollama client is a foundation singleton imported directly (not on `ServerContext`).
- **Module-skeleton ownership.** Foundation cycle 6.1 *scaffolds* nine tool-module stubs (`corpus.ts`, `roots.ts`, `snapshot.ts`, `ingest.ts`, `pdf.ts`, `papers.ts`, `digest.ts`, `prompts.ts`, `annotations.ts`) and `raw-ddl.ts` as no-ops. Downstream plans *fill bodies*; no plan creates a new tool file or edits a sibling plan's file.
- **No downstream `bun add` or `package.json` edit.** Foundation pre-declares the entire v1 dep set at cycle 6.1 (enumerated in §6.1's "Pre-declaration of dependencies" paragraph). Later cycles `import` from those packages but never edit `package.json` or `bun.lock`. This is what makes the splits.xml `worktree="not-required"` invariant defensible.
- **Mechanical LLM → local Ollama.** Embeddings, digest, and reading-prompts default to local Ollama. `cowork.askClaude` is an explicit per-request opt-in only — never the default path.
- **`raw-ddl.ts` for non-Drizzle objects.** `chunk_vec` (sqlite-vec virtual table) and `reading_queue` (view) are not Drizzle-modelled; their DDL lives in `src/server/db/raw-ddl.ts` and runs through the `runRawDdl(db)` hook invoked by `migrations.ts` after Drizzle migrations.
- **Per-corpus DB files.** Each corpus is its own SQLite file at `runtime/dbs/scholar-<corpus>.db`; the config DB is separate at `runtime/dbs/scholar-config.db`. `PRAGMA foreign_keys = ON` runs on every connection (the pragma is per-connection in SQLite, not per-database).
- **Annotation reconciliation discipline (§13).** Phase 1 reads → phase 2 MCP I/O → phase 3 `db.transaction(...)` with **no awaits inside** the transaction closure. Concurrent `annotations.list` correctness depends on keeping pdf-child round-trips outside the write-lock window.
- **Single active session.** Scholar acquires an exclusive `flock` on `runtime/scholar.lock` at startup; a second instance refuses to start with a structured `SCHOLAR_LOCKED` error.

## Conventions

- **Tool namespace.** All scholar MCP tools start with `scholar.` (e.g., `scholar.corpus.activate`, `scholar.papers.search`). Pdf-child tools surface as `scholar.pdf.*` proxies — never as raw `pdf.*` to the host.
- **TDD per cycle.** Each §6 cycle is independently testable; plans execute cycles Red → Green → optional Refactor. `bun test` is the test runner; tests live next to source as `*.test.ts`.
- **Runtime data gitignored.** Everything under `runtime/` (DBs, locks, downloaded PDFs, snapshots) is per-user state and never committed.
- **Spec is the source of truth.** Section numbers (§7.2, §12.0, §13, etc.) are referenced from code comments and PR descriptions. When the spec disagrees with the code, the spec wins until a deliberate spec edit lands.

## Bun conventions (project-wide)

Default to Bun over Node.js for every operation in this repo:

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`.
- Use `bun test` instead of `jest` or `vitest`.
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`.
- Use `bun install` instead of `npm install` / `yarn install` / `pnpm install`.
- Use `bun run <script>` instead of `npm run <script>` / `yarn run <script>` / `pnpm run <script>`.
- Use `bunx <package> <command>` instead of `npx <package> <command>`.
- Bun automatically loads `.env`, so don't use `dotenv`.

APIs:

- `Bun.serve()` for HTTP/WebSocket (don't add `express`).
- `bun:sqlite` for SQLite (don't add `better-sqlite3`).
- Built-in `fetch` for HTTP clients (don't add `undici` or `ofetch`).
- `Bun.file` for file I/O (prefer over `node:fs`'s readFile/writeFile).
- `Bun.$\`ls\`` for shell-outs (don't add `execa`).

Testing:

```ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

UI bundling uses Bun's HTML bundler (no `vite`, no `vite-plugin-singlefile`). See spec §14.1 step 2 for the exact invocation.

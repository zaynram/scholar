# Scholar — Literature Review Plugin (Design Spec)

> Slug: `2026-05-22-scholar-plugin`
> Status: draft, pre-plan
> Author: zayn (with Claude)
> Date: 2026-05-22

## 1. Context and Motivation

The Daisy Lit Review live artifact (88-paper, 14-section DAISY corpus dashboard) demonstrated the *shape* of a useful literature-review experience: status cycling, scoped Haiku syntheses, change-since-last-open digests, per-paper reading prompts, annotation CRUD round-tripping with the pdf-viewer, and an "open externally / send-to-chat" handoff. Its limitations are structural to the live-artifact form factor:

- **Sandboxed iframe** forces `localStorage` as primary store; persistence is mirrored to a JSON file via PowerShell shell-out.
- **No backend** means anchor extraction is performed via a PowerShell-spawned Python script (uv → pypdf), and chat-session enumeration relies on UIA toggling of the sidebar.
- **No vector layer** means search is limited to literal substring matching.
- **Single-corpus by design** because the papers bundle is embedded into the HTML at build time.
- **No ingestion pipeline** because there is no file watcher and no metadata API integration.

This spec proposes `scholar`, a new Cowork plugin that takes the Daisy artifact as inspiration only: it adopts the proven UX patterns (status / depth / digest / reading prompts / per-paper actions) and discards the constraint workarounds. It builds the system on a real backend (Bun + TypeScript MCP server, SQLite via Drizzle, sqlite-vec for embeddings, local Ollama for mechanical LLM work) and orchestrates the UI through `mcp-apps` views that compose with the bundled (forked) pdf MCP and the existing `sqlite3-mcp` and `nushell-mcp` servers already on the user's machine.

The plugin is explicitly **not** a port of the Daisy artifact. It is a clean reimplementation informed by the artifact's feature catalogue.

## 2. Scope

### In scope (v1)

1. **Plugin packaging** — installable `.plugin` archive with `.claude-plugin/plugin.json`, `.mcp.json`, bundled servers, skills, slash commands, and an MCP App UI bundle.
2. **Bundled forked pdf MCP server** — derived from `@modelcontextprotocol/server-pdf@1.7.2`, preserving the `process.env.MCP_PDF_CLIENT_ROOTS` patch (fixing the latent bug where parsed `roots` is not propagated to `createServer`) and adding runtime multi-root management.
3. **Scholar MCP server** — Bun + TypeScript, exposes corpus management, ingestion, annotation, digest, reading-prompts, and UI-resource tools. Owns the SQLite database.
4. **Multi-corpus support** — named corpora with isolated SQLite DBs and per-corpus PDF roots. Add/remove/switch corpora at runtime.
5. **Persistence** — `better-sqlite3` + Drizzle ORM with `sqlite-vec` extension loaded for embedding columns. Schema migration is owned by scholar; ad-hoc query/inspect surfaces are delegated to `sqlite3-mcp` via `register_db`.
6. **Ingestion** — three paths:
    - BibTeX / RIS file import (via `citation.js`).
    - CrossRef DOI lookup (no auth, free).
    - arXiv abstract API ingest (no auth, free).
    Manual entry (single-paper form) is the fallback.
7. **Semantic search** — `sqlite-vec` index over paper title + abstract + extracted text chunks; embeddings produced via local Ollama (`nomic-embed-text` default; user-pluggable).
8. **Annotation surface** — schema-compatible with the Daisy round-trip (`{ id, page?, anchor?, body, created_at, updated_at, source }`); round-trips with the child pdf MCP (scholar→viewer push, viewer→scholar reconcile-on-read — see §13).
9. **Synthesis / digest / reading prompts** — local Ollama by default (Qwen-class chat model, user-pluggable). Escape hatch to `cowork.askClaude` for high-stakes synthesis where the user explicitly opts in.
10. **Reading queue** — simple priority queue (manual `priority` integer + computed staleness signals); no FSRS in v1.
11. **MCP App view surfaces (5)** — corpus dashboard, paper detail, digest panel, reading prompts pane, reader progress (charts).
12. **Nushell user CLI** — `scholar` nu module (`use scholar.nu *`) with `scholar list`, `scholar status`, `scholar ingest`, `scholar query`, `scholar digest`. Pure UX surface — delegates to scholar MCP via `mcp__nushell__nu_run` style invocations of the MCP CLI client. **No internal logic in nu.**
13. **Backup / distribution** — delegated to `sqlite3-mcp` (`configure_backup` → `backup_to_repo`, `pack_repo` / `unpack_from_git_ref`).

### Out of scope (v1, candidates for v2+)

- FSRS-based spaced repetition reading queue.
- Annotation graph / Zettelkasten edges (the v1 surfaces dropped the "annotation graph panel" from the UI elicitation).
- Semantic Scholar API integration (deferred per user direction).
- OpenAlex integration.
- Mobile / non-Windows packaging.
- Multi-user / shared-corpus syncing.
- Certified PDF signing (the bundled pdf MCP supports image-stamp signatures only).
- Filesystem watcher for auto-ingest of newly-dropped PDFs. v1 ingestion is explicitly user-triggered (BibTeX/RIS, DOI, arXiv, manual); a directory watcher is deferred to v2.

### Non-goals

- Replacing or migrating data from the existing Daisy artifact. Scholar starts fresh; users can manually re-ingest the DAISY corpus into a `daisy` named corpus if desired.
- Becoming a Zotero replacement. Scholar is an opinionated reading-workflow tool, not a general reference manager.

## 3. Constraints

| Constraint | Origin | Implication |
|---|---|---|
| **No `@modelcontextprotocol/server-pdf` npm dependency.** | User directive. | Bundle the dist source as a fork inside the plugin; preserve the `MCP_PDF_CLIENT_ROOTS` patch boundary lines verbatim and fix the unpropagated-`roots` bug while doing so. |
| **PDF roots must be runtime-mutable (add/remove/change default).** | User directive. | The bundled pdf server is spawned as a *child of the scholar server*; scholar restarts it on root-set changes. Roots live in scholar's config table, not in `claude_desktop_config.json`. |
| **Mechanical LLM work routes through local Ollama, not the Claude API.** | User directive. | All routine syntheses, reading-prompt generation, and embedding production default to Ollama. `cowork.askClaude` is opt-in only for high-stakes synthesis. |
| **Default PDF root prompt at install.** | User answer ("user-pick" with `%USERPROFILE%/mcp-data/literature/` override). | First-run wizard sets the initial root; written to scholar's config DB. |
| **Multi-corpus.** | User answer. | All schemas keyed by `corpus_id`; per-corpus DB file (`scholar-<corpus>.db`) under `%USERPROFILE%/mcp-data/scholar/dbs/`. |
| **Metadata sources: CrossRef, arXiv, BibTeX/RIS only.** | User answer. | No Semantic Scholar / OpenAlex code paths in v1. |
| **UI surfaces: 5 listed (no annotation graph panel).** | User answer. | The annotation surface is part of paper detail, not a standalone graph. |
| **Nushell wiring: user CLI only.** | User answer. | Scholar core is TS/Bun; nu module is a thin user-facing wrapper. |
| **Plugin must be installable as a `.plugin` archive.** | Cowork plugin convention. | Build pipeline produces `scholar.plugin` (zip with `.plugin` extension) into Cowork outputs. |

## 4. System Architecture

```
            ┌──────────────────────────────────────────────────────────────────┐
            │                       Cowork / MCP host                          │
            │                                                                  │
            │  ┌────────────┐   ┌──────────────────┐   ┌────────────────────┐  │
            │  │  Chat UI   │   │  MCP App iframes │   │  Tool invocations  │  │
            │  └─────┬──────┘   └────────┬─────────┘   └─────────┬──────────┘  │
            └────────┼───────────────────┼────────────────────────┼────────────┘
                     │                   │                        │
        ┌────────────┴────────┐  ┌───────┴─────────┐  ┌───────────┴────────────┐
        │  scholar.nu module  │  │  scholar UI     │  │  scholar MCP server    │
        │  (user CLI surface) │  │  bundle.html    │  │  (Bun + TypeScript)    │
        └─────────────────────┘  └─────────────────┘  └────────────┬───────────┘
                                                                   │
                ┌──────────────────────────────────────────────────┴───────┐
                │                                                          │
        ┌───────┴─────────┐    ┌───────────────────┐    ┌─────────────────┴────┐
        │  scholar fork:  │    │  sqlite3-mcp      │    │  Local services      │
        │  mcp-pdf-server │    │  (existing)       │    │  - Ollama (embeds +  │
        │  (child proc)   │    │  registers        │    │    chat)             │
        │                 │    │  scholar DB       │    │                      │
        └─────────────────┘    └───────────────────┘    └──────────────────────┘
                │                       │                          │
                └───────────────────────┼──────────────────────────┘
                                        │
                                ┌───────┴────────┐
                                │  SQLite DB     │
                                │  + sqlite-vec  │
                                │  (per corpus)  │
                                └────────────────┘
```

### Component responsibilities

| Component | Responsibility |
|---|---|
| **scholar MCP server (this plugin's core)** | Owns the SQLite schema (Drizzle-managed migrations). Exposes corpus, ingestion, annotation, digest, prompt, search, and UI-resource tools. Spawns and manages the bundled pdf MCP as a child process keyed to the active corpus's roots. |
| **scholar fork of mcp-pdf-server** | Inherited from `@modelcontextprotocol/server-pdf@1.7.2` with the `MCP_PDF_CLIENT_ROOTS` patch preserved and the `roots` propagation bug fixed. Receives root paths from scholar's config; restarts when roots change. |
| **sqlite3-mcp (already installed)** | Provides `query_database`, `inspect_database`, `table_schema`, `configure_backup`, `backup_to_repo`, `pack_repo`, `unpack_from_git_ref`. Scholar calls `register_db` once per corpus DB at activation. We do **not** reimplement query/backup tools. |
| **Ollama (local)** | Embedding production (`nomic-embed-text` default), digest/synthesis chat (Qwen-class default), reading-prompts. Scholar discovers running Ollama via `http://127.0.0.1:11434/api/tags` and falls back to a queue if Ollama is offline. |
| **scholar.nu module** | User-facing thin CLI wrapper. `use scholar.nu *` then `scholar status --corpus daisy` etc. Each command does one MCP call and shapes the response into nu tables. |
| **scholar UI bundle** | Single-file HTML produced by `vite-plugin-singlefile`; React. Five views routed by tool input. Reads from scholar MCP via `app.callServerTool`. Composes with the pdf MCP for paper-detail rendering. |
| **nushell-mcp (already installed)** | Used as a generic command runner if scholar needs to invoke external scripts (e.g., the `bibtex-tidy` CLI already on the user's PATH). Not load-bearing. |

## 5. Project Layout

Plugin source root: `C:\Users\ramda\mcp-data\scholar` (already created).
Plugin runtime root: `%USERPROFILE%\mcp-data\scholar\runtime` (created on first launch).
Build output: `C:\Users\ramda\Documents\Cowork\System\scholar.plugin` (`.plugin` archive).

```
scholar/
├── .claude/
│   ├── context/
│   │   ├── plans.xml          (spec-pipeline canonical plan registry)
│   │   └── chores.xml         (spec-pipeline canonical chore registry)
│   └── settings.json
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json                  (registers scholar + bundled forked pdf as MCP servers)
├── docs/superpowers/specs/
│   └── 2026-05-22-scholar-plugin-design.md   (this file)
├── docs/superpowers/plans/
│   └── (child plan-mds created by spec-pipeline)
├── src/
│   ├── server/                (scholar MCP server)
│   │   ├── index.ts           (stdio entry)
│   │   ├── tools/             (registry.ts + one file per tool)
│   │   ├── db/                (drizzle schema + migrations + raw-ddl)
│   │   ├── ingest/            (citation.js + crossref + arxiv adapters)
│   │   ├── ollama/            (embedding + chat client)
│   │   ├── pdf/               (lifecycle for the child pdf process)
│   │   └── ui/                (resource registration for the App bundle)
│   ├── ui/                    (React MCP App bundle)
│   │   ├── App.tsx
│   │   ├── views/
│   │   │   ├── CorpusDashboard.tsx
│   │   │   ├── PaperDetail.tsx
│   │   │   ├── DigestPanel.tsx
│   │   │   ├── ReadingPromptsPane.tsx
│   │   │   └── ReaderProgress.tsx
│   │   └── lib/               (app.ts wrapper, host-styles wiring)
│   └── vendor/
│       └── pdf-server/        (forked dist + minimal source diff)
├── nu/
│   └── scholar.nu             (user-facing nu module)
├── skills/
│   ├── scholar-workflow/
│   │   └── SKILL.md           (when to use scholar's surfaces)
│   └── scholar-ingest/
│       └── SKILL.md           (ingest workflow guidance)
├── commands/
│   ├── ingest.md              (/scholar:ingest <path-or-doi>)
│   ├── digest.md              (/scholar:digest <corpus> [scope])
│   └── status.md              (/scholar:status [corpus])
├── package.json
├── tsconfig.json
├── vite.config.ts             (single-file UI build)
├── drizzle.config.ts
└── scripts/
    ├── build-plugin.ts        (assembles .plugin archive)
    └── first-run.ts           (interactive PDF-root wizard)
```

### Target files (load-bearing units of work)

The following individual files are enumerated for the threshold helper and the plan-split overlap analyzer. Each is a distinct unit of work tracked across plans.

### 5.1 src/server/index.ts
Stdio entry. Wires the McpServer, registers tools and the UI resource, opens the active corpus DB, spawns the child pdf process.

### 5.2 src/server/db/schema.ts
Drizzle schema for both the config DB and per-corpus DB. Listed in §8.

### 5.3 src/server/db/migrations.ts
Drizzle migration runner invoked at corpus open.

### 5.4 src/server/db/sqlite-vec.ts
Loader for the `sqlite-vec` extension; handles platform-specific dll/dylib resolution.

### 5.5 src/server/tools/corpus.ts
`scholar.corpus.list / create / activate / status` tools.

### 5.6 src/server/tools/roots.ts
`scholar.roots.list / add / remove / set-default` tools; triggers pdf child restart on mutation.

### 5.7 src/server/tools/papers.ts
`scholar.papers.search / update / text` tools.

### 5.8 src/server/tools/annotations.ts
`scholar.annotations.list / upsert / delete`; bidirectional reconciliation with pdf MCP.

### 5.9 src/server/tools/digest.ts
`scholar.digest.generate / show / change-since-last-open`; Ollama-driven by default, opt-in Claude fallback.

### 5.10 src/server/tools/prompts.ts
`scholar.prompts.generate / show`.

### 5.11 src/server/tools/ingest.ts
`scholar.ingest.bibtex / doi / arxiv / manual`.

### 5.12 src/server/tools/pdf.ts
`scholar.pdf.open / search-text / extract-anchors / refresh-extraction`; proxies into the child pdf MCP.

### 5.13 src/server/tools/snapshot.ts
`scholar.snapshot.take` and the change-since-last-open delta logic.

### 5.14 src/server/ingest/citation-js.ts
BibTeX / RIS adapter wrapping `citation.js`.

### 5.15 src/server/ingest/crossref.ts
CrossRef API adapter with polite-tier `mailto`.

### 5.16 src/server/ingest/arxiv.ts
arXiv Atom API adapter with optional PDF download.

### 5.17 src/server/ollama/client.ts
Ollama HTTP client (`/api/tags`, `/api/embeddings`, `/api/chat`).

### 5.18 src/server/ollama/chunker.ts
Token-aware chunker producing 512-token windows with 64-token overlap.

### 5.19 src/server/pdf/lifecycle.ts
Child process supervisor: spawn / SIGTERM / restart / health check, keyed to corpus + roots set.

### 5.20 src/server/ui/resource.ts
Registers `ui://scholar/app.html` and serves the single-file React bundle.

### 5.21 src/ui/App.tsx
React root; wires the App SDK lifecycle (`ontoolinput`, `ontoolresult`, `onhostcontextchanged`).

### 5.22 src/ui/views/CorpusDashboard.tsx
Scope picker, filters, search, paper-card list.

### 5.23 src/ui/views/PaperDetail.tsx
pdf-viewer iframe embed + annotations panel + similar-papers via sqlite-vec.

### 5.24 src/ui/views/DigestPanel.tsx
Synthesis pane + change-since-last-open tab + Claude opt-in.

### 5.25 src/ui/views/ReadingPromptsPane.tsx
Per-paper or per-scope reading-questions panel.

### 5.26 src/ui/views/ReaderProgress.tsx
Chart.js progress charts.

### 5.27 src/ui/lib/app.ts
App SDK wrapper, host-styles wiring, callServerTool helper.

### 5.28 src/vendor/pdf-server/dist/index.js
Vendored forked dist with the `MCP_PDF_CLIENT_ROOTS` patch and `roots` propagation fix.

### 5.29 src/vendor/pdf-server/PATCH.md
Documents the upstream diff for future re-vendoring.

### 5.30 nu/scholar.nu
User-facing nu module.

### 5.31 commands/ingest.md
`/scholar:ingest` slash command.

### 5.32 commands/digest.md
`/scholar:digest` slash command.

### 5.33 commands/status.md
`/scholar:status` slash command.

### 5.34 skills/scholar-workflow/SKILL.md
Skill explaining when to use scholar's surfaces.

### 5.35 skills/scholar-ingest/SKILL.md
Skill for ingestion workflows.

### 5.36 scripts/build-plugin.ts
Build orchestrator that assembles `scholar.plugin`.

### 5.37 scripts/first-run.ts
Interactive PDF-root wizard.

### 5.38 package.json
Manifest with dependencies and Bun scripts.

### 5.39 vite.config.ts
Single-file UI build configuration.

### 5.40 drizzle.config.ts
Drizzle Kit migration generator configuration.

### 5.41 src/server/tools/registry.ts
Tool-registration barrel (foundation-owned). Statically imports every tool module and exposes `registerAll(server, ctx)`. Declares the `ServerContext` type that all tool modules import (type-only). See §7.6.

### 5.42 .claude-plugin/plugin.json
Plugin manifest. Content in §7.1. Foundation-owned (cycle 6.1).

### 5.43 .mcp.json
MCP server registration for the scholar server. Content in §7.1. Foundation-owned (cycle 6.1).

### 5.44 src/server/db/raw-ddl.ts
Idempotent raw-SQL DDL that Drizzle cannot manage: the `chunk_vec` `vec0` virtual table and the `reading_queue` view (`CREATE ... IF NOT EXISTS`). Owned by the `extraction` plan (cycle 6.5 creates `chunk_vec`, cycle 6.6 creates `reading_queue`).

## 6. Implementation Cycles

**Complexity:** 8 (high — multi-process orchestration, vendored fork, embeddings, UI, and CLI wired together).

The following cycles capture TDD-structured work units. Each cycle is independently testable; the dependency relationships are documented per cycle and inform the plan-split (multi-plan) overlap analysis.

### 6.1 Project scaffolding
`package.json`, `tsconfig.json`, `drizzle.config.ts`, Bun runner, basic CI. Owns the server skeleton (`src/server/index.ts`), the Drizzle schema (`src/server/db/schema.ts`), the migration bootstrap (`src/server/db/migrations.ts`), the `sqlite-vec` loader (`src/server/db/sqlite-vec.ts`), and the config DB. Scaffolds the tool-registration skeleton — `src/server/tools/registry.ts` plus a no-op stub for every tool module (`corpus`, `roots`, `snapshot`, `ingest`, `pdf`, `papers`, `digest`, `prompts`, `annotations`) — so downstream plans fill an already-wired file (see §7.6). Authors the plugin manifest (`.claude-plugin/plugin.json`) and `.mcp.json`.
**Touches:** §5.1, §5.2, §5.3, §5.4, §5.38, §5.40, §5.41, §5.42, §5.43.
**Depends-on:** none.

### 6.2 Bundled forked pdf MCP
Vendor v1.7.2 dist into `src/vendor/pdf-server/`, apply the two-line patch preserving the `MCP_PDF_CLIENT_ROOTS` boundary, add `MCP_PDF_CLIENT_ROOTS_PATHS` env support. Tests: child spawn lifecycle.
**Touches:** §5.19, §5.28, §5.29.
**Depends-on:** 6.1.

### 6.3 Corpus + roots tools
`scholar.corpus.*` and `scholar.roots.*` tools. First-run wizard wired so the wizard's output flows to the config DB.
**Touches:** §5.5, §5.6, §5.37.
**Depends-on:** 6.1, 6.2.

### 6.4 Ingestion adapters and tools
citation.js / CrossRef / arXiv adapters plus the `scholar.ingest.*` tools. All remotely-sourced metadata is treated as untrusted: sanitized and length-capped on ingest, and downloaded file paths are constrained under the corpus root (see §12).
**Touches:** §5.11, §5.14, §5.15, §5.16.
**Depends-on:** 6.1, 6.3.

### 6.5 Text extraction + chunk embeddings
`scholar.pdf.refresh-extraction`, chunker, Ollama client. Creates the `chunk_vec` virtual table via raw DDL (`src/server/db/raw-ddl.ts`); consumes the `sqlite-vec` loader scaffolded by cycle 6.1.
**Touches:** §5.12, §5.17, §5.18, §5.44.
**Depends-on:** 6.1, 6.2, 6.3.

### 6.6 Search + reading queue
`scholar.papers.search` (hybrid lexical + sqlite-vec), the `reading_queue` view (raw DDL in `src/server/db/raw-ddl.ts`), `scholar.papers.update` for status/priority/depth/role/section.
**Touches:** §5.7, §5.44.
**Depends-on:** 6.1, 6.5.

### 6.7 Annotation round-trip
`scholar.annotations.*` tools and the bidirectional reconciliation with the child pdf MCP.
**Touches:** §5.8.
**Depends-on:** 6.1, 6.2, 6.3.

### 6.8 Digest + reading prompts
Ollama chat path for syntheses and per-paper reading questions; `cowork.askClaude` opt-in escape.
**Touches:** §5.9, §5.10, §5.17.
**Depends-on:** 6.1, 6.5.

### 6.9 MCP App UI bundle
Five React views, host styling, vite singlefile build, UI-resource registration.
**Touches:** §5.20, §5.21, §5.22, §5.23, §5.24, §5.25, §5.26, §5.27, §5.39.
**Depends-on:** 6.4, 6.5, 6.6, 6.7, 6.8.

### 6.10 nu module + slash commands + skills
User-facing surfaces: `scholar.nu`, `/scholar:ingest`, `/scholar:digest`, `/scholar:status`, and the two skills.
**Touches:** §5.30, §5.31, §5.32, §5.33, §5.34, §5.35.
**Depends-on:** 6.4, 6.5, 6.6, 6.7, 6.8.

### 6.11 Snapshots + change-since-last-open
`scholar.snapshot.take` and the delta-digest computation that diffs against the most recent snapshot.
**Touches:** §5.13.
**Depends-on:** 6.1.

### 6.12 sqlite3-mcp registration integration
`register_db` on corpus activation (wired into `src/server/tools/corpus.ts`). The backup/distribution recipe is specified in §14.2; this cycle produces no separate doc file.
**Touches:** §5.5.
**Depends-on:** 6.1.

### 6.13 Plugin build
`scripts/build-plugin.ts` — the build orchestrator that assembles the `scholar.plugin` archive. The first-run PDF-root wizard is owned by cycle 6.3, not here.
**Touches:** §5.36.
**Depends-on:** 6.9, 6.10.

## 7. Plugin Manifest and MCP Server Design

### 7.1 Plugin manifest

`.claude-plugin/plugin.json`:
```json
{
  "name": "scholar",
  "version": "0.1.0",
  "description": "Literature review workspace. Multi-corpus reading, annotation, semantic search, Ollama-powered syntheses, and a forked pdf MCP. Inspired by but independent of the Daisy Lit Review artifact.",
  "author": { "name": "zayn" },
  "keywords": ["literature-review", "research", "mcp-apps", "annotations", "ollama", "sqlite-vec"],
  "license": "MIT"
}
```

`.mcp.json`:
```json
{
  "mcpServers": {
    "scholar": {
      "command": "bun.exe",
      "args": ["run", "--cwd=${CLAUDE_PLUGIN_ROOT}", "src/server/index.ts"],
      "env": {
        "SCHOLAR_RUNTIME_ROOT": "${HOME}/mcp-data/scholar/runtime",
        "SCHOLAR_OLLAMA_URL": "http://127.0.0.1:11434",
        "SCHOLAR_OLLAMA_EMBED_MODEL": "nomic-embed-text",
        "SCHOLAR_OLLAMA_CHAT_MODEL": "qwen2.5:7b-instruct"
      }
    }
  }
}
```

Note: the **bundled pdf server is NOT registered in `.mcp.json`**. It is spawned by the scholar server itself as a child process. Rationale: PDF roots are corpus-scoped and runtime-mutable, so the child must be restartable from inside scholar's control loop. Registering it as a top-level MCP server would freeze the roots at host startup.

### 7.2 The forked pdf MCP

**Approach:** vendor the `@modelcontextprotocol/server-pdf@1.7.2` `dist/` tree into `src/vendor/pdf-server/`. The fork applies one minimal patch:

```diff
  if (stdio) {
    let roots = useClientRoots
    if (!roots) {
      const setting = Number.parseInt(process.env.MCP_PDF_CLIENT_ROOTS)
      roots = Number.isNaN(setting) ? true : Boolean(setting)
      if (!roots) console.error("[pdf-server] Client roots are ignored. Unset MCP_PDF_CLIENT_ROOTS (or assign to '1') to enable.")
    }
-   await startStdioServer(() => createServer({ enableInteract: true, useClientRoots, debug }));
+   await startStdioServer(() => createServer({ enableInteract: true, useClientRoots: roots, debug }));
  }
```

That fixes the latent bug where the env-var-derived `roots` was computed but discarded. The patched lines surrounding the env-var introduction are preserved verbatim.

The fork also accepts a new env var `MCP_PDF_CLIENT_ROOTS_PATHS` (comma-separated absolute paths). When set, the server uses these as the explicit allowed roots instead of (or in addition to) the positional CLI args. This is what scholar sets when spawning the child.

**Lifecycle:** scholar's `pdf` module manages a single child `bun.exe run src/vendor/pdf-server/dist/index.js --stdio` process. On corpus switch or root mutation, scholar:
1. Sends `SIGTERM` to the child.
2. Updates `MCP_PDF_CLIENT_ROOTS_PATHS`.
3. Respawns.
4. Drops cached `viewUUID`s (any open viewer becomes stale).

The host sees the scholar server's `pdf.*` proxy tools (see §10), not the forked server directly.

### 7.3 Scholar core MCP server

Entry: `src/server/index.ts`. Uses `@modelcontextprotocol/sdk` over stdio. On startup:

1. Resolves `SCHOLAR_RUNTIME_ROOT`, ensures `runtime/dbs/` exists.
2. Reads `runtime/config.json` (corpora list, active corpus, default PDF root, Ollama model overrides).
3. First-run handling is **not** done at startup. When a corpus tool (`scholar.corpus.list` / `scholar.corpus.activate`) runs and finds no corpus configured, it calls the first-run routine in `scripts/first-run.ts`, which uses the live MCP session's `elicitInput` request to ask the host for the initial PDF root, then writes the result into `runtime/config.json` and the config DB. `first-run.ts` is a module imported by `src/server/tools/corpus.ts` (both `corpus`-plan owned) — not a standalone executable.
4. Opens the active corpus's `scholar-<corpus>.db` via better-sqlite3, runs Drizzle migrations, loads the `sqlite-vec` extension. (Deferred until a corpus is active.)
5. Spawns the pdf child with the active corpus's roots. (Deferred until a corpus is active.)
6. Registers itself with sqlite3-mcp by calling `mcp__sqlite3-mcp__register_db` once per corpus DB (best-effort; ignored if sqlite3-mcp is not running).
7. Registers MCP tools and the UI resource (see §10 and §11).

### 7.4 sqlite3-mcp integration

Scholar treats sqlite3-mcp as a **complementary** service:

| Need | Scholar implements | Delegated to sqlite3-mcp |
|---|---|---|
| Schema migrations | ✔ via Drizzle | — |
| Domain-specific reads/writes | ✔ as MCP tools | — |
| Ad-hoc SQL exploration | — | `query_database`, `inspect_database`, `table_schema`, `list_tables` |
| Backups | — | `configure_backup`, `backup_local`, `backup_to_repo`, `get_backup_config` |
| Distribution (corpus snapshots) | — | `pack_repo`, `pack_local`, `unpack_from_git_ref`, `unpack_from_tarball` |
| Cross-corpus copy | — | `copy_database` |

When scholar opens a corpus, it calls `register_db` with that corpus's path under name `scholar:<corpus>`. When the user runs `/sqlite3-mcp query_database scholar:daisy "SELECT count(*) FROM papers"` they get the result without scholar mediating.

### 7.5 Nushell module

`nu/scholar.nu` exports user-facing commands. All commands shell out to the scholar MCP via a small `nu_invoke` helper that wraps the official MCP client CLI invoked as a child process. **Transport is decided: the MCP client CLI** — the named-pipe alternative considered earlier is dropped. One example:

```nu
export def main [] { scholar status }

export def status [
  --corpus(-c): string  # corpus name; defaults to active
] {
  let payload = {tool: "corpus.status", args: {corpus: $corpus}}
  $payload | to json | nu_invoke | from json | get papers | sort-by status
}
```

This file is purely user ergonomics. No business logic. The `nu-fluency` skills (`nushell-idioms`, `nushell-records`) inform style; the `nu-audit` hook keeps it idiomatic.

### 7.6 Tool registration contract

To keep the seven plans' blast-radii file-disjoint — and therefore the `worktree="not-required"` decision in the splits file sound rather than aspirational — tool wiring follows a fixed convention:

- Cycle 6.1 (`foundation`) creates `src/server/tools/registry.ts` and a **no-op stub** for every tool module: `corpus.ts`, `roots.ts`, `snapshot.ts`, `ingest.ts`, `pdf.ts`, `papers.ts`, `digest.ts`, `prompts.ts`, `annotations.ts`. Each stub exports `export function registerTools(server: McpServer, ctx: ServerContext): void {}`.
- `registry.ts` statically imports all stubs and exposes `registerAll(server, ctx)`, which calls each module's `registerTools`. Because the stubs exist from cycle 6.1, `registry.ts` and `src/server/index.ts` compile before any downstream plan runs.
- Each downstream plan **fills the body** of its own stub(s) only. It never edits `registry.ts`, `index.ts`, or a sibling plan's tool file. Wave ordering guarantees `foundation` (wave 0) completes before any stub is filled; the only concurrent wave (wave 2 — `ingest`, `extraction`, `annotations`) touches file-disjoint stubs.
- `ServerContext` (DB handles, the pdf child handle, the Ollama client, config accessors) is declared in `registry.ts` and imported type-only by every tool module.

This convention — not mere file-path partitioning — is what makes concurrent execution of wave 2 collision-free.

## 8. Data Model (Drizzle schema)

One SQLite file per corpus: `runtime/dbs/scholar-<corpus>.db`. All tables scoped to that file; no cross-corpus joins. The plugin's *config* (the corpora registry, default roots, model overrides) lives in `runtime/dbs/scholar-config.db`.

### 8.1 Config DB (`scholar-config.db`)

```typescript
export const corpora = sqliteTable("corpora", {
  id:           text("id").primaryKey(),            // slug, e.g. "daisy"
  display_name: text("display_name").notNull(),
  pdf_root:     text("pdf_root").notNull(),         // absolute path
  created_at:   text("created_at").notNull(),
  archived_at:  text("archived_at"),                // null = active
});

export const pdf_roots = sqliteTable("pdf_roots", {
  id:         integer("id").primaryKey({ autoIncrement: true }),
  corpus_id:  text("corpus_id").references(() => corpora.id),
  path:       text("path").notNull(),
  is_default: integer("is_default", { mode: "boolean" }).default(false),
});

export const settings = sqliteTable("settings", {
  key:   text("key").primaryKey(),
  value: text("value").notNull(),  // JSON-encoded
});
```

### 8.2 Per-corpus DB (`scholar-<corpus>.db`)

```typescript
// Papers — the canonical entity.
export const papers = sqliteTable("papers", {
  id:           text("id").primaryKey(),       // ULID
  key:          text("key").notNull().unique(),// human-friendly bibkey, e.g. "smith2024scaling"
  title:        text("title").notNull(),
  authors:      text("authors"),               // "Last, First; Last, First"
  year:         integer("year"),
  venue:        text("venue"),
  doi:          text("doi"),                   // canonical
  arxiv_id:     text("arxiv_id"),
  pdf_path:     text("pdf_path"),              // absolute, must be under some pdf_root
  role:         text("role"),                  // free-form: paper's role in the corpus
  section:      text("section"),               // free-form: organizational section
  depth:        text("depth"),                 // "cited" | "background" | "deep"
  status:       text("status").notNull().default("pending"), // pending|reading|reviewed|skip
  priority:     integer("priority").notNull().default(0),
  abstract:     text("abstract"),
  imported_via: text("imported_via"),          // "bibtex" | "ris" | "crossref" | "arxiv" | "manual" (untrusted; sanitized on ingest — see §12)
  imported_at:  text("imported_at").notNull(),
  status_touched_at: text("status_touched_at"),
});

// Full extracted text + chunked embeddings for search.
export const paper_text = sqliteTable("paper_text", {
  paper_id: text("paper_id").primaryKey().references(() => papers.id),
  text:     text("text").notNull(),
  pages:    integer("pages"),
  extracted_at: text("extracted_at").notNull(),
  extractor: text("extractor"),                // "child-pdf-mcp" — the only v1 extractor; column kept for forward-compat
});

export const paper_chunks = sqliteTable("paper_chunks", {
  id:        text("id").primaryKey(),
  paper_id:  text("paper_id").references(() => papers.id),
  ordinal:   integer("ordinal").notNull(),
  page:      integer("page"),
  text:      text("text").notNull(),
});

// sqlite-vec virtual table: chunk embeddings.
// Created by src/server/db/raw-ddl.ts (§5.44) — NOT Drizzle-managed.
// CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(
//   chunk_id TEXT PRIMARY KEY,
//   embedding FLOAT[768]  -- nomic-embed-text dim
// );

export const annotations = sqliteTable("annotations", {
  id:         text("id").primaryKey(),         // matches Daisy schema for compat
  paper_id:   text("paper_id").references(() => papers.id),
  page:       integer("page"),
  anchor:     text("anchor"),
  body:       text("body").notNull(),
  source:     text("source").notNull(),        // "scholar" | "pdf-viewer"
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const anchor_cache = sqliteTable("anchor_cache", {
  paper_id:     text("paper_id").primaryKey().references(() => papers.id),
  anchors_json: text("anchors_json").notNull(), // array of {text, page}
  pages:        integer("pages"),
  generated_at: text("generated_at").notNull(),
  extractor:    text("extractor"),
});

export const reading_prompts = sqliteTable("reading_prompts", {
  paper_id:     text("paper_id").primaryKey().references(() => papers.id),
  prompts_json: text("prompts_json").notNull(),
  generated_at: text("generated_at").notNull(),
  model:        text("model"),                 // which Ollama model produced these
});

export const digests = sqliteTable("digests", {
  id:           text("id").primaryKey(),
  scope_key:    text("scope_key").notNull(),   // "all" | "section:foo" | "stale" | "selection:<hash>"
  body_md:      text("body_md").notNull(),
  generated_at: text("generated_at").notNull(),
  model:        text("model"),
  paper_count:  integer("paper_count"),
});

export const snapshots = sqliteTable("snapshots", {
  id:         text("id").primaryKey(),
  taken_at:   text("taken_at").notNull(),
  payload:    text("payload").notNull(),       // JSON summary of status_overrides + selection
  trigger:    text("trigger"),                 // "open" | "manual"
});

// Reading-queue ordering — derived view; uses priority + staleness + status.
// Created by src/server/db/raw-ddl.ts (§5.44) — NOT Drizzle-managed.
// CREATE VIEW IF NOT EXISTS reading_queue AS
//   SELECT id, key, title, status, priority,
//          (julianday('now') - julianday(status_touched_at)) AS days_since_touch
//   FROM papers
//   WHERE status IN ('pending','reading')
//   ORDER BY status='reading' DESC, priority DESC, days_since_touch DESC;

export const citations = sqliteTable("citations", {
  citing_id:  text("citing_id").references(() => papers.id),
  cited_id:   text("cited_id").references(() => papers.id),
  // composite PK ON (citing_id, cited_id)
});
```

**Note on the citation table:** populated opportunistically from CrossRef `references` data when available; never blocked on. The v1 UI does not visualize the citation graph, but the data is captured so v2 can.

## 9. MCP App Views

The single bundled HTML resource (`ui://scholar/app.html`) dispatches on the `view` field in tool input/result `structuredContent`. The five views:

### 9.1 Corpus dashboard (`view: "dashboard"`)

Adapts the Daisy main view. Shows: active corpus chip, scope picker (all / section / selection / stale), filters (status, depth), search box, list of papers as cards. Each card surfaces title, authors, year, role, status badge, depth badge, "open in pdf-viewer" button, "send to chat" button, an annotations count, and an inline reading-prompts expansion.

Differences from Daisy: search is **semantic** (sqlite-vec) when Ollama is available, lexical otherwise; the scope chips include "queue" (sorted by `reading_queue` view); the "send to chat" button routes through `app.sendMessage` (the MCP App SDK primitive) instead of the PowerShell + clipboard hack.

### 9.2 Paper detail (`view: "paper", paper_id: ...`)

Two-column layout. Left: an in-panel PDF render produced by **bundled pdf.js** (the library, bundled into the single-file UI — *not* a nested MCP App iframe). Right: paper metadata, annotations list (with CRUD), reading prompts, and a "similar papers" panel populated by `chunk_vec` k-NN search. An "open in pdf-viewer" action hands off to the full pdf-viewer plugin for heavyweight viewing.

The annotation list uses the **same schema and IDs as the child pdf MCP's annotation store**. Edits in scholar's panel call `app.callServerTool("annotations.upsert", ...)`, which writes scholar's row and forwards the change to the child pdf MCP. Edits made in an external pdf-viewer are reconciled when the paper detail view is (re)opened or explicitly refreshed — see §13 for the reconciliation model.

### 9.3 Digest panel (`view: "digest", scope_key: ...`)

The synthesis pane. Defaults to the current scope. Shows the cached digest if recent; otherwise calls `app.callServerTool("digest.generate", {scope_key})` which runs the Ollama chat model against a `paperLine`-style corpus slice (preserving the Daisy prompt skeleton but rewriting it for Qwen). A second tab shows the change-since-last-open digest (computed against the most recent `snapshots` row).

A "use Claude instead" affordance opt-in routes the request through `cowork.askClaude`. This is the only path that consumes Claude API budget.

### 9.4 Reading prompts pane (`view: "prompts", paper_id?: ...`)

Per-paper or per-scope. Per-paper: the 3 Haiku-style questions, cached in `reading_prompts`. Per-scope: an aggregated "what to read for" prompt set, regenerated on scope change.

### 9.5 Reader progress (`view: "progress"`)

Chart.js — **bundled** into the single-file UI build, no runtime CDN dependency — bars by section + ring chart of overall status mix + sparkline of reviewed-per-week over the last 12 weeks (computed from `status_touched_at` history if available, otherwise the current snapshot only).

### 9.6 Host styling

All five views consume `--color-background-*`, `--color-text-*`, `--font-sans/mono` from `onhostcontextchanged`. Fallbacks are explicit so the views also render correctly when opened standalone.

## 10. Tool Surface

All scholar tools are namespaced `scholar.<verb>`. Visibility annotations are explicit:
- `["app", "model"]` (default) — both the UI and the LLM can call.
- `["app"]` — UI-only, hidden from the LLM (used for chatty/streaming UI tools).
- `["model"]` — model-only, no UI consumer.

| Tool | Visibility | Purpose | Linked resource |
|---|---|---|---|
| `scholar.dashboard` | both | Open the dashboard view for a corpus. | `ui://scholar/app.html` |
| `scholar.paper.show` | both | Open paper detail. | `ui://scholar/app.html` |
| `scholar.digest.show` | both | Open digest panel. | `ui://scholar/app.html` |
| `scholar.prompts.show` | both | Open reading prompts pane. | `ui://scholar/app.html` |
| `scholar.progress.show` | both | Open reader progress. | `ui://scholar/app.html` |
| `scholar.corpus.list` | model | List corpora. | — |
| `scholar.corpus.create` | model | Create a corpus (slug, display_name, initial pdf_root). | — |
| `scholar.corpus.activate` | model | Switch active corpus. | — |
| `scholar.corpus.status` | both | Counts + last_opened + stale list for the active corpus. | — |
| `scholar.roots.list` | both | List PDF roots for the active corpus. | — |
| `scholar.roots.add` | both | Add a PDF root (restarts child pdf MCP). | — |
| `scholar.roots.remove` | both | Remove a PDF root. | — |
| `scholar.roots.set-default` | both | Set the default root for "open in viewer". | — |
| `scholar.ingest.bibtex` | model | Import a `.bib` or `.ris` file (uses citation.js). | — |
| `scholar.ingest.doi` | model | CrossRef DOI lookup → paper row. | — |
| `scholar.ingest.arxiv` | model | arXiv ID/URL → paper row + PDF download (if root allows). | — |
| `scholar.ingest.manual` | model | Single-paper manual entry. | — |
| `scholar.papers.search` | both | Hybrid lexical + sqlite-vec search. | — |
| `scholar.papers.update` | model | Update status / priority / depth / role / section. | — |
| `scholar.papers.text` | app | Get extracted text for a paper (chunked). | — |
| `scholar.annotations.list` | both | Annotations for a paper. | — |
| `scholar.annotations.upsert` | both | Create or update an annotation. | — |
| `scholar.annotations.delete` | both | Delete by id. | — |
| `scholar.prompts.generate` | both | Generate / refresh reading prompts for a paper. | — |
| `scholar.digest.generate` | both | Generate / refresh a scoped digest. | — |
| `scholar.digest.change-since-last-open` | app | Compute and render the delta digest. | — |
| `scholar.pdf.open` | both | Open a paper in the pdf-viewer (proxies to child pdf MCP). | — |
| `scholar.pdf.search-text` | app | Highlight a query in the active viewer. | — |
| `scholar.pdf.extract-anchors` | app | Run the anchor extractor on a paper (replaces the PowerShell + uv + pypdf chain). | — |
| `scholar.pdf.refresh-extraction` | model | Re-extract text + chunks + embeddings. | — |
| `scholar.snapshot.take` | model | Snapshot status_overrides + selection (used by the change-since-last-open digest). | — |

## 11. Ollama Integration

### Model defaults

- **Embeddings:** `nomic-embed-text` (768-dim, fast, MIT). Documented as user-pluggable via `SCHOLAR_OLLAMA_EMBED_MODEL`.
- **Chat (digest + reading prompts):** `qwen2.5:7b-instruct`. User-pluggable via `SCHOLAR_OLLAMA_CHAT_MODEL`.

### Discovery

On scholar startup, scholar `GET`s `http://127.0.0.1:11434/api/tags`. If the call fails or the configured model is missing, scholar logs a warning and degrades gracefully:
- Embeddings tasks queue in `paper_chunks` without embedding rows.
- Digest / reading prompts return a "Ollama unavailable; configure or start ollama" placeholder *unless* the user has explicitly opted into the Claude fallback for this request.

### Fallback to `cowork.askClaude`

The UI surfaces a per-action "use Claude instead" toggle. When the user opts in, scholar's MCP tool returns — instead of a generated body — a typed sentinel in `structuredContent`:

```typescript
// structuredContent.askClaude present ⇒ the UI forwards to Claude.
askClaude?: {
  prompt: string;   // fully-shaped, server-side prompt
  data: unknown;    // structured context payload
  reason: string;   // "ollama-offline" | "user-opt-in"
}
```

On seeing `structuredContent.askClaude`, the UI calls `window.cowork.askClaude(askClaude.prompt, askClaude.data)` (a host-provided global in the MCP App iframe) and renders the result. This sentinel shape is the contract shared between the producers (`src/server/tools/digest.ts`, `prompts.ts`) and the consumer (`src/ui/views/DigestPanel.tsx`). It keeps Claude API usage off the default path while preserving an explicit escape hatch.

### Embedding pipeline

1. On `scholar.pdf.refresh-extraction`, scholar extracts the paper text via the bundled pdf MCP's `get_text` interaction.
2. Text is split into ~512-token chunks with 64-token overlap.
3. Chunks are written to `paper_chunks`.
4. For each chunk, scholar calls Ollama `/api/embeddings`, writes the result to `chunk_vec`.
5. The whole pipeline is idempotent (chunk IDs are deterministic from `paper_id + ordinal`).

## 12. Citation / Metadata Pipeline

**Input trust.** All fields returned by CrossRef and arXiv, and all parsed BibTeX/RIS fields, are untrusted input. Before persistence: strings are length-capped (title ≤ 1024, abstract ≤ 16384, authors ≤ 4096 chars), control characters are stripped, and the text is treated as untrusted data — delimited, never concatenated as instructions — wherever it later flows into an Ollama or Claude prompt. React views escape all rendered metadata. This applies to every ingest path below.

### 12.1 BibTeX / RIS (citation.js)

`scholar.ingest.bibtex` accepts a file path or pasted text. Uses `citation.js` to parse to CSL-JSON, then maps to the scholar paper schema. Duplicate detection is by `doi`, then `(title, year, first-author-last-name)`.

### 12.2 CrossRef DOI

`scholar.ingest.doi` calls `https://api.crossref.org/works/<doi>?mailto=<user-email>`. The `mailto` parameter routes to CrossRef's "polite" tier. Mapped fields: title, authors, year, venue, abstract, references (citation graph candidates).

### 12.3 arXiv

`scholar.ingest.arxiv` accepts either an arXiv ID or URL. The `<id>` is validated against the arXiv identifier grammar (`\d{4}\.\d{4,5}(v\d+)?`, or the legacy `archive/YYMMNNN` form) before use. Calls `http://export.arxiv.org/api/query?id_list=<id>`. If PDF download is enabled and the corpus's default PDF root is writable, scholar fetches the PDF into `<default-root>/arxiv/<id>.pdf`. The destination is resolved to an absolute path and asserted to be a child of the default root before any write — a path that escapes the root aborts the download — then `pdf_path` is set.

### 12.4 Manual

A no-op metadata path: the form lets the user supply title/authors/year/venue/pdf_path and skip API lookup entirely.

## 13. Annotation Round-trip

The bundled pdf MCP supports `add_annotations` / `update_annotations` / `remove_annotations` with the type catalogue listed in the pdf-viewer plugin's `view-pdf` skill. Scholar's annotation table mirrors that schema (`{id, page?, anchor?, body, source, created_at, updated_at}`); `id`s are stable across both stores.

**Propagation model.** v1 does **not** assume the child pdf MCP emits annotation-change notifications — that behaviour is unverified against `server-pdf@1.7.2`. Propagation is therefore poll/reconcile, not event-push:

1. *scholar → viewer (push).* A `scholar.annotations.upsert` / `.delete` writes scholar's row, then immediately forwards the change to the child pdf MCP via `interact: { commands: [{ type: "add_annotations" | "update_annotations" | "remove_annotations", ... }] }` with a derived rectangle (from the anchor if available, else a margin sticky-note).
2. *viewer → scholar (reconcile-on-read).* Whenever scholar needs the current annotation set — on opening/refreshing the paper detail view, and after any scholar-initiated viewer interaction — it reads the child pdf MCP's annotation list and reconciles against its table. Divergence is resolved **last-write-wins keyed on `updated_at`**; rows new to scholar are written with `source: "pdf-viewer"`.

If a future re-vendor of the pdf MCP is confirmed to emit `resources/updated` for annotations, scholar may additionally `subscribeResource` to make reconciliation eager — a v2 optimization, not a v1 dependency.

ID stability is preserved across both paths.

## 14. Build Pipeline + Distribution

### 14.1 Build steps

1. `bun run build:server` — `tsc` typecheck + `bun build src/server/index.ts --target=bun --outdir=build/server`.
2. `bun run build:ui` — vite + `vite-plugin-singlefile` → `build/ui/app.html` (≤ 5 MB, well within the iframe-resource budget).
3. `bun run build:pdf` — copies the vendored forked pdf dist to `build/vendor/pdf-server/`. No transpilation required; the patch is applied at vendor time.
4. `bun run build:nu` — copies `nu/scholar.nu` into the bundle.
5. `bun run build:plugin` — assembles a tree at `build/plugin/` matching the installable layout, then zips it as `scholar.plugin` in `%USERPROFILE%\Documents\Cowork\System\` for the user to install via Cowork's plugin import.

### 14.2 Distribution

- The `.plugin` archive is installed via Cowork's plugin import UI.
- First launch invokes `scripts/first-run.ts` which elicits the default PDF root (per the user's "user-pick" choice).
- The user can later distribute a *corpus* (not the plugin itself) via sqlite3-mcp's `pack_repo` against `scholar-<corpus>.db`, producing a git ref another user can `unpack_from_git_ref` into their scholar installation.

## 15. Cycle Sequencing

Cycles are enumerated in §6 (Implementation Cycles) with per-cycle `Touches` / `Depends-on` declarations. The spec-pipeline `ingest-spec` workflow uses §6 as the authoritative cycle list when deriving the plan-split. The dependency graph supports a multi-plan split with up to three independent waves between scaffolding and final packaging.

## 16. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Ollama unavailable when user expects digests. | Graceful degradation (placeholder + warning toast); explicit "use Claude" opt-in for any single request. |
| sqlite-vec extension load fails on the user's system. | Detect at startup; if load fails, fall back to lexical-only search and log a remediation hint (the dll has to be co-located with the better-sqlite3 binary on Windows; ship the binary in `build/vendor/sqlite-vec/`). |
| Forked pdf server diverges from upstream. | Keep the patch surface to **two lines plus one new env var read**. Document the diff in `src/vendor/pdf-server/PATCH.md`. Re-vendoring on upstream bump is a one-screen review. |
| Annotation reconciliation conflicts (user edits in both panes concurrently). | Last-write-wins keyed by `updated_at`; scholar reconciles on paper-detail open/refresh (§13). Test with a deliberate concurrent-edit race. |
| Embedding production blocks tool responses on big papers. | Embedding pipeline runs on an in-process async queue with a small concurrency limit (a worker thread is deferred to v2 if profiling shows main-thread starvation); tools that need embeddings (`scholar.papers.search` with semantic mode) check readiness and degrade to lexical with a "still indexing" pill. |
| User installs the plugin without the global `bun.exe`. | `.mcp.json` could optionally use `node` if a `--node` build is also published. v1 documents the requirement; v2 considers compiling scholar with `bun build --compile` to a single exe. |
| The Cowork outputs folder isn't where the user installs from. | The build script writes a copy to both `%USERPROFILE%\Documents\Cowork\System\` and (best-effort) the user's Cowork plugin-import staging directory; surfaces a chat link. |

## 17. Decisions Log (Pre-Plan)

- Plugin slug → **`scholar`**.
- Corpus model → **multi-corpus** (corpus_id keys all per-corpus tables).
- Persistence → **better-sqlite3 + Drizzle** with `sqlite-vec`.
- Metadata sources → **CrossRef + arXiv + BibTeX/RIS**. (No Semantic Scholar, no OpenAlex.)
- Reading queue → **simple priority** (no FSRS).
- Semantic search → **sqlite-vec + local Ollama**.
- Nushell wiring → **user-facing CLI only**.
- PDF root default → **prompt at install** with `%USERPROFILE%/mcp-data/literature/` as the suggested override path.
- Mechanical LLM work → **Ollama by default**; `cowork.askClaude` is opt-in only.
- pdf MCP → **bundled fork of v1.7.2** (vendored dist, two-line patch, new `MCP_PDF_CLIENT_ROOTS_PATHS` env).
- sqlite3-mcp integration → **delegate query/backup/pack** surfaces to it via `register_db`.
- Tool wiring → **registry barrel + foundation-scaffolded stubs** (§7.6) so the seven plans' blast-radii stay file-disjoint.
- First-run wizard → **server-side `elicitInput`, invoked lazily by the corpus tool**; not a standalone script.
- nu transport → **MCP client CLI** (named-pipe alternative dropped).
- Annotation propagation → **scholar→viewer push + viewer→scholar reconcile-on-read**, LWW on `updated_at`; no dependency on pdf-MCP push notifications.
- Paper-detail PDF render → **bundled pdf.js in scholar's own iframe**; not a nested MCP App iframe.
- Chart.js and pdf.js → **bundled** into the single-file UI; no runtime CDN dependency.

---

End of spec. Hand off to `spec-pipeline:spec-pipeline` for `spec-to-multi-plan` synthesis.

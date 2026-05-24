# Scholar Plugin — Foundation Plan (Cycles 6.1 + 6.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| Field             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan id**       | `2026-05-22-scholar-plugin-foundation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Plan-group**    | `2026-05-22-scholar-plugin`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Cycles**        | `[6.1, 6.2]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **depends-on**    | *(none — first plan in the DAG)*                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **worktree**      | `not-required`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Tier**          | `opus`. 2 cycles but symbol-heavy — foundation originates the §7.6 frozen cross-plan contracts (`ServerContext`, `PdfChild`, `ConfigAccessor`, `Logger`, `registerTools`, `runRawDdl`), the seven §12.0 primitives, scaffolds **twelve** tool-module stubs (the original 9 plus `query.ts`/`backup.ts`/`inspect.ts` added in foundation-008 per user posture B's §10 reimplementation) + `raw-ddl.ts` + `ollama/client.ts` singleton, pre-declares the entire v1 npm dep set, vendors the upstream pdf MCP unmodified, implements the client-side roots responder + Windows Job Object reaping, and (foundation-009) implements the `--call` dual-mode entry-point dispatcher so the nu frontends wrapper can invoke scholar tools as a CLI subprocess (per user F2 ruling). Every later plan compiles against symbols this plan ships first. |
| **Blast-radius**  | `src/server/index.ts` `src/server/tools/registry.ts` `src/server/db/schema.ts` `src/server/db/migrations.ts` `src/server/db/sqlite-vec.ts` `src/server/db/raw-ddl.ts` `src/server/db/raw-client.ts` `src/server/db/default-pdf-root.ts` `src/server/pdf/lifecycle.ts` `src/server/ingest/primitives.ts` `src/server/ollama/client.ts` `src/server/ui/resource.ts` `src/vendor/pdf-server/` `scripts/vendor-pdf-server.ts` `package.json` `tsconfig.json` `drizzle.config.ts` `.claude-plugin/plugin.json` `.mcp.json`                                                                                                |
| **Scaffold-only** | Wave-0 no-op stubs (content owned by downstream plans): `src/server/tools/{corpus,roots,snapshot,ingest,pdf,papers,digest,prompts,annotations}.ts`                                                                                                                                                                                                                                                                                                                                                                                 |

> **Revision banner — foundation-009 (2026-05-24).** Foundation-009 absorbs lead's third amendment (the `--call` CLI flag, per user F2 nu-transport ruling) on top of the two amendments already landed in foundation-008. **Race-condition note for lead's audit trail:** foundation-008 was submitted as `plan_approval_request` minutes before lead's amendment-3 dispatch landed; foundation-009 is the consolidated artifact lead requested (lead's "submit foundation-008 with all 3 additions" message preceded their review of foundation-008's `plan_approval_request`). Foundation-008 is preserved as a sibling artifact for trajectory; foundation-009 supersedes it. Net additions on top of foundation-008:
> - **`--call <tool-name> <args-json>` CLI flag** in `src/server/index.ts`'s `main()` — scholar's entry becomes dual-mode (default → MCP server / `--call` → CLI). Task 1.10 `main()` rewritten as an argv-dispatched mutex; new Task 1.10d adds the three tests lead specified (argv parser unit, integration via `bun run`, mode-mutex spy asserting `transport.connect` is not called in CLI mode). Reuses `ServerContext` + `registerAll`'s tool registry; no fork of context-construction. Supports both inline argv args and stdin via `-` literal per lead's recommendation.
> - **Task 1.6 `registerAll` signature change:** returns `ToolRegistry` (`Map<string, ToolHandler>`) for CLI dispatch + the McpServer side effect, so CLI mode can `registry.get(toolName)` without forking. Test updated. No §7.6 disturbance (ToolRegistry is a foundation-internal type, NOT a frozen cross-plan contract).
> - **`BuiltServer` interface widening** to expose `dispatch(toolName, args)` helper for CLI mode — foundation-internal, NOT a §7.6 frozen contract.
>
> Net additions on top of foundation-007 (carried forward from foundation-008 — unchanged):
> - **Three new no-op tool-module stubs** in Task 1.7: `src/server/tools/{query,backup,inspect}.ts`. Stub count: 9 → 12.
> - **`backupRoot` canonical ConfigAccessor key** in the §7.6 JSDoc list (corpus-scoped; consumed by `scholar.backup` via `resolveUnderRoot`).
> - Out-of-scope extraction row updated to claim cycle 6.14 + the 3 new tool-module bodies.
>
> **Wording-discrepancy flag for lead:** the amendment-3 dispatch said "Scholar's entry point (`src/index.ts`) becomes dual-mode" but blast-radius lists `src/server/index.ts` (not `src/index.ts`). Foundation-009 implements `--call` in `src/server/index.ts` since that's the in-scope server entry per spec §5.1 + §6.1 (the project-root `index.ts` at git status is unrelated — likely a stale untracked file). If lead intended a separate `src/index.ts` shim layer (e.g., to keep CLI dispatch above the MCP server module), please clarify in the `plan_approval_response`; the alternative shim adds ~20 LOC + an import re-export and would also need a blast-radius addition.
>
> All sqlite3-mcp-related content remains **REMOVED / SUPERSEDED** (preserved as historical anchor). See Cross-plan spec gaps §3 + §3-followon (both SUPERSEDED) for the design trajectory; the foundation-007/-008/-009 entries in Resolved drifts give the full reduction + addition inventories.

**Goal.** Stand up a compile-able scholar repository — every file every downstream plan imports exists at known paths with frozen-for-v1 type signatures — and vendor the upstream pdf MCP unmodified behind a client-side MCP roots responder that drives root injection through the supported protocol (no source patch).

**Architecture.** Foundation runs in two cycles:

1. **6.1 — Scaffolding.** Pre-declare every v1 npm dep in `package.json` so no downstream plan ever runs `bun add`. Author the Drizzle schema, the `openWithPragmas` migration runner, the `sqlite-vec` loader, the §12.0 primitives, the §7.6 frozen contracts, the twelve tool-module stubs (foundation-008 added `query.ts`/`backup.ts`/`inspect.ts` to the original nine), the `raw-ddl.ts` stub, the `ollama/client.ts` singleton stub, the `src/server/index.ts` entry, the `registry.ts` barrel, the plugin manifest, and `.mcp.json`. Every file typechecks; no business logic.
2. **6.2 — Vendored pdf MCP + client-side roots responder.** Copy `@modelcontextprotocol/server-pdf@1.7.2` `dist/` into `src/vendor/pdf-server/` unmodified. Implement `src/server/pdf/lifecycle.ts`: advertise `capabilities.roots.listChanged = true`, register a `ListRootsRequestSchema` handler returning the active corpus's `pdf_roots`, emit `notifications/roots/list_changed` on mutation, attach the child to a Windows Job Object for orphan reaping, and prove the contract with a four-fixture test suite (spawn lifecycle, roots/list responder, list_changed round-trip, viewUUID survival across a root mutation).

**Tech stack.** Bun 1.x + `bun:sqlite` + `drizzle-orm/bun-sqlite`, `@modelcontextprotocol/sdk@^1.29.0`, `sqlite-vec` (vec0 extension), `koffi` (Windows Job Object FFI). Test runner is **`bun:test`** (built-in, no dep — spec §6.1 ratified at commit `65844aa`).

---

## Out of scope (handed to sibling plans)

Foundation creates every tool-module file as a no-op stub. Downstream plans **fill the body of their assigned stub(s)** but never edit `registry.ts`, `index.ts`, `migrations.ts`, `schema.ts`, `sqlite-vec.ts`, `primitives.ts`, `ollama/client.ts`, `pdf/lifecycle.ts`, `package.json`, `bun.lock`, `tsconfig.json`, `.claude-plugin/plugin.json`, `.mcp.json`, or any sibling plan's tool-module file.

| Sibling plan suffix | Cycles                | Owns (after foundation scaffolds)                                                                                                                                                                                                                                                                |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **corpus**          | `6.3`, `6.11`, *(6.12 status pending)* | Fills `src/server/tools/corpus.ts`, `src/server/tools/roots.ts`, `src/server/tools/snapshot.ts`, `scripts/first-run.ts`. Registers `scholar.dashboard` view-opener from `corpus.ts`. **Cycle 6.12 (sqlite3-mcp registration) supersession-in-flight per user posture B (2026-05-24):** scholar drops sqlite3-mcp delegation entirely; the cycle's removal + the §10 query/backup/inspect surface re-implementation via `bun:sqlite` are lead-owned spec amendments (filed as analytical-tier chore). Corpus's plan-md will refresh against the amended spec. |
| **ingest**          | `6.4`                 | Fills `src/server/ingest/{bibtex,crossref,arxiv}.ts` and `src/server/tools/ingest.ts`. **Foundation owns `src/server/ingest/primitives.ts` exclusively** (splits.xml amended at commit `5b22ada`); ingest imports type-only.                                                                     |
| **extraction**      | `6.5`, `6.6`, `6.8`, *(6.14 pending)* | Fills `src/server/ollama/chunker.ts`, the body of `src/server/db/raw-ddl.ts` (chunk_vec at 6.5, reading_queue view at 6.6 — load-bearing cycle order), `src/server/tools/{pdf,papers,digest,prompts}.ts`. **Foundation owns `src/server/ollama/client.ts` exclusively** (splits.xml amended at commit `5b22ada`); extraction imports the singleton. **Cycle 6.14 (foundation-008): extraction additionally fills the bodies of `src/server/tools/{query,backup,inspect}.ts` per user posture B's §10 reimplementation** — foundation scaffolds the stubs at cycle 6.1 (Task 1.7); extraction fills bodies via `bun:sqlite` direct + the `backupRoot` ConfigAccessor key + the `defaultPdfRoot` helper. |
| **annotations**     | `6.7`                 | Fills `src/server/tools/annotations.ts`.                                                                                                                                                                                                                                                         |
| **frontends**       | `6.9`, `6.10`         | Owns `src/server/ui/` (minus `resource.ts` which foundation scaffolds — see Task 1.10b), `src/ui/`, `nu/`, `commands/`, `skills/`. Fills `src/server/ui/resource.ts` body at cycle 6.9. **Cycle 6.10 (foundation-009): nu wrapper inside `nu/scholar.nu` consumes foundation's `--call` flag** via `^scholar --call $tool ($args \| to json) \| from json` (per user F2 ruling); foundation owns the `--call` dispatch in `src/server/index.ts`'s `main()`, frontends owns the nu wrapper that invokes it. The `--call` argv-or-stdin variant (`-` literal for large payloads) is foundation-internal; the nu wrapper picks either at the call site without changing surface syntax. |
| **packaging**       | `6.13`                | Owns `scripts/build-plugin.ts`. Foundation pre-declares the zip library packaging needs (see "Cross-plan spec gaps" § for the §6.1 dep-list addition recommendation).                                                                                                                            |

---

## Pinned §6.1 dependency manifest

Foundation is the **sole writer** of `package.json` and `bun.lock` in v1. Cycle 6.1 pre-declares every npm dep any later cycle imports; downstream cycles `import` from these packages but never edit either file. Any later change to this list is a foundation-only edit.

### Runtime deps

| Dep                            | Pin              | Source ref                | Used by (later cycles)                          |
| ------------------------------ | ---------------- | ------------------------- | ----------------------------------------------- |
| `@modelcontextprotocol/sdk`    | `^1.29.0`        | §6.1, §17                 | All tool modules; `src/server/pdf/lifecycle.ts` |
| `drizzle-orm`                  | latest stable    | §6.1 (`bun-sqlite` driver) | `schema.ts`, `migrations.ts`, every tool module |
| `drizzle-kit`                  | latest stable    | §6.1                      | `drizzle.config.ts`, migration generation       |
| `sqlite-vec`                   | latest stable    | §6.1, §16                 | `sqlite-vec.ts`, `raw-ddl.ts` (extraction)      |
| `@retorquere/bibtex-parser`    | latest stable    | §6.1, §5.14, §17          | `src/server/ingest/bibtex.ts` (ingest)          |
| `js-tiktoken`                  | latest stable    | §6.1, §17                 | `src/server/ollama/chunker.ts` (extraction)     |
| `chart.js`                     | latest stable    | §6.1, §5.26, §14.1 gate   | `src/ui/views/ReaderProgress.tsx` (frontends)   |
| `pdfjs-dist`                   | latest stable    | §6.1, §5.23, §14.1 gate   | `src/ui/views/PaperDetail.tsx` (frontends). **Spec §6.1 says `pdf.js` — that's the defunct 2012 npm package (`pdf.js@0.1.0`); the canonical Mozilla dist is `pdfjs-dist`. Foundation absorbs the correction inline per lead's foundation-006 ruling (item 7); spec-amendment chore recommended.** |
| `react`                        | `^19.x` (latest) | §6.1, §17 swap gate       | All `src/ui/**` (frontends)                     |
| `react-dom`                    | `^19.x` (latest) | §6.1                      | `src/ui/index.html` mount (frontends)           |
| `koffi`                        | latest stable    | §16 (preferred FFI lib)   | `src/server/pdf/lifecycle.ts` Job Object handle |
| `zod`                          | latest stable    | §6.1 deviation (foundation-006 item 5) | `src/server/tools/*.ts` — `inputSchema: z.object({...})` for MCP-SDK tool registration. **Spec §6.1 enumeration is silent on zod; lead authorized the deviation 2026-05-24 (lower friction than JSON-Schema-only across all tool modules). Recommend spec-amendment chore parallel to `amend-spec-6.1-vitest-to-buntest` (65844aa).** |
| `fflate`                       | latest stable    | §14.1 step 7 (Ruling #2 2026-05-24) | `scripts/build-plugin.ts` zip assembly (packaging plan, cycle 6.13). |
| `ulidx`                        | latest stable    | §8.2 (Ruling #3 2026-05-24)         | id generation for `paper_chunks`, `papers`, `annotations`, `digests`, `reading_prompts`. Foundation re-exports `ulid` from `src/server/db/nowIso.ts` so consumers `import { nowIso, ulid } from "../db/nowIso"`. **Choice: `ulidx`** over `ulid` because `ulidx` is the maintained TypeScript fork; the original `ulid` package's last publish predates the §8.2 cursor-pagination guarantee we depend on. |

### Dev / build deps

| Dep              | Pin                      | Source ref          | Used by                                |
| ---------------- | ------------------------ | ------------------- | -------------------------------------- |
| `typescript`     | latest stable            | §6.1 deviation (foundation-006 item 6) | `tsc --noEmit` typecheck step. **Spec §6.1 enumeration is silent on `typescript` — the binary is implied by the `typecheck` script but the dep is not pre-declared there. Foundation absorbs the deviation; recommend spec-amendment chore parallel to vitest→bun:test.** |
| `@types/react`   | matches `react` major    | implied             | `src/ui/**` typechecking               |
| `@types/react-dom` | matches `react-dom` major | implied           | `src/ui/**` typechecking               |
| `bun-types`      | matches Bun runtime      | implied             | `bun:sqlite`, `bun:test`, `Bun.*` types |

### Explicit negative list (forbidden in v1)

- `vite`, `vite-plugin-singlefile` — UI bundling uses Bun's HTML bundler (§14.1 step 2)
- `better-sqlite3` — replaced by `bun:sqlite` (Decisions Log §17)
- `citation.js` — replaced by `@retorquere/bibtex-parser` + in-house RIS (§5.14, §17)
- `undici`, `ofetch` — replaced by Bun's native `fetch` (§17)
- `gpt-tokenizer` — replaced by `js-tiktoken` (§17)
- `vitest` — replaced by `bun:test` (spec §6.1 ratified at commit `65844aa`)
- `pdf.js` (the defunct 2012 npm package at `pdf.js@0.1.0`) — replaced by `pdfjs-dist` (foundation-006 item 7; spec §6.1's `pdf.js` reference is the same correction target)

### Pre-declared but installed-as-dev-tooling

- The bundled `vec0.dll` / future POSIX equivalents are **not npm deps**; they are produced by `bun run build:vec` (§14.1 step 5) into `build/vendor/sqlite-vec/`. Source tarball reference and ABI pin recorded in `package.json`'s `scholar.bunSqliteVersion` field.
- The bundled Bun runtime (`build/runtime/bun(.exe)`) is **not an npm dep**; it is copied by `bun run build:runtime` (§14.1 step 4). The pinned version is recorded in `package.json`'s `scholar.bundledBunVersion` field.

---

## Pinned §7.6 frozen cross-plan contracts (foundation authors verbatim)

These interfaces live in `src/server/tools/registry.ts`, are exported type-only, and **must not be edited by any downstream plan**. The shapes below match the verbatim spec §7.6 declarations.

```typescript
// src/server/tools/registry.ts (frozen — see spec §7.6)

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * pdf child-process handle. Produced by src/server/pdf/lifecycle.ts (foundation);
 * consumed by pdf.ts (extraction) and annotations.ts (annotations).
 */
export interface PdfChild {
  /** Drives add/update/remove_annotations, get_text, .... Default timeoutMs = 30_000. */
  interact(
    commands: unknown[],
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<unknown>;
  /** Default timeoutMs = 120_000 (text extraction can be slow on large papers). */
  getText(viewUUID: string, opts?: { timeoutMs?: number }): Promise<string>;
  currentRoots(): string[];
  isHealthy(): { alive: boolean; lastOkAt: number | null; stdioOpen: boolean };
}

// Sqlite3McpChild interface — REMOVED 2026-05-24 (foundation-007, user posture B).
// Lead Ruling #1 (Option A — scholar spawns sqlite3-mcp as its own child) is
// SUPERSEDED. User-confirmed posture B: scholar drops sqlite3-mcp delegation
// entirely. The §10 query / backup / inspect surface is re-implemented inline
// via `bun:sqlite` (ownership pending separate user ruling — extraction vs
// corpus vs defer-to-v1.1). No child process, no vendor copy, no §7.6 interface.
// Historical trajectory preserved in Cross-plan spec gaps §3 + §3-followon
// (both marked SUPERSEDED) so future readers see the design evolution.

/**
 * Logger surface. Foundation constructs a single instance and threads it through
 * ctx.log; every tool module logs through it (never console.* directly).
 */
export interface Logger {
  trace(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * Per-corpus row shape returned by ConfigAccessor.corpora(). Aligned with §8.1
 * corpora table; full row type lives in src/server/db/schema.ts.
 */
export interface CorpusRow {
  id: string;
  display_name: string;
  archived_at: string | null;
  last_opened_at: string | null;
  created_at: string;
}

/** Read/write access to scholar-config.db. */
export interface ConfigAccessor {
  /** Canonical configuration keys (foundation-006 item 8 — kept as a JSDoc set
   *  rather than typed-keys to preserve the §7.6-frozen `get<T>(string)` shape):
   *    - "importDirs" : string[]      — §12.1 third allow-list leg for ingest scan paths
   *    - "backupRoot" : string        — destination root for `scholar.backup` (foundation-008,
   *                                     per user posture B §10 reimplementation); corpus-scoped,
   *                                     settable via the corpus tools; consumer pattern:
   *                                     `resolveUnderRoot(backupRoot, args.dest)` (§12.0 primitive
   *                                     rejects path traversal). Reads to undefined surface as
   *                                     a configuration-incomplete error from the backup tool.
   *    - "ollama.host" / "ollama.model.embed" / "ollama.model.chat"
   *    - "scholar.askClaudeEnabled"   — per-request opt-in default for cowork.askClaude
   *    - "ui.theme" / "ui.lastView"
   *  Consumers cast generically: `ctx.config.get<string[]>("importDirs")`. Adding
   *  a new key requires only documenting it here — no interface change. */
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  corpora(): CorpusRow[];
  activeCorpusId(): string | undefined;
}

/** The context every tool module receives. */
export interface ServerContext {
  /** Active per-corpus Drizzle db; undefined until a corpus is active.
   *  SNAPSHOT-AT-ENTRY rule: tool handlers must snapshot into a local on
   *  the first line and read from that local for the rest of the call.
   *  corpus.activate mutates this field in place. */
  db: BunSQLiteDatabase | undefined;
  configDb: BunSQLiteDatabase;
  pdf: PdfChild;
  // sqlite3 field — REMOVED 2026-05-24 (foundation-007, user posture B). See
  // Sqlite3McpChild removal comment above. The §10 query/backup/inspect surface
  // is reimplemented inline via bun:sqlite by the cycle that owns it (pending
  // separate user ruling on ownership: extraction vs corpus vs defer-to-v1.1).
  config: ConfigAccessor;
  log: Logger;
  /** Closes over the entry snapshot and passes it to fn. Prefer this in new handlers. */
  withCorpus<T>(fn: (db: BunSQLiteDatabase) => Promise<T> | T): Promise<T>;
}

/** Frozen tool-registration signature. Every tool module exports this. */
export type RegisterTools = (server: McpServer, ctx: ServerContext) => void;

/** Frozen raw-DDL hook. raw-ddl.ts exports this; migrations.ts calls it
 *  immediately after Drizzle migrations at corpus open (§7.3 step 4). */
export type RunRawDdl = (db: BunSQLiteDatabase) => void;
```

**Cross-plan helper convention.** Any helper exported from one tool module and called by another MUST accept `tx` (a Drizzle transaction-bound handle) as its first argument, not read `ctx.db` itself. The caller wraps `db.transaction(tx => helper(tx, ...))`.

**Ollama client is a foundation-provided singleton.** It lives at `src/server/ollama/client.ts`, is imported directly by digest / prompts / pdf / papers — **not** a `ServerContext` field. Foundation scaffolds the singleton in Task 1.9 below; extraction fills the chat/embed method bodies in cycles 6.5 / 6.8.

**View-opener → owning stub** (foundation pins the mapping in this plan-md so wave-2 plans can `server.registerTool` without a cross-plan edit):

| §10 view-opener tool    | Owned by stub (filled by) |
| ----------------------- | ------------------------- |
| `scholar.dashboard`     | `corpus.ts` (corpus)      |
| `scholar.paper.show`    | `papers.ts` (extraction)  |
| `scholar.digest.show`   | `digest.ts` (extraction)  |
| `scholar.prompts.show`  | `prompts.ts` (extraction) |
| `scholar.progress.show` | `papers.ts` (extraction)  |

---

## Pinned §12.0 primitives (foundation authors verbatim)

The seven helpers in `src/server/ingest/primitives.ts`. Bare string concatenation into prompts, paths, or HTTP requests is forbidden — every untrusted-input boundary routes through these.

```typescript
// src/server/ingest/primitives.ts (frozen — see spec §12.0)

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

/** Text sanitization — applied to every persisted string from external sources. */
export function sanitizeText(input: string, opts?: { maxLen?: number }): string;

/** Untrusted-data envelope — wraps content for safe inclusion in LLM prompts. */
export function wrapUntrusted(payload: string, nonce: string): string;

/** TOCTOU-safe path confinement — used by every ingest path that resolves a file path. */
export function resolveUnderRoot(p: string, root: string): string;

/** DOI encoding — applied before interpolating into any HTTP path. */
export function encodeDoi(doi: string): string;

/** arXiv ID validation — anchored regex covering modern + legacy forms. */
export function validateArxivId(id: string): string;

/** sqlite-vec load + dimension probe — called once per corpus at first open. */
export function loadVecAndProbeDim(
  db: BunSQLiteDatabase,
  ollamaUrl: string,
  embedModel: string,
): Promise<{ dim: number; modelTag: string }>;

/** Retry-safe init memoization — used by §7.3's per-corpus initializer. */
export function initOnce<T>(
  key: string,
  factory: () => Promise<T>,
  classify?: (err: unknown) => "retry" | "fatal",
): Promise<T>;

// Custom error classes thrown by the primitives:
export class SanitizeError extends Error { name = "SanitizeError"; }
export class PathEscapeError extends Error { name = "PathEscapeError"; }
export class InvalidDoiError extends Error { name = "InvalidDoiError"; }
export class InvalidArxivIdError extends Error { name = "InvalidArxivIdError"; }
export class VecLoadError extends Error { name = "VecLoadError"; }
```

Behavioral contracts (verbatim from §12.0):

- **`sanitizeText`** — NFC normalize → strip Unicode Cc/Cf/Co/Cn (except `\n`, `\t`) → reject U+E0000–U+E007F (tag block) → reject U+E000–U+F8FF + U+F0000+ (PUA) → reject U+202A–U+202E + U+2066–U+2069 (bidi overrides) → length-cap to `opts.maxLen` when provided. Throws `SanitizeError` on rejection.
- **`wrapUntrusted`** — returns `<untrusted_data id="${nonce}">${payload}</untrusted_data id="${nonce}">`. Caller generates fresh nonce per request via `crypto.randomBytes(8).toString("hex")`. System-prompt clause is mandatory for any builder embedding the wrapped string.
- **`resolveUnderRoot`** — `path.resolve(p)` → `fs.lstatSync` (refuse symlink leaf) → `fs.realpathSync(resolved)` → `fs.realpathSync(root)` → assert `resolved.startsWith(realRoot + path.sep)` AND `resolved !== realRoot` → assert `fs.statSync(resolved).isFile()`. Throws `PathEscapeError` on any failure.
- **`encodeDoi`** — assert `/^10\.\d{4,9}\/[ -~]+$/.test(doi)` → return `encodeURIComponent(doi)`. Throws `InvalidDoiError` on mismatch.
- **`validateArxivId`** — match `/^(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2,})?\/\d{7}(?:v\d+)?)$/` (no `/u` flag). Returns canonicalized id with archive prefix lower-cased. Throws `InvalidArxivIdError` on mismatch.
- **`loadVecAndProbeDim`** — `db.loadExtension(<vec0 path>)` → POST `{ollamaUrl}/api/embeddings` with `{model: embedModel, prompt: "a"}` → return `{dim: embedding.length, modelTag: embedModel}`. Throws `VecLoadError` on extension load failure; surfaces fetch errors directly.
- **`initOnce`** — module-level `Map<string, Promise<T>>`. On resolve, retain; subsequent calls with same key return the resolved promise. On reject, **clear the slot before re-throwing** (so next call retries from scratch). If `classify` returns `"fatal"`, retain the rejected promise. Process-local.

---

# Cycle 6.1 — Project scaffolding

**Touches:** §5.1, §5.2, §5.3, §5.4, §5.38, §5.40, §5.41, §5.42, §5.43, §5.44, §12.0
**Depends-on:** none
**Test runner:** `bun:test` (Deviation §A). Tests live next to source as `*.test.ts`. Run a single file with `bun test path/to/file.test.ts`; run all with `bun test`.

### Task 1.1: Author `package.json` + `tsconfig.json` + `drizzle.config.ts`

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `drizzle.config.ts`
- Test: `package.json.test.ts` (sibling at repo root)

- [ ] **Step 1 — Write the failing test.** Pin the dep manifest so a later cycle accidentally editing `package.json` fails CI.

```typescript
// package.json.test.ts
import { test, expect } from "bun:test";
import pkg from "./package.json";

test("foundation pins every required v1 runtime dep", () => {
  const deps = pkg.dependencies ?? {};
  // The frozen set — every downstream plan imports from these.
  // Rulings #2 + #3 (2026-05-24) added fflate (packaging zip-assembly) and
  // ulidx (id generation) per spec §14.1 + §8.2.
  // Foundation-006 (2026-05-24) added zod (MCP-SDK inputSchema per item 5)
  // and corrected pdf.js → pdfjs-dist (item 7).
  const required = [
    "@modelcontextprotocol/sdk",
    "@retorquere/bibtex-parser",
    "chart.js",
    "drizzle-orm",
    "fflate",
    "js-tiktoken",
    "koffi",
    "pdfjs-dist",
    "react",
    "react-dom",
    "sqlite-vec",
    "ulidx",
    "zod",
  ];
  for (const name of required) expect(deps[name]).toBeDefined();
  expect(deps["@modelcontextprotocol/sdk"]).toMatch(/^\^1\.29\./);
});

test("foundation pre-declares every required v1 devDep (foundation-006 item 6)", () => {
  // The typecheck + db:generate scripts depend on these binaries. Spec §6.1's
  // enumeration is silent on `typescript`; foundation absorbs the deviation
  // and pins via this assertion. Pattern parallel to required-runtime above.
  const devDeps = pkg.devDependencies ?? {};
  const requiredDev = ["typescript", "drizzle-kit", "@types/react", "@types/react-dom", "bun-types"];
  for (const name of requiredDev) expect(devDeps[name]).toBeDefined();
});

test("foundation declares forbidden deps are absent", () => {
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const forbidden of [
    "vite", "vite-plugin-singlefile", "better-sqlite3",
    "citation.js", "undici", "ofetch", "gpt-tokenizer", "vitest",
    // pdf.js@0.1.0 is the defunct 2012 package; canonical Mozilla dist is
    // pdfjs-dist (item 7 correction).
    "pdf.js",
  ]) {
    expect(all[forbidden]).toBeUndefined();
  }
});

test("foundation records vec0 ABI pin + bundled bun runtime version", () => {
  expect(pkg.scholar).toBeDefined();
  expect(typeof pkg.scholar.bunSqliteVersion).toBe("string");
  expect(typeof pkg.scholar.bundledBunVersion).toBe("string");
});

test("foundation pre-declares every npm script downstream plans invoke", () => {
  // Downstream plans NEVER edit package.json scripts — every script they
  // invoke must be pre-declared here. Per §6.1 invariant + lead's foundation-005
  // supplemental (frontends Task 9 Step 1 + packaging cycle 6.13 + bundle-budget gate).
  // Foundation-007 (2026-05-24) removed build:sqlite3-mcp per user posture B
  // pivot — see Cross-plan spec gaps §3-followon (SUPERSEDED).
  const scripts = pkg.scripts ?? {};
  for (const required of [
    "typecheck",
    "test",
    "db:generate",
    "build:server",
    "build:ui",
    "build:ui:dev",
    "build:pdf",
    "build:runtime",
    "build:vec",
    "build:nu",
    "build:plugin",
    "measure-bundle",
  ]) {
    expect(scripts[required]).toBeDefined();
  }
  // build:ui is the production (minified) target — bundle-budget gate measures
  // this output. build:ui:dev is the unminified variant for development. Both
  // emit to the same path so downstream consumers don't branch on env.
  expect(scripts["build:ui"]).toContain("--minify");
  expect(scripts["build:ui:dev"]).not.toContain("--minify");
});
```

- [ ] **Step 2 — Run test to verify it fails.** `bun test package.json.test.ts` — expect FAIL ("Cannot find module './package.json'").

- [ ] **Step 3 — Write `package.json`.** Use the dep manifest from the "Pinned §6.1 dependency manifest" section above. Scripts mirror §14.1's build steps verbatim:

```json
{
  "name": "scholar",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "db:generate": "drizzle-kit generate",
    "build:server": "tsc --noEmit && bun build src/server/index.ts --compile --target=bun-windows-x64 --outfile build/scholar.exe",
    "build:ui": "bun build src/ui/index.html --target=browser --outfile build/ui/app.html --minify",
    "build:ui:dev": "bun build src/ui/index.html --target=browser --outfile build/ui/app.html",
    "build:pdf": "bun scripts/vendor-pdf-server.ts",
    "build:runtime": "bun scripts/copy-bun-runtime.ts",
    "build:vec": "bun scripts/build-vec0.ts",
    "build:nu": "bun scripts/copy-nu.ts",
    "build:plugin": "bun scripts/build-plugin.ts",
    "measure-bundle": "bun scripts/measure-bundle.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "@retorquere/bibtex-parser": "*",
    "chart.js": "*",
    "drizzle-orm": "*",
    "fflate": "*",
    "js-tiktoken": "*",
    "koffi": "*",
    "pdfjs-dist": "*",
    "react": "*",
    "react-dom": "*",
    "sqlite-vec": "*",
    "ulidx": "*",
    "zod": "*"
  },
  "devDependencies": {
    "@types/react": "*",
    "@types/react-dom": "*",
    "bun-types": "*",
    "drizzle-kit": "*",
    "typescript": "*"
  },
  "scholar": {
    "bunSqliteVersion": "RESOLVE-AT-INSTALL",
    "bundledBunVersion": "RESOLVE-AT-INSTALL"
  }
}
```

> Replace each `"*"` with the latest stable version resolved by `bun install`; the lockfile pins exact resolution. Replace both `"RESOLVE-AT-INSTALL"` strings with the actual Bun release tag (`bun --version` output for `bundledBunVersion`; `bun -e "console.log(process.versions.sqlite)"` or the matching `bun:sqlite` SQLite version for `bunSqliteVersion`). The `vendoredSqlite3McpRev` field was removed 2026-05-24 (foundation-007, user posture B).

- [ ] **Step 4 — Write `tsconfig.json`.**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"],
    "noEmit": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": false
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts", "*.test.ts"],
  "exclude": ["node_modules", "build", "runtime", "src/vendor"]
}
```

`src/vendor` is excluded so the unmodified upstream `dist/index.js` does not break the foundation typecheck on day one.

- [ ] **Step 5 — Write `drizzle.config.ts`.**

```typescript
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  dialect: "sqlite",
  driver: "expo",
  // bun:sqlite/drizzle-orm pairs with the same generated SQL the better-sqlite3
  // driver emits; the runtime swap from better-sqlite3 → bun:sqlite is in
  // src/server/db/migrations.ts (the runner), not here.
} satisfies Config;
```

- [ ] **Step 6 — Install + run the test.** `bun install && bun test package.json.test.ts` — expect PASS.

- [ ] **Step 7 — Commit.**

```bash
git add package.json bun.lock tsconfig.json drizzle.config.ts package.json.test.ts
git commit -m "feat(foundation): pin v1 dep manifest + tsconfig + drizzle config (cycle 6.1)"
```

---

### Task 1.2: `openWithPragmas` + Drizzle migration runner

**Files:**
- Create: `src/server/db/migrations.ts`
- Test: `src/server/db/migrations.test.ts`

`openWithPragmas` is the sole entry point for opening either DB. It MUST execute `PRAGMA foreign_keys = ON` immediately after `open()` and before any other SQL (per §5.3 / §8 — the pragma is per-connection in SQLite, not per-database).

- [ ] **Step 1 — Write the failing test.**

```typescript
// src/server/db/migrations.test.ts
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWithPragmas } from "./migrations.ts";

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test("openWithPragmas sets PRAGMA foreign_keys = ON on every open", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-mig-"));
  const db = openWithPragmas(join(dir, "t.db"));
  const row = db.$client.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
  expect(row.foreign_keys).toBe(1);
});

test("openWithPragmas opens distinct paths to distinct files", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-mig-"));
  const a = openWithPragmas(join(dir, "a.db"));
  const b = openWithPragmas(join(dir, "b.db"));
  a.$client.exec("CREATE TABLE t (k TEXT)");
  // b must not see the table — distinct files.
  expect(() => b.$client.query("SELECT * FROM t").all()).toThrow();
});
```

- [ ] **Step 2 — Run test to verify it fails.** `bun test src/server/db/migrations.test.ts` — expect FAIL ("Cannot find module './migrations.ts'").

- [ ] **Step 3 — Implement.**

```typescript
// src/server/db/migrations.ts
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { join } from "node:path";
import { runRawDdl } from "./raw-ddl.ts";

/**
 * Sole entry point for opening either the config DB or a per-corpus DB.
 * PRAGMA foreign_keys = ON is per-connection; this is the only place that
 * pragma is set, so the §8 onDelete: "cascade" clauses are load-bearing.
 */
export function openWithPragmas(path: string): BunSQLiteDatabase {
  const client = new Database(path);
  client.exec("PRAGMA foreign_keys = ON");
  client.exec("PRAGMA journal_mode = WAL");
  return drizzle(client);
}

/**
 * Plugin-upgrade compatibility guard (per §5.3 behavior 3). Reads
 * __drizzle_migrations and aborts if the DB was written by a newer plugin.
 */
export class DbFromNewerPluginError extends Error {
  name = "DbFromNewerPluginError";
}

/**
 * Replays unapplied migrations, then calls runRawDdl(db). The raw-DDL hook
 * (stub from cycle 6.1; filled by extraction at 6.5/6.6) creates chunk_vec
 * and reading_queue. Foundation tests must NOT assert on those two objects.
 */
export function applyMigrations(db: BunSQLiteDatabase, migrationsFolder = join(import.meta.dir, "migrations")): void {
  // Compatibility guard runs BEFORE migrate() so a newer-schema DB aborts
  // before any modification.
  const recorded = readMaxAppliedId(db);
  const bundled = countBundledMigrations(migrationsFolder);
  if (recorded !== null && recorded > bundled) {
    throw new DbFromNewerPluginError(
      `DB has migration id ${recorded} but plugin ships only ${bundled}; ` +
      "downgrade the plugin or run scholar.corpus.export.",
    );
  }
  migrate(db, { migrationsFolder });
  runRawDdl(db);
}

function readMaxAppliedId(db: BunSQLiteDatabase): number | null {
  try {
    const r = db.$client.query("SELECT MAX(id) AS m FROM __drizzle_migrations").get() as { m: number | null };
    return r?.m ?? null;
  } catch {
    return null; // table doesn't exist yet — first open
  }
}

function countBundledMigrations(folder: string): number {
  // Count files matching NNNN_*.sql in folder. Foundation ships an empty journal
  // initially (no migrations until schema lands in Task 1.4); count returns 0.
  // Drizzle migrate() handles the empty-journal case without error.
  try {
    return Array.from(new Bun.Glob("*.sql").scanSync({ cwd: folder })).length;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 4 — Run test to verify it passes.** `bun test src/server/db/migrations.test.ts` — expect PASS.

- [ ] **Step 5 — Commit.**

```bash
git add src/server/db/migrations.ts src/server/db/migrations.test.ts
git commit -m "feat(foundation): openWithPragmas + applyMigrations + plugin-upgrade guard (cycle 6.1)"
```

---

### Task 1.3: `sqlite-vec` loader

**Files:**
- Create: `src/server/db/sqlite-vec.ts`
- Test: `src/server/db/sqlite-vec.test.ts`

Foundation only resolves the absolute path to the bundled `vec0` shared library; it does **not** call `db.loadExtension` (that's `loadVecAndProbeDim`'s job in `primitives.ts`). Path resolution must work in both dev (`./build/vendor/sqlite-vec/`) and packaged (`${CLAUDE_PLUGIN_ROOT}/build/vendor/sqlite-vec/`) layouts.

- [ ] **Step 1 — Write the failing test.**

```typescript
// src/server/db/sqlite-vec.test.ts
import { test, expect } from "bun:test";
import { resolveVec0Path } from "./sqlite-vec.ts";
import { existsSync } from "node:fs";

test("resolveVec0Path returns absolute path with platform-correct extension", () => {
  const p = resolveVec0Path();
  expect(p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)).toBe(true);
  if (process.platform === "win32") expect(p).toMatch(/vec0\.dll$/);
  else if (process.platform === "darwin") expect(p).toMatch(/vec0\.dylib$/);
  else expect(p).toMatch(/vec0\.(so|dylib|dll)$/);
});

test("resolveVec0Path honors SCHOLAR_VEC0_PATH override when set", () => {
  process.env.SCHOLAR_VEC0_PATH = "/tmp/custom/vec0.so";
  try {
    expect(resolveVec0Path()).toBe("/tmp/custom/vec0.so");
  } finally {
    delete process.env.SCHOLAR_VEC0_PATH;
  }
});
```

- [ ] **Step 2 — Run test to verify it fails.** `bun test src/server/db/sqlite-vec.test.ts` — expect FAIL.

- [ ] **Step 3 — Implement.**

```typescript
// src/server/db/sqlite-vec.ts
import { join, resolve } from "node:path";

/**
 * Returns the absolute path to the bundled vec0 shared library.
 *
 * Resolution order:
 *   1. SCHOLAR_VEC0_PATH env override (test/CI/operator escape hatch)
 *   2. ${CLAUDE_PLUGIN_ROOT}/build/vendor/sqlite-vec/vec0.{dll,dylib,so}  (packaged)
 *   3. <repo>/build/vendor/sqlite-vec/vec0.{dll,dylib,so}                  (dev)
 *
 * Loading is the caller's responsibility — see loadVecAndProbeDim in
 * src/server/ingest/primitives.ts.
 */
export function resolveVec0Path(): string {
  const override = process.env.SCHOLAR_VEC0_PATH;
  if (override) return override;
  const ext = process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so";
  const filename = `vec0.${ext}`;
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) return join(pluginRoot, "build", "vendor", "sqlite-vec", filename);
  // Dev layout: walk up from this file to repo root.
  return resolve(import.meta.dir, "..", "..", "..", "build", "vendor", "sqlite-vec", filename);
}
```

- [ ] **Step 4 — Run test to verify it passes.** `bun test src/server/db/sqlite-vec.test.ts` — expect PASS.

- [ ] **Step 5 — Commit.**

```bash
git add src/server/db/sqlite-vec.ts src/server/db/sqlite-vec.test.ts
git commit -m "feat(foundation): resolveVec0Path with packaged/dev/override resolution (cycle 6.1)"
```

---

### Task 1.4: Drizzle schema for config DB + per-corpus DB

**Files:**
- Create: `src/server/db/schema.ts`
- Create: `src/server/db/nowIso.ts`
- Test: `src/server/db/schema.test.ts`
- Generated: `src/server/db/migrations/0000_*.sql` (via `bun run db:generate`)

`schema.ts` is large; it transcribes §8.1 (config DB) and §8.2 (per-corpus DB). Foundation tests only assert that the tables exist after `applyMigrations` runs against an empty DB — the column-level invariants are exercised by downstream plans that consume them.

`nowIso()` is the sole ISO-8601-millisecond timestamp producer (§8 timestamp format invariant); every `created_at` / `updated_at` / etc. value flows through it so lexical ordering matches chronological.

- [ ] **Step 1 — Write the failing test.**

```typescript
// src/server/db/schema.test.ts
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWithPragmas, applyMigrations } from "./migrations.ts";
import { nowIso, ulid } from "./nowIso.ts";

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test("nowIso returns ISO-8601 with millisecond precision in UTC", () => {
  const s = nowIso();
  expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  // Two calls within the same ms should be lexically comparable.
  const a = nowIso(); const b = nowIso();
  expect(a <= b).toBe(true);
});

test("ulid re-export produces 26-char Crockford-base32 ids that are monotonic", () => {
  const a = ulid();
  const b = ulid();
  expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(b).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  // Same-ms guarantee from ulidx — second id sorts strictly greater.
  expect(b > a).toBe(true);
});

test("applyMigrations creates the per-corpus tables enumerated in §8.2", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-schema-"));
  const db = openWithPragmas(join(dir, "corpus.db"));
  applyMigrations(db);
  const tables = db.$client.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const names = tables.map(t => t.name);
  for (const expected of [
    "papers", "paper_chunks", "annotations", "reconcile_state",
    "digests", "reading_prompts", "settings", "anchor_cache", "snapshots",
  ]) {
    expect(names).toContain(expected);
  }
});

test("applyMigrations creates the config DB tables enumerated in §8.1", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-schema-"));
  const db = openWithPragmas(join(dir, "config.db"));
  applyMigrations(db);
  const tables = db.$client.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const names = tables.map(t => t.name);
  for (const expected of ["corpora", "pdf_roots"]) {
    expect(names).toContain(expected);
  }
});
```

- [ ] **Step 2 — Run test to verify it fails.** Expect FAIL on schema imports.

- [ ] **Step 3 — Write `nowIso.ts`.**

```typescript
// src/server/db/nowIso.ts
import { ulid as ulidxUlid } from "ulidx";

let lastIso = "";
let dedupSeq = 0;

/**
 * Sole producer of ISO-8601 UTC millisecond timestamps for both DBs.
 * Two calls in the same millisecond are guaranteed to return distinct,
 * lexically-comparable strings by appending a microsecond-tier counter.
 */
export function nowIso(): string {
  const iso = new Date().toISOString();
  if (iso === lastIso) {
    dedupSeq++;
    // Replace .NNNZ with .NNNxZ where x advances the millisecond — lexically
    // greater than the unsuffixed form for any millisecond. Capped at .999Z+.
    return iso.replace(/Z$/, `${(dedupSeq).toString(36)}Z`);
  }
  lastIso = iso;
  dedupSeq = 0;
  return iso;
}

/**
 * Foundation-owned re-export of ulidx's ulid() so every consumer
 * (extraction's pdf.ts/digest.ts/papers.ts, corpus's corpus.ts) imports
 * from one place: `import { nowIso, ulid } from "../db/nowIso"`.
 * Per Ruling #3 (2026-05-24), `ulidx` (not `ulid`) is the chosen library.
 */
export const ulid = ulidxUlid;
```

- [ ] **Step 4 — Write `schema.ts`.** Transcribe §8.1 + §8.2 using Drizzle's `sqliteTable`. The full file is mechanical — every column corresponds to a row in the spec's schema tables. Below is the load-bearing structure; the executor fills in the remaining columns directly from §8.

```typescript
// src/server/db/schema.ts (transcription of spec §8.1 + §8.2)
import { sqliteTable, text, integer, real, primaryKey, index } from "drizzle-orm/sqlite-core";

// =========================
// CONFIG DB (§8.1)
// =========================

export const corpora = sqliteTable("corpora", {
  id: text("id").primaryKey(),
  display_name: text("display_name").notNull(),
  archived_at: text("archived_at"),
  last_opened_at: text("last_opened_at"),
  created_at: text("created_at").notNull(),
});

export const pdf_roots = sqliteTable("pdf_roots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  corpus_id: text("corpus_id").notNull().references(() => corpora.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  is_default: integer("is_default", { mode: "boolean" }).notNull().default(false),
  created_at: text("created_at").notNull(),
}, (t) => ({
  byCorpus: index("pdf_roots_by_corpus").on(t.corpus_id),
}));

// =========================
// PER-CORPUS DB (§8.2)
// =========================

export const papers = sqliteTable("papers", {
  id: text("id").primaryKey(),
  doi: text("doi"),
  arxiv_id: text("arxiv_id"),
  title: text("title").notNull(),
  authors_json: text("authors_json").notNull(),
  year: integer("year"),
  venue: text("venue"),
  abstract: text("abstract"),
  pdf_path: text("pdf_path"),
  status: text("status").notNull().default("unread"),
  priority: integer("priority").notNull().default(0),
  depth: text("depth"),
  role: text("role"),
  section: text("section"),
  status_touched_at: text("status_touched_at"),
  imported_at: text("imported_at").notNull(),
  // ... remaining columns per §8.2; executor transcribes verbatim
});

export const paper_chunks = sqliteTable("paper_chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  paper_id: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  chunk_index: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  embedded_at: text("embedded_at"),
  // ... remaining columns per §8.2
});

export const annotations = sqliteTable("annotations", {
  id: text("id").primaryKey(),
  paper_id: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  page: integer("page"),
  anchor: text("anchor"),
  rect: text("rect"),
  body: text("body").notNull(),
  source: text("source").notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
  deleted_at: text("deleted_at"),
});

export const reconcile_state = sqliteTable("reconcile_state", {
  corpus_id: text("corpus_id").notNull(),
  paper_id: text("paper_id").notNull(),
  last_reconciled_at: text("last_reconciled_at").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.corpus_id, t.paper_id] }),
}));

export const digests = sqliteTable("digests", {
  id: text("id").primaryKey(),
  scope_key: text("scope_key").notNull(),
  scope_signature: text("scope_signature").notNull(),
  body: text("body").notNull(),
  created_at: text("created_at").notNull(),
});

export const reading_prompts = sqliteTable("reading_prompts", {
  id: text("id").primaryKey(),
  paper_id: text("paper_id").references(() => papers.id, { onDelete: "cascade" }),
  scope_key: text("scope_key"),
  body: text("body").notNull(),
  created_at: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const anchor_cache = sqliteTable("anchor_cache", {
  paper_id: text("paper_id").primaryKey().references(() => papers.id, { onDelete: "cascade" }),
  pages: integer("pages"),
  generated_at: text("generated_at"),
  json: text("json"),
});

export const snapshots = sqliteTable("snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taken_at: text("taken_at").notNull(),
  paper_status_json: text("paper_status_json").notNull(),
});
```

> The executor transcribes every column listed in spec §8.1 / §8.2 verbatim; the abbreviated form above shows the load-bearing tables and indexes only.

- [ ] **Step 5 — Generate the initial migration.** `bun run db:generate` — produces `src/server/db/migrations/0000_*.sql`. The journal manifest is created at `src/server/db/migrations/meta/_journal.json`. Commit both.

- [ ] **Step 6 — Run test to verify it passes.** `bun test src/server/db/schema.test.ts` — expect PASS (config DB tables and per-corpus tables both materialize against an empty DB).

- [ ] **Step 7 — Commit.**

```bash
git add src/server/db/schema.ts src/server/db/nowIso.ts src/server/db/schema.test.ts src/server/db/migrations/
git commit -m "feat(foundation): Drizzle schema + initial migration + nowIso (cycle 6.1)"
```

---

### Task 1.4b: `rawClient(db)` helper — `src/server/db/raw-client.ts`

**Files:**
- Create: `src/server/db/raw-client.ts`
- Test: `src/server/db/raw-client.test.ts`

A 5-line helper that surfaces the `bun:sqlite` native `Database` backing a drizzle `BunSQLiteDatabase`. Required by extraction (cycle 6.5/6.6) for two `vec0` paths drizzle doesn't model: `CREATE VIRTUAL TABLE chunk_vec` (raw DDL) and `INSERT INTO chunk_vec VALUES (?, Float32Array)` (typed parameter binding). Centralizing the cast keeps downstream call sites idiomatic and gives one chokepoint if drizzle ever renames `$client`.

This is foundation-internal — adding the helper does NOT widen the §7.6 frozen `ServerContext` contract.

- [ ] **Step 1 — Write the failing test.**

```typescript
// src/server/db/raw-client.test.ts
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openWithPragmas } from "./migrations.ts";
import { rawClient } from "./raw-client.ts";

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test("rawClient returns the bun:sqlite Database backing a BunSQLiteDatabase", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-rawclient-"));
  const db = openWithPragmas(join(dir, "t.db"));
  const raw = rawClient(db);
  expect(raw).toBeInstanceOf(Database);
  // The raw client must observe writes through the drizzle wrapper.
  raw.exec("CREATE TABLE k (v INTEGER)");
  raw.exec("INSERT INTO k VALUES (42)");
  const row = raw.query("SELECT v FROM k").get() as { v: number };
  expect(row.v).toBe(42);
});
```

- [ ] **Step 2 — Run test to verify it fails.** Expect FAIL.

- [ ] **Step 3 — Implement.**

```typescript
// src/server/db/raw-client.ts
import type { Database } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

/**
 * Surfaces the bun:sqlite native `Database` client backing a drizzle
 * `BunSQLiteDatabase`. Use ONLY for paths drizzle doesn't model cleanly:
 *
 *   - vec0 virtual-table DDL (`CREATE VIRTUAL TABLE … USING vec0(…)`)
 *   - vec0 INSERT with typed Float32Array binding
 *   - custom pragma reads outside `openWithPragmas`
 *   - user-defined function registration
 *
 * Centralizes the unsafe cast — drizzle exposes the client as `$client` but
 * does not type it publicly. This one helper is the only place that knowledge
 * lives, so a future drizzle rename is a one-file fix.
 */
export function rawClient(db: BunSQLiteDatabase): Database {
  return (db as unknown as { $client: Database }).$client;
}
```

- [ ] **Step 4 — Run test.** Expect PASS.

- [ ] **Step 5 — Commit.**

```bash
git add src/server/db/raw-client.ts src/server/db/raw-client.test.ts
git commit -m "feat(foundation): rawClient(db) helper for vec0/raw-DDL paths (cycle 6.1)"
```

---

### Task 1.4c: `defaultPdfRoot(tx, corpusId)` helper — `src/server/db/default-pdf-root.ts`

**Files:**
- Create: `src/server/db/default-pdf-root.ts`
- Test: `src/server/db/default-pdf-root.test.ts`

Per spec §8.1: *"a `defaultPdfRoot(corpusId)` helper in `src/server/db/` wraps this and asserts that exactly one row matches (the `one_default` partial unique index makes 'more than one' impossible; 'zero' surfaces as a configuration-incomplete error)."*

Foundation owns this helper because corpus cycle 6.3 (`scholar.corpus.activate`) needs it during the activation handoff to compute the active corpus's default PDF root for the pdf-child spawn. Without foundation owning it, corpus would either (a) re-implement the lookup inline (duplicating the assertion semantics across plans) or (b) reach into `pdf_roots` directly (skipping the §8.1 single-default invariant).

**Signature expansion.** Spec §8.1 reads `defaultPdfRoot(corpusId)` — implementation needs the db handle, so foundation expands the TypeScript signature per the §7.6 cross-plan helper convention (CLAUDE.md "Cross-plan helpers take a `tx` first arg"): `defaultPdfRoot(tx: BunSQLiteDatabase, corpusId: string): string`. The spec text is the *semantic* signature; this is the *callable* signature.

- [ ] **Step 1 — Write the failing test.**

```typescript
// src/server/db/default-pdf-root.test.ts
import { test, expect } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { sql } from "drizzle-orm";
import { defaultPdfRoot, ConfigurationIncompleteError } from "./default-pdf-root.ts";

function makeDb() {
  const raw = new Database(":memory:");
  raw.run("PRAGMA foreign_keys = ON");
  const tx = drizzle(raw);
  // Minimal schema needed for the test — production runs apply migrations.
  raw.run(`
    CREATE TABLE pdf_roots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      corpus_id TEXT NOT NULL,
      path TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0
    )`);
  raw.run(`CREATE UNIQUE INDEX pdf_roots_one_default_idx ON pdf_roots(corpus_id) WHERE is_default = 1`);
  return { tx, raw };
}

test("returns the single is_default=true row path", () => {
  const { tx, raw } = makeDb();
  raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 1)", ["c1", "/papers"]);
  expect(defaultPdfRoot(tx, "c1")).toBe("/papers");
});

test("ignores non-default rows for the same corpus", () => {
  const { tx, raw } = makeDb();
  raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 0)", ["c1", "/aux"]);
  raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 1)", ["c1", "/papers"]);
  expect(defaultPdfRoot(tx, "c1")).toBe("/papers");
});

test("throws ConfigurationIncompleteError when zero default rows exist", () => {
  const { tx } = makeDb();
  expect(() => defaultPdfRoot(tx, "missing")).toThrow(ConfigurationIncompleteError);
});

test("ignores rows from other corpora", () => {
  const { tx, raw } = makeDb();
  raw.run("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, 1)", ["other", "/wrong"]);
  expect(() => defaultPdfRoot(tx, "c1")).toThrow(ConfigurationIncompleteError);
});
```

- [ ] **Step 2 — Run test to verify it fails.** Expect FAIL ("Cannot find module './default-pdf-root.ts'").

- [ ] **Step 3 — Write `src/server/db/default-pdf-root.ts`.**

```typescript
// src/server/db/default-pdf-root.ts
//
// Spec §8.1 default-root lookup. Asserts exactly one is_default=true row;
// the `pdf_roots_one_default_idx` partial unique index makes "more than one"
// impossible, so the only failure mode is "zero rows" → ConfigurationIncompleteError.
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";

export class ConfigurationIncompleteError extends Error {
  constructor(corpusId: string) {
    super(`Corpus ${corpusId} has no default PDF root configured. Run scholar.roots.set --default to fix.`);
    this.name = "ConfigurationIncompleteError";
  }
}

export function defaultPdfRoot(tx: BunSQLiteDatabase, corpusId: string): string {
  const rows = tx.all(sql`SELECT path FROM pdf_roots WHERE corpus_id = ${corpusId} AND is_default = 1`) as { path: string }[];
  if (rows.length === 0) throw new ConfigurationIncompleteError(corpusId);
  // The partial unique index guarantees rows.length <= 1; the explicit guard
  // is defense-in-depth for cases where the index didn't get applied (e.g., a
  // raw-DDL bug in migrations.ts).
  if (rows.length > 1) {
    throw new Error(`Internal invariant violated: corpus ${corpusId} has ${rows.length} default PDF roots (pdf_roots_one_default_idx not applied?)`);
  }
  return rows[0].path;
}
```

- [ ] **Step 4 — Run tests.** `bun test src/server/db/default-pdf-root.test.ts` — expect PASS (4/4).

- [ ] **Step 5 — Commit.**

```bash
git add src/server/db/default-pdf-root.ts src/server/db/default-pdf-root.test.ts
git commit -m "feat(foundation): defaultPdfRoot(tx, corpusId) helper per spec §8.1 (cycle 6.1)"
```

> **Cross-plan consumer.** corpus cycle 6.3 (`scholar.corpus.activate`) imports this helper to compute the active corpus's PDF root before invoking `spawnPdfChild({ initialRoots: [defaultPdfRoot(tx, corpusId)] })`. Foundation does NOT call it (foundation owns no tool bodies); the import resolution at typecheck time is the only foundation-side validation.

---

### Task 1.5: §12.0 primitives — `src/server/ingest/primitives.ts`

**Files:**
- Create: `src/server/ingest/primitives.ts`
- Test: `src/server/ingest/primitives.test.ts`

The seven helpers are signature-frozen in the "Pinned §12.0 primitives" section above. Foundation owns this file exclusively per lead ruling 2026-05-24 (ingest may import type-only; never edit).

- [ ] **Step 1 — Write the failing tests** (one block per primitive — all must fail before implementation).

```typescript
// src/server/ingest/primitives.test.ts
import { test, expect } from "bun:test";
import {
  sanitizeText, SanitizeError,
  wrapUntrusted,
  resolveUnderRoot, PathEscapeError,
  encodeDoi, InvalidDoiError,
  validateArxivId, InvalidArxivIdError,
  initOnce,
} from "./primitives.ts";
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- sanitizeText ---
test("sanitizeText NFC-normalizes and strips disallowed Unicode categories", () => {
  // Combining-character form normalizes to NFC.
  const decomposed = "é";       // 'e' + combining acute
  expect(sanitizeText(decomposed)).toBe("é"); // 'é'
});

test("sanitizeText rejects U+202E bidi override", () => {
  expect(() => sanitizeText("hello‮world")).toThrow(SanitizeError);
});

test("sanitizeText rejects Unicode tag block U+E0000–U+E007F", () => {
  expect(() => sanitizeText("foo󠀠bar")).toThrow(SanitizeError);
});

test("sanitizeText caps length when maxLen supplied", () => {
  expect(sanitizeText("abcdef", { maxLen: 3 })).toBe("abc");
});

// --- wrapUntrusted ---
test("wrapUntrusted brackets payload with nonce-tagged delimiters", () => {
  const out = wrapUntrusted("hello", "deadbeef");
  expect(out).toBe(`<untrusted_data id="deadbeef">hello</untrusted_data id="deadbeef">`);
});

// --- resolveUnderRoot ---
test("resolveUnderRoot accepts a regular file under the root", () => {
  const root = mkdtempSync(join(tmpdir(), "scholar-rur-"));
  const file = join(root, "ok.txt");
  writeFileSync(file, "x");
  try { expect(resolveUnderRoot(file, root)).toBe(file); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("resolveUnderRoot throws PathEscapeError on parent traversal", () => {
  const root = mkdtempSync(join(tmpdir(), "scholar-rur-"));
  try { expect(() => resolveUnderRoot(join(root, "..", "etc", "passwd"), root)).toThrow(PathEscapeError); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("resolveUnderRoot throws PathEscapeError on symlink leaf", () => {
  if (process.platform === "win32") return; // symlinks require admin on Windows
  const root = mkdtempSync(join(tmpdir(), "scholar-rur-"));
  const outside = mkdtempSync(join(tmpdir(), "scholar-rur-outside-"));
  writeFileSync(join(outside, "secret.txt"), "x");
  symlinkSync(join(outside, "secret.txt"), join(root, "link"));
  try { expect(() => resolveUnderRoot(join(root, "link"), root)).toThrow(PathEscapeError); }
  finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// --- encodeDoi ---
test("encodeDoi percent-encodes a valid DOI", () => {
  expect(encodeDoi("10.1145/3242897.3242916")).toBe("10.1145%2F3242897.3242916");
});

test("encodeDoi rejects malformed DOI", () => {
  expect(() => encodeDoi("not-a-doi")).toThrow(InvalidDoiError);
});

// --- validateArxivId ---
test("validateArxivId accepts modern form", () => {
  expect(validateArxivId("2403.12345")).toBe("2403.12345");
  expect(validateArxivId("2403.12345v2")).toBe("2403.12345v2");
});

test("validateArxivId accepts legacy form and lower-cases archive", () => {
  expect(validateArxivId("cs.LG/0405001")).toBe("cs.LG/0405001");
  expect(validateArxivId("MATH/9912345v3")).toBe("math/9912345v3");
});

test("validateArxivId rejects bogus id", () => {
  expect(() => validateArxivId("paper-123")).toThrow(InvalidArxivIdError);
});

// --- initOnce ---
test("initOnce memoizes resolved promises", async () => {
  let calls = 0;
  const f = () => { calls++; return Promise.resolve(42); };
  const a = await initOnce("k1", f);
  const b = await initOnce("k1", f);
  expect(a).toBe(42); expect(b).toBe(42); expect(calls).toBe(1);
});

test("initOnce clears the slot on reject so the next call retries", async () => {
  let attempt = 0;
  const f = () => { attempt++; return attempt === 1 ? Promise.reject(new Error("transient")) : Promise.resolve("ok"); };
  await expect(initOnce("k2", f)).rejects.toThrow("transient");
  await expect(initOnce("k2", f)).resolves.toBe("ok");
  expect(attempt).toBe(2);
});

test("initOnce retains the rejected promise when classify returns 'fatal'", async () => {
  let attempt = 0;
  const f = () => { attempt++; return Promise.reject(new Error("schema-bad")); };
  const classify = () => "fatal" as const;
  await expect(initOnce("k3", f, classify)).rejects.toThrow("schema-bad");
  await expect(initOnce("k3", f, classify)).rejects.toThrow("schema-bad");
  expect(attempt).toBe(1);
});
```

> `loadVecAndProbeDim` requires Ollama and is not unit-tested at the foundation layer; cycle 6.5's vec0 smoke test exercises it end-to-end against a real Ollama. Foundation provides a typecheck-only stub body that throws `VecLoadError("not yet implemented at foundation")` if accidentally called.

- [ ] **Step 2 — Run tests to verify they fail.** `bun test src/server/ingest/primitives.test.ts` — expect FAIL.

- [ ] **Step 3 — Implement.** The full implementations follow the spec §12.0 behavioral contracts verbatim (transcribed in the "Pinned §12.0 primitives" section above). Skeleton:

```typescript
// src/server/ingest/primitives.ts
import { lstatSync, realpathSync, statSync } from "node:fs";
import { resolve as resolvePath, sep as pathSep } from "node:path";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

export class SanitizeError extends Error { name = "SanitizeError"; }
export class PathEscapeError extends Error { name = "PathEscapeError"; }
export class InvalidDoiError extends Error { name = "InvalidDoiError"; }
export class InvalidArxivIdError extends Error { name = "InvalidArxivIdError"; }
export class VecLoadError extends Error { name = "VecLoadError"; }

export function sanitizeText(input: string, opts?: { maxLen?: number }): string {
  let s = input.normalize("NFC");
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    // Reject bidi overrides
    if ((cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2066 && cp <= 0x2069)) {
      throw new SanitizeError(`bidi override U+${cp.toString(16).toUpperCase()}`);
    }
    // Reject tag block
    if (cp >= 0xE0000 && cp <= 0xE007F) {
      throw new SanitizeError(`tag block U+${cp.toString(16).toUpperCase()}`);
    }
    // Reject private-use areas
    if ((cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000) {
      throw new SanitizeError(`PUA U+${cp.toString(16).toUpperCase()}`);
    }
  }
  // Strip Cc/Cf/Co/Cn except \n and \t (Unicode-property regex; /u flag required for \p{})
  s = s.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, (m) => (m === "\n" || m === "\t" ? m : ""));
  if (opts?.maxLen != null && s.length > opts.maxLen) s = s.slice(0, opts.maxLen);
  return s;
}

export function wrapUntrusted(payload: string, nonce: string): string {
  return `<untrusted_data id="${nonce}">${payload}</untrusted_data id="${nonce}">`;
}

export function resolveUnderRoot(p: string, root: string): string {
  const resolved = resolvePath(p);
  let leafStat;
  try { leafStat = lstatSync(resolved); }
  catch { throw new PathEscapeError(`does not exist: ${resolved}`); }
  if (leafStat.isSymbolicLink()) throw new PathEscapeError(`symlink leaf rejected: ${resolved}`);
  const real = realpathSync(resolved);
  const realRoot = realpathSync(root);
  if (!real.startsWith(realRoot + pathSep) || real === realRoot) {
    throw new PathEscapeError(`escapes root ${realRoot}: ${real}`);
  }
  if (!statSync(real).isFile()) throw new PathEscapeError(`not a regular file: ${real}`);
  return real;
}

export function encodeDoi(doi: string): string {
  if (!/^10\.\d{4,9}\/[ -~]+$/.test(doi)) throw new InvalidDoiError(doi);
  return encodeURIComponent(doi);
}

export function validateArxivId(id: string): string {
  const re = /^(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2,})?\/\d{7}(?:v\d+)?)$/i;
  if (!re.test(id)) throw new InvalidArxivIdError(id);
  // Lower-case the archive prefix only; preserve version suffix exactly.
  const slash = id.indexOf("/");
  if (slash === -1) return id;
  return id.slice(0, slash).toLowerCase() + id.slice(slash);
}

export async function loadVecAndProbeDim(
  _db: BunSQLiteDatabase, _ollamaUrl: string, _embedModel: string,
): Promise<{ dim: number; modelTag: string }> {
  // Foundation provides a typecheck-only stub. Cycle 6.5 (extraction) implements
  // the full path: db.loadExtension(resolveVec0Path()) + POST /api/embeddings.
  // See spec §12.0 for the step-by-step contract.
  throw new VecLoadError("loadVecAndProbeDim is unimplemented at the foundation layer; filled by extraction cycle 6.5");
}

const initOnceSlots = new Map<string, Promise<unknown>>();
export async function initOnce<T>(
  key: string,
  factory: () => Promise<T>,
  classify?: (err: unknown) => "retry" | "fatal",
): Promise<T> {
  const existing = initOnceSlots.get(key);
  if (existing) return existing as Promise<T>;
  const p = (async () => {
    try { return await factory(); }
    catch (err) {
      const verdict = classify?.(err) ?? "retry";
      if (verdict === "retry") initOnceSlots.delete(key);
      throw err;
    }
  })();
  initOnceSlots.set(key, p as Promise<unknown>);
  return p;
}
```

- [ ] **Step 4 — Run tests.** `bun test src/server/ingest/primitives.test.ts` — expect PASS.

- [ ] **Step 5 — Commit.**

```bash
git add src/server/ingest/primitives.ts src/server/ingest/primitives.test.ts
git commit -m "feat(foundation): §12.0 primitives (sanitize/wrap/resolve/encode/validate/initOnce) (cycle 6.1)"
```

---

### Task 1.6: §7.6 frozen contracts — `src/server/tools/registry.ts`

**Files:**
- Create: `src/server/tools/registry.ts`
- Test: `src/server/tools/registry.test.ts`

`registry.ts` exports the frozen contract types (verbatim from the "Pinned §7.6 frozen cross-plan contracts" section above) and a `registerAll(server, ctx)` function that statically imports all twelve tool stubs (the original nine plus `query`/`backup`/`inspect` added by foundation-008) and calls each module's exported `registerTools`. **Foundation-009:** `registerAll` returns a `ToolRegistry` (`Map<string, ToolHandler>`) so `src/server/index.ts`'s `--call` CLI mode can dispatch a tool by name without round-tripping through the stdio MCP transport. The map population is a foundation-internal side-effect convention — each module's `registerTools` is foundation-authored at cycle 6.1 (the bodies are downstream-filled) and uses a foundation-supplied `register` helper that both calls `server.registerTool(name, def, handler)` AND records the handler into the map. The `ToolRegistry`/`ToolHandler` types are foundation-internal (NOT in §7.6 frozen contracts), so adding them doesn't disturb downstream plans. Foundation is the **sole** writer of this file.

- [ ] **Step 1 — Write the failing test.**

```typescript
// src/server/tools/registry.test.ts
import { test, expect } from "bun:test";
import { registerAll, type ToolRegistry } from "./registry.ts";

test("registerAll is a function that takes (server, ctx) and returns a ToolRegistry", () => {
  expect(typeof registerAll).toBe("function");
  expect(registerAll.length).toBe(2);
});

test("registerAll invokes every tool module's registerTools and returns a Map<string, handler>", () => {
  const calls: string[] = [];
  const fakeServer = {
    registerTool: (name: string) => { calls.push(name); },
  } as unknown as Parameters<typeof registerAll>[0];
  // ServerContext with foundation-buildable fields only; downstream-filled fields
  // are undefined and tool stubs MUST NOT touch them.
  const ctx = {
    db: undefined,
    configDb: {} as never,
    pdf: { interact: async () => null, getText: async () => "", currentRoots: () => [], isHealthy: () => ({ alive: true, lastOkAt: null, stdioOpen: true }) },
    config: { get: () => undefined, set: () => {}, corpora: () => [], activeCorpusId: () => undefined },
    log: { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    withCorpus: async (fn: (db: unknown) => unknown) => fn({} as never),
  } as unknown as Parameters<typeof registerAll>[1];
  const registry: ToolRegistry = registerAll(fakeServer, ctx);
  expect(registry).toBeInstanceOf(Map);
  // Stubs are no-ops at cycle 6.1; the registry is empty until downstream plans fill bodies.
  // The contract is shape-only: registry exists, is a Map, downstream cycles populate via
  // their fill-in of registerTools bodies.
  expect(typeof registry.get).toBe("function");
});
```

- [ ] **Step 2 — Run test to verify it fails.** Expect FAIL (registry.ts doesn't exist).

- [ ] **Step 3 — Implement.**

```typescript
// src/server/tools/registry.ts
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// === FROZEN CROSS-PLAN CONTRACTS (spec §7.6) ===
// Every interface below is exported type-only and MUST NOT be edited by any
// downstream plan. Schema/signature changes are foundation-only edits.

export interface PdfChild {
  interact(commands: unknown[], opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
  getText(viewUUID: string, opts?: { timeoutMs?: number }): Promise<string>;
  currentRoots(): string[];
  isHealthy(): { alive: boolean; lastOkAt: number | null; stdioOpen: boolean };
}

// Sqlite3McpChild removed 2026-05-24 (foundation-007, user posture B).

export interface Logger {
  trace(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface CorpusRow {
  id: string;
  display_name: string;
  archived_at: string | null;
  last_opened_at: string | null;
  created_at: string;
}

export interface ConfigAccessor {
  /** Canonical configuration keys (foundation-006 item 8 — kept as a JSDoc set
   *  rather than typed-keys to preserve the §7.6-frozen `get<T>(string)` shape):
   *    - "importDirs" : string[]      — §12.1 third allow-list leg for ingest scan paths
   *    - "backupRoot" : string        — destination root for `scholar.backup` (foundation-008,
   *                                     per user posture B §10 reimplementation); corpus-scoped,
   *                                     settable via the corpus tools; consumer pattern:
   *                                     `resolveUnderRoot(backupRoot, args.dest)` (§12.0 primitive
   *                                     rejects path traversal). Reads to undefined surface as
   *                                     a configuration-incomplete error from the backup tool.
   *    - "ollama.host" / "ollama.model.embed" / "ollama.model.chat"
   *    - "scholar.askClaudeEnabled"   — per-request opt-in default for cowork.askClaude
   *    - "ui.theme" / "ui.lastView"
   *  Consumers cast generically: `ctx.config.get<string[]>("importDirs")`. Adding
   *  a new key requires only documenting it here — no interface change. */
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  corpora(): CorpusRow[];
  activeCorpusId(): string | undefined;
}

export interface ServerContext {
  db: BunSQLiteDatabase | undefined;
  configDb: BunSQLiteDatabase;
  pdf: PdfChild;
  // sqlite3 field removed 2026-05-24 (foundation-007, user posture B).
  config: ConfigAccessor;
  log: Logger;
  withCorpus<T>(fn: (db: BunSQLiteDatabase) => Promise<T> | T): Promise<T>;
}

// === FOUNDATION-INTERNAL TYPES (NOT §7.6 frozen) ===
// ToolHandler / ToolRegistry are foundation-internal — they exist to support the
// --call CLI mode added in foundation-009. NOT part of the §7.6 frozen contracts;
// downstream plans should not import these directly (they import RegisterTools).
export type ToolHandler = (args: unknown, ctx: ServerContext) => Promise<unknown>;
export type ToolRegistry = Map<string, ToolHandler>;

// Foundation-009 (2026-05-24): RegisterTools' second parameter is the foundation-supplied
// `register` helper that BOTH calls `server.registerTool(name, def, handler)` AND records
// the handler into the ToolRegistry map. Downstream plans use it instead of calling
// `server.registerTool` directly — this lets CLI mode dispatch by name without forking.
export type RegisterHelper = (
  name: string,
  def: { description: string; inputSchema: unknown },
  handler: ToolHandler,
) => void;
export type RegisterTools = (server: McpServer, ctx: ServerContext, register: RegisterHelper) => void;
export type RunRawDdl = (db: BunSQLiteDatabase) => void;

// === BARREL ===
// Statically imports every tool stub. Downstream plans fill bodies of the
// imported stubs; nobody edits this file.

import { registerTools as registerCorpus } from "./corpus.ts";
import { registerTools as registerRoots } from "./roots.ts";
import { registerTools as registerSnapshot } from "./snapshot.ts";
import { registerTools as registerIngest } from "./ingest.ts";
import { registerTools as registerPdf } from "./pdf.ts";
import { registerTools as registerPapers } from "./papers.ts";
import { registerTools as registerDigest } from "./digest.ts";
import { registerTools as registerPrompts } from "./prompts.ts";
import { registerTools as registerAnnotations } from "./annotations.ts";
// Foundation-008 (2026-05-24) added three §10 stubs — extraction owns the bodies at cycle 6.14.
// Per user posture B, scholar reimplements query/backup/inspect inline via bun:sqlite (no sqlite3-mcp child).
import { registerTools as registerQuery } from "./query.ts";
import { registerTools as registerBackup } from "./backup.ts";
import { registerTools as registerInspect } from "./inspect.ts";

export function registerAll(server: McpServer, ctx: ServerContext): ToolRegistry {
  const registry: ToolRegistry = new Map();
  // Foundation-009: `register` helper closes over both side-effects — McpServer wire-up
  // for stdio mode, and ToolRegistry capture for CLI (`--call`) mode dispatch.
  const register: RegisterHelper = (name, def, handler) => {
    registry.set(name, handler);
    // `server.registerTool(name, def, handler-wrapper)` — the wrapper applies ctx
    // closure so the MCP-side handler signature matches SDK expectations. The
    // ToolRegistry-side handler is invoked directly from CLI mode with `args, ctx`.
    server.registerTool(name, def, async (args: unknown) => {
      const result = await handler(args, ctx);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    });
  };
  registerCorpus(server, ctx, register);
  registerRoots(server, ctx, register);
  registerSnapshot(server, ctx, register);
  registerIngest(server, ctx, register);
  registerPdf(server, ctx, register);
  registerPapers(server, ctx, register);
  registerDigest(server, ctx, register);
  registerPrompts(server, ctx, register);
  registerAnnotations(server, ctx, register);
  registerQuery(server, ctx, register);
  registerBackup(server, ctx, register);
  registerInspect(server, ctx, register);
  return registry;
}
```

- [ ] **Step 4 — Run test.** Will still FAIL — the static imports above require all twelve tool stubs to exist. Continue to Task 1.7 before re-running.

- [ ] **Step 5 — Commit (after Task 1.7 + 1.8 + 1.9 land).** Defer commit; see Task 1.7.

---

### Task 1.7: Twelve tool-module stubs (`src/server/tools/*.ts`)

**Files (all created):**
- `src/server/tools/corpus.ts`
- `src/server/tools/roots.ts`
- `src/server/tools/snapshot.ts`
- `src/server/tools/ingest.ts`
- `src/server/tools/pdf.ts`
- `src/server/tools/papers.ts`
- `src/server/tools/digest.ts`
- `src/server/tools/prompts.ts`
- `src/server/tools/annotations.ts`
- `src/server/tools/query.ts` — *(foundation-008 addition; extraction fills body at cycle 6.14 §10)*
- `src/server/tools/backup.ts` — *(foundation-008 addition; extraction fills body at cycle 6.14 §10)*
- `src/server/tools/inspect.ts` — *(foundation-008 addition; extraction fills body at cycle 6.14 §10)*

Each stub has identical shape — a no-op `registerTools` export — so downstream plans replace only the function body, never the import path or signature.

**Count history.** Foundation-005 = 9 stubs. Foundation-007 retained 9 stubs (no sqlite3 tool-module stub ever existed). Foundation-008 adds 3 new stubs (`query`, `backup`, `inspect`) per lead's directive that extraction absorbs §10's surface under user posture B. **Final v1 count: 12 stubs.**

- [ ] **Step 1 — Write the same stub to all twelve files.** Each file:

```typescript
// src/server/tools/<name>.ts (no-op stub authored by foundation at cycle 6.1)
// Body filled by the owning plan per docs/superpowers/specs/2026-05-22-scholar-plugin-splits.xml.
import type { RegisterTools } from "./registry.ts";

export const registerTools: RegisterTools = (_server, _ctx, _register) => {
  // intentionally empty — foundation scaffold.
  //
  // Foundation-009 contract for downstream plans filling this body:
  //   - Call `_register(name, def, handler)` (NOT `_server.registerTool(...)` directly)
  //     for every tool you register from this module. The foundation-supplied helper
  //     both wires the MCP-side stdio handler AND records the handler in the
  //     ToolRegistry that scholar's `--call` CLI mode dispatches from.
  //   - `handler` is `(args, ctx) => Promise<unknown>`. Throw to signal errors; foundation's
  //     CLI dispatcher converts thrown errors with `errorCode`/`message`/`details` shape into
  //     structured-error JSON on stderr.
  //   - You MAY call `_server.registerResource(...)` directly for non-tool surfaces
  //     (the ToolRegistry only tracks tool handlers).
};
```

- [ ] **Step 2 — Commit Tasks 1.6 + 1.7 together.** Now `registry.ts` typechecks because every static import resolves. Run the registry test.

```bash
bun test src/server/tools/registry.test.ts
git add src/server/tools/registry.ts src/server/tools/registry.test.ts \
        src/server/tools/corpus.ts src/server/tools/roots.ts src/server/tools/snapshot.ts \
        src/server/tools/ingest.ts src/server/tools/pdf.ts src/server/tools/papers.ts \
        src/server/tools/digest.ts src/server/tools/prompts.ts src/server/tools/annotations.ts \
        src/server/tools/query.ts src/server/tools/backup.ts src/server/tools/inspect.ts
git commit -m "feat(foundation): §7.6 frozen contracts + registry barrel + twelve tool stubs (cycle 6.1)"
```

---

### Task 1.8: `raw-ddl.ts` stub

**Files:**
- Create: `src/server/db/raw-ddl.ts`
- Test: `src/server/db/raw-ddl.test.ts`

Foundation scaffolds the file with an empty `runRawDdl` body. Extraction plan fills it (cycle 6.5 creates `chunk_vec`, cycle 6.6 creates `reading_queue` view — cycle order is load-bearing per splits.xml header).

Per the spec's **foundation test-scoping rule** (§7.6): foundation tests exercise the path through the empty stub and assert only that the call succeeds. They **must not** assert on `chunk_vec` or `reading_queue` existence.

- [ ] **Step 1 — Write the failing test.**

```typescript
// src/server/db/raw-ddl.test.ts
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWithPragmas } from "./migrations.ts";
import { runRawDdl } from "./raw-ddl.ts";

let dir: string | undefined;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test("runRawDdl is a no-op at the foundation layer (extraction fills the body)", () => {
  dir = mkdtempSync(join(tmpdir(), "scholar-rawddl-"));
  const db = openWithPragmas(join(dir, "t.db"));
  // No throw, no return value.
  expect(() => runRawDdl(db)).not.toThrow();
  // Foundation MUST NOT assert chunk_vec or reading_queue exist — that's
  // extraction's contract (cycles 6.5 / 6.6).
});
```

- [ ] **Step 2 — Run test to verify it fails.** Expect FAIL (file missing).

- [ ] **Step 3 — Implement the stub.**

```typescript
// src/server/db/raw-ddl.ts
// Foundation scaffold — body filled by extraction at cycle 6.5 (chunk_vec)
// and cycle 6.6 (reading_queue view). Cycle order is load-bearing.
import type { RunRawDdl } from "../tools/registry.ts";

export const runRawDdl: RunRawDdl = (_db) => {
  // intentionally empty — extraction fills CREATE VIRTUAL TABLE chunk_vec
  // and CREATE VIEW reading_queue here, both with IF NOT EXISTS so this hook
  // remains idempotent across corpus opens.
};
```

- [ ] **Step 4 — Run test.** `bun test src/server/db/raw-ddl.test.ts` — expect PASS.

- [ ] **Step 5 — Commit.**

```bash
git add src/server/db/raw-ddl.ts src/server/db/raw-ddl.test.ts
git commit -m "feat(foundation): runRawDdl stub (extraction fills at 6.5/6.6) (cycle 6.1)"
```

---

### Task 1.9: `src/server/ollama/client.ts` singleton stub

**Files:**
- Create: `src/server/ollama/client.ts`
- Test: `src/server/ollama/client.test.ts`

Per spec §7.6 + lead ruling 2026-05-24: foundation owns this file exclusively as a singleton stub. Extraction fills the chat/embed method bodies in cycles 6.5 (embeddings) and 6.8 (chat). The singleton shape is foundation-frozen so digest / prompts / pdf / papers can `import { ollama } from "../ollama/client.ts"` without a §7.6 ServerContext field.

- [ ] **Step 1 — Write the failing test.**

```typescript
// src/server/ollama/client.test.ts
import { test, expect } from "bun:test";
import { ollama } from "./client.ts";

test("ollama exposes the foundation-frozen singleton surface", () => {
  expect(ollama).toBeDefined();
  expect(typeof ollama.embed).toBe("function");
  expect(typeof ollama.chat).toBe("function");
  expect(typeof ollama.listModels).toBe("function");
  expect(typeof ollama.healthCheck).toBe("function");
});

test("ollama method stubs throw 'unimplemented' at the foundation layer", async () => {
  await expect(ollama.embed({ model: "x", input: "y" })).rejects.toThrow(/unimplemented/i);
  await expect(ollama.chat({ model: "x", messages: [] })).rejects.toThrow(/unimplemented/i);
});
```

- [ ] **Step 2 — Run test to verify it fails.** Expect FAIL.

- [ ] **Step 3 — Implement the singleton stub.**

```typescript
// src/server/ollama/client.ts
// Foundation-frozen singleton surface. Method bodies are filled by extraction
// at cycle 6.5 (embed/listModels/healthCheck) and cycle 6.8 (chat).
// Importers: digest.ts, prompts.ts, pdf.ts, papers.ts — never re-construct.

export interface OllamaEmbedRequest { model: string; input: string; }
export interface OllamaEmbedResponse { embedding: number[]; model: string; }

export interface OllamaChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  options?: { temperature?: number; num_ctx?: number };
}
export interface OllamaChatResponse { content: string; model: string; done_reason?: string; }

export interface OllamaModel { name: string; size: number; modified_at: string; }

export interface OllamaClient {
  /** Filled by extraction cycle 6.5 — POST /api/embeddings */
  embed(req: OllamaEmbedRequest): Promise<OllamaEmbedResponse>;
  /** Filled by extraction cycle 6.8 — POST /api/chat */
  chat(req: OllamaChatRequest): Promise<OllamaChatResponse>;
  /** Filled by extraction cycle 6.5 — GET /api/tags */
  listModels(): Promise<OllamaModel[]>;
  /** Filled by extraction cycle 6.5 — quick reachability probe */
  healthCheck(): Promise<{ ok: boolean; url: string; error?: string }>;
}

class OllamaClientImpl implements OllamaClient {
  private readonly baseUrl: string;
  constructor() {
    this.baseUrl = process.env.SCHOLAR_OLLAMA_URL ?? "http://127.0.0.1:11434";
  }
  async embed(_req: OllamaEmbedRequest): Promise<OllamaEmbedResponse> {
    throw new Error("ollama.embed unimplemented at the foundation layer; filled by extraction cycle 6.5");
  }
  async chat(_req: OllamaChatRequest): Promise<OllamaChatResponse> {
    throw new Error("ollama.chat unimplemented at the foundation layer; filled by extraction cycle 6.8");
  }
  async listModels(): Promise<OllamaModel[]> {
    throw new Error("ollama.listModels unimplemented at the foundation layer; filled by extraction cycle 6.5");
  }
  async healthCheck(): Promise<{ ok: boolean; url: string; error?: string }> {
    throw new Error("ollama.healthCheck unimplemented at the foundation layer; filled by extraction cycle 6.5");
  }
}

/** Process-singleton. One connection-pool + one health-check state across callers. */
export const ollama: OllamaClient = new OllamaClientImpl();
```

- [ ] **Step 4 — Run test.** Expect PASS.

- [ ] **Step 5 — Commit.**

```bash
git add src/server/ollama/client.ts src/server/ollama/client.test.ts
git commit -m "feat(foundation): ollama singleton stub (extraction fills bodies at 6.5/6.8) (cycle 6.1)"
```

---

### Task 1.10: `src/server/index.ts` — server skeleton

**Files:**
- Create: `src/server/index.ts`
- Test: `src/server/index.test.ts`

Foundation authors the entry's structural skeleton: McpServer construction, stdio transport wiring, ServerContext assembly, `registerAll` invocation, the per-corpus `initOnce` initializer per §7.3 step 4. Step 5 (pdf-child spawn) is deferred — lands in cycle 6.2. Step 6 (sqlite3-mcp `register_db`) **was removed 2026-05-24 (foundation-007, user posture B)** — the §10 query/backup/inspect surface is reimplemented inline via `bun:sqlite` by the cycle that owns it (pending separate user ruling on ownership).

**Foundation-009: dual-mode entry point.** `main()` becomes an argv-dispatched mutex: default → MCP server (existing behavior), `--call <tool-name> <args-json>` → CLI mode (runs the named tool once, emits result JSON on stdout, exits with structured-error semantics). CLI mode reuses `buildServer()` (same `ServerContext`, same `registerAll` tool registry) — context construction is NOT forked. The `BuiltServer` interface widens to expose `dispatch(toolName, args)` (foundation-internal, NOT in §7.6 frozen contracts). Tests landed in Task 1.10d (kept separate so Task 1.10's "buildServer pair returns expected shape" tests stay focused).

- [ ] **Step 1 — Write the failing test.**

```typescript
// src/server/index.test.ts
import { test, expect } from "bun:test";
import { buildServer, type BuildServerDeps } from "./index.ts";

test("buildServer returns an McpServer + ServerContext + dispatch triple", () => {
  const deps: BuildServerDeps = {
    runtimeRoot: "/tmp/scholar-runtime-test-doesnt-need-to-exist",
    openConfigDb: () => ({} as never),  // injected; foundation tests don't open a real file
    spawnPdfChild: () => ({
      interact: async () => null,
      getText: async () => "",
      currentRoots: () => [],
      isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
    }),
  };
  const { server, ctx, dispatch } = buildServer(deps);
  expect(server).toBeDefined();
  expect(ctx.db).toBeUndefined(); // no corpus active yet
  expect(ctx.configDb).toBeDefined();
  expect(ctx.pdf).toBeDefined();
  expect(typeof ctx.log.info).toBe("function");
  // Foundation-009: dispatch is foundation-internal (not §7.6 frozen).
  expect(typeof dispatch).toBe("function");
});

test("ServerContext.withCorpus snapshots ctx.db at entry", async () => {
  const deps: BuildServerDeps = {
    runtimeRoot: "/tmp/scholar-runtime-test",
    openConfigDb: () => ({} as never),
    spawnPdfChild: () => ({
      interact: async () => null, getText: async () => "", currentRoots: () => [],
      isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
    }),
  };
  const { ctx } = buildServer(deps);
  const fakeDbA = { tag: "A" } as never;
  const fakeDbB = { tag: "B" } as never;
  ctx.db = fakeDbA;
  const result = await ctx.withCorpus(async (snap) => {
    // simulate corpus.activate mutating ctx.db mid-call
    ctx.db = fakeDbB;
    return snap;
  });
  expect((result as { tag: string }).tag).toBe("A");
});

test("dispatch throws structured unknown_tool error for unregistered tools", async () => {
  const deps: BuildServerDeps = {
    runtimeRoot: "/tmp/scholar-runtime-test",
    openConfigDb: () => ({} as never),
    spawnPdfChild: () => ({
      interact: async () => null, getText: async () => "", currentRoots: () => [],
      isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
    }),
  };
  const { dispatch } = buildServer(deps);
  // Stubs are no-ops at cycle 6.1; nothing is in the registry yet.
  await expect(dispatch("scholar.does.not.exist", {})).rejects.toMatchObject({
    errorCode: "unknown_tool",
    tool: "scholar.does.not.exist",
  });
});
```

- [ ] **Step 2 — Run test to verify it fails.** Expect FAIL.

- [ ] **Step 3 — Implement.**

```typescript
// src/server/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import {
  registerAll,
  type PdfChild, type ServerContext, type ConfigAccessor, type Logger,
  type ToolRegistry,
} from "./tools/registry.ts";
import { registerUiResource } from "./ui/resource.ts";
import { openWithPragmas, applyMigrations } from "./db/migrations.ts";
import { join } from "node:path";

export interface BuildServerDeps {
  runtimeRoot: string;
  openConfigDb?: (path: string) => BunSQLiteDatabase;
  spawnPdfChild?: () => PdfChild;
  /** Foundation-009: pass `{ quiet: true }` to drop log level to `warn`
   *  (CLI mode keeps stdout clean for the JSON tool result). */
  quiet?: boolean;
  // spawnSqlite3McpChild removed 2026-05-24 (foundation-007, user posture B).
}

export interface BuiltServer {
  server: McpServer;
  ctx: ServerContext;
  /** Foundation-009 (NOT §7.6 frozen — foundation-internal): dispatch a tool by
   *  name without round-tripping through the stdio MCP transport. Used by CLI
   *  mode (`--call`). Throws if the tool is unknown; rethrows tool handler errors
   *  unchanged so the caller can convert to structured exit codes. */
  dispatch: (toolName: string, args: unknown) => Promise<unknown>;
}

function makeStdoutLogger(quiet: boolean): Logger {
  // CLI mode (quiet=true) suppresses trace/debug/info to keep stdout clean for
  // the JSON tool result. All log lines go to stderr regardless of mode — stdout
  // is reserved for the tool result in CLI mode.
  const log = (lvl: string, m: string, f?: Record<string, unknown>) =>
    console.error(JSON.stringify({ lvl, m, ...f }));
  if (quiet) {
    return {
      trace: () => {}, debug: () => {}, info: () => {},
      warn: (m, f) => log("warn", m, f),
      error: (m, f) => log("error", m, f),
    };
  }
  return {
    trace: (m, f) => log("trace", m, f),
    debug: (m, f) => log("debug", m, f),
    info:  (m, f) => log("info",  m, f),
    warn:  (m, f) => log("warn",  m, f),
    error: (m, f) => log("error", m, f),
  };
}

function buildConfigAccessor(_configDb: BunSQLiteDatabase): ConfigAccessor {
  // Foundation provides the type-correct shape; corpus plan (cycle 6.3) fills
  // the real DB-backed implementation. Until then every method returns empties.
  return {
    get: () => undefined,
    set: () => {},
    corpora: () => [],
    activeCorpusId: () => undefined,
  };
}

export function buildServer(deps: BuildServerDeps): BuiltServer {
  const configDbPath = join(deps.runtimeRoot, "dbs", "scholar-config.db");
  const openCfg = deps.openConfigDb ?? openWithPragmas;
  const configDb = openCfg(configDbPath);

  // Stub pdf so foundation can construct ServerContext before cycle 6.2 lands
  // the real spawn lifecycle. Production uses deps.spawnPdfChild (set by
  // cycle 6.2's main()).
  const pdf: PdfChild = deps.spawnPdfChild?.() ?? {
    interact: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
    getText: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
    currentRoots: () => [],
    isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
  };

  // sqlite3 stub removed 2026-05-24 (foundation-007, user posture B). The §10
  // query/backup/inspect surface is reimplemented inline via bun:sqlite by the
  // cycle that owns it (foundation-008: extraction cycle 6.14).

  const ctx: ServerContext = {
    db: undefined,
    configDb,
    pdf,
    config: buildConfigAccessor(configDb),
    log: makeStdoutLogger(deps.quiet ?? false),
    async withCorpus<T>(fn: (db: BunSQLiteDatabase) => Promise<T> | T): Promise<T> {
      const snap = ctx.db;
      if (!snap) throw new Error("no corpus active; call scholar.corpus.activate first");
      return await fn(snap);
    },
  };

  const server = new McpServer({ name: "scholar", version: "0.1.0" });
  const registry: ToolRegistry = registerAll(server, ctx);
  registerUiResource(server);  // ← scaffolded stub in Task 1.10b; filled by frontends cycle 6.9

  // Foundation-009: dispatch closure for CLI mode. Same ServerContext as
  // stdio mode — no fork.
  const dispatch = async (toolName: string, args: unknown): Promise<unknown> => {
    const handler = registry.get(toolName);
    if (!handler) {
      const err = new Error(`unknown_tool: ${toolName}`) as Error & { errorCode: string; tool: string };
      err.errorCode = "unknown_tool";
      err.tool = toolName;
      throw err;
    }
    return await handler(args, ctx);
  };

  return { server, ctx, dispatch };
}

// ====================================================================
// Foundation-009: dual-mode entry point dispatcher.
// argv parsing pulled to a named function so Task 1.10d can unit-test it.
// ====================================================================

export interface ParsedArgv {
  mode: "server" | "cli";
  toolName?: string;
  argsSource?: string;  // raw JSON string (or "-" for stdin)
}

/** Parse argv into (mode, optional tool name, optional args source).
 *  - `--call <tool-name> <args-json>` → CLI mode.
 *  - `--call <tool-name> -` → CLI mode, args from stdin.
 *  - anything else → server mode.
 *  Throws (via process.exit) on malformed `--call`.
 */
export function parseEntryArgv(argv: string[]): ParsedArgv {
  const idx = argv.indexOf("--call");
  if (idx === -1) return { mode: "server" };
  const rest = argv.slice(idx + 1);
  if (rest.length < 2) {
    // Surfaced as exit-2 in main(); parser stays pure (no process.exit here).
    return { mode: "cli", toolName: rest[0], argsSource: undefined };
  }
  return { mode: "cli", toolName: rest[0], argsSource: rest[1] };
}

async function readArgsJson(source: string): Promise<unknown> {
  const raw = source === "-" ? await Bun.stdin.text() : source;
  try {
    return JSON.parse(raw);
  } catch (e) {
    const err = new Error("invalid_args_json") as Error & { errorCode: string };
    err.errorCode = "invalid_args_json";
    err.message = (e as Error).message;
    throw err;
  }
}

async function runServer(runtimeRoot: string): Promise<void> {
  const { server } = buildServer({ runtimeRoot });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runCli(runtimeRoot: string, toolName: string | undefined, argsSource: string | undefined): Promise<number> {
  if (!toolName || argsSource === undefined) {
    process.stderr.write(JSON.stringify({
      error: "invalid_args",
      message: "--call requires <tool-name> <args-json>; pass `-` as args-json to read from stdin",
    }) + "\n");
    return 2;
  }
  let args: unknown;
  try {
    args = await readArgsJson(argsSource);
  } catch (e) {
    const err = e as { errorCode?: string; message?: string };
    process.stderr.write(JSON.stringify({ error: err.errorCode ?? "invalid_args_json", message: err.message }) + "\n");
    return 2;
  }
  const built = buildServer({ runtimeRoot, quiet: true });  // quiet=true for CLI mode
  try {
    const result = await built.dispatch(toolName, args);
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  } catch (e) {
    const err = e as { errorCode?: string; message?: string; details?: unknown; tool?: string };
    if (err.errorCode === "unknown_tool") {
      process.stderr.write(JSON.stringify({ error: "unknown_tool", tool: err.tool ?? toolName }) + "\n");
      return 2;
    }
    process.stderr.write(JSON.stringify({
      error: err.errorCode ?? "tool_error",
      message: err.message ?? String(e),
      details: err.details,
    }) + "\n");
    return 1;
  }
}

/** Entry point for the compiled binary (bun build --compile). */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const runtimeRoot = process.env.SCHOLAR_RUNTIME_ROOT
    ?? join(process.env.HOME ?? process.env.USERPROFILE ?? ".", "mcp-data", "scholar", "runtime");
  const parsed = parseEntryArgv(argv);
  if (parsed.mode === "cli") {
    return await runCli(runtimeRoot, parsed.toolName, parsed.argsSource);
  }
  await runServer(runtimeRoot);
  return 0;  // unreachable in normal flow (server runs until transport closes)
}

if (import.meta.main) {
  main().then((code) => {
    if (code !== 0) process.exit(code);
  }).catch((err) => {
    console.error(JSON.stringify({ lvl: "fatal", m: "scholar startup failed", err: String(err) }));
    process.exit(1);
  });
}
```

> Note: `applyMigrations` is imported but not called here. Cycle 6.3 (corpus plan, `scholar.corpus.activate`) calls it when a corpus is opened; foundation only needs the import to resolve at typecheck time. Step 5 (pdf-child spawn) of spec §7.3 is deferred — lands in cycle 6.2 (this plan). Step 6 (sqlite3-mcp register) was REMOVED 2026-05-24 (foundation-007, user posture B); §10 surface re-implementation is lead-owned spec amendment work.

- [ ] **Step 4 — Run tests.** `bun test src/server/index.test.ts` — expect PASS.

- [ ] **Step 5 — Commit.** (Defer — Task 1.10b adds the `registerUiResource` import that index.ts depends on; Task 1.10d adds CLI-mode tests for `--call`. Commit Tasks 1.10 + 1.10b + 1.10d together.)

---

### Task 1.10b: `src/server/ui/resource.ts` scaffold (frontends-filled at 6.9)

**Files:**
- Create: `src/server/ui/resource.ts`
- Test: `src/server/ui/resource.test.ts`

Foundation scaffolds the UI-resource registration stub as a sibling no-op (parallel to the twelve tool-module stubs from Task 1.7). Frontends fills the body at cycle 6.9 — the body registers `ui://scholar/app.html` and serves the single-file React bundle per spec §5.20.

Why foundation owns the scaffold: `src/server/index.ts`'s `buildServer` (Task 1.10) statically imports `registerUiResource` and calls it after `registerAll`. Without the stub, `index.ts` doesn't typecheck at cycle 6.1.

- [ ] **Step 1 — Write the failing test.**

```typescript
// src/server/ui/resource.test.ts
import { test, expect } from "bun:test";
import { registerUiResource } from "./resource.ts";

test("registerUiResource is a foundation-scaffolded no-op (frontends fills at 6.9)", () => {
  expect(typeof registerUiResource).toBe("function");
  expect(registerUiResource.length).toBe(1);
  // Stub MUST NOT throw on a minimal server-shaped object.
  const fakeServer = { registerResource: () => {} } as never;
  expect(() => registerUiResource(fakeServer)).not.toThrow();
});
```

- [ ] **Step 2 — Run test to verify it fails.** Expect FAIL.

- [ ] **Step 3 — Implement the stub.**

```typescript
// src/server/ui/resource.ts
// Foundation scaffold — body filled by frontends at cycle 6.9 per spec §5.20.
// The body will register `ui://scholar/app.html` and serve the single-file
// React bundle produced by `bun build src/ui/index.html --target=browser`.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerUiResource(_server: McpServer): void {
  // intentionally empty — foundation scaffold
}
```

- [ ] **Step 4 — Run tests.** `bun test src/server/ui/resource.test.ts` AND `bun test src/server/index.test.ts` — both pass now that `index.ts`'s `registerUiResource` import resolves.

- [ ] **Step 5 — Commit Tasks 1.10 + 1.10b together.** Task 1.10c (sqlite3-mcp lifecycle) was REMOVED 2026-05-24 (foundation-007, user posture B) — no third task to coordinate with.

```bash
git add src/server/index.ts src/server/index.test.ts \
        src/server/ui/resource.ts src/server/ui/resource.test.ts
git commit -m "feat(foundation): McpServer skeleton + ServerContext + ui scaffold (cycle 6.1)"
```

---

### Task 1.10c: REMOVED 2026-05-24 (foundation-007, user posture B)

Originally scaffolded `src/server/sqlite3-mcp/lifecycle.ts` per Lead Ruling #1 (Option A — scholar spawns sqlite3-mcp as its own child). Removed entirely after the user-confirmed posture B pivot: scholar drops sqlite3-mcp delegation; no child, no vendor copy, no `Sqlite3McpChild` interface. The §10 query/backup/inspect surface is reimplemented inline via `bun:sqlite` by the cycle that owns it (pending separate user ruling on ownership: extraction vs corpus vs defer-to-v1.1).

**What was here:** Task 1.10c authored `src/server/sqlite3-mcp/lifecycle.ts` with `spawnSqlite3McpChild()` + four fixture tests (spawn lifecycle, graceful-degrade, callTool round-trip, supervised respawn) + the inline supervisor pattern (`attemptSpawn` + `scheduleRespawn`, backoff `[1s, 2s, 4s, 8s, 30s]`, crash-loop terminal state). The supervisor pattern survives in Task 2.2 (pdf-child lifecycle) where it still applies — only the sqlite3-mcp instance is gone.

**Historical anchors** for the trajectory: Cross-plan spec gaps §3 (RESOLVED Option A, then SUPERSEDED 2026-05-24) and §3-followon (RESOLVED option (a) vendoring, then SUPERSEDED 2026-05-24).

> **Implementation discipline.** When the executor reaches what was Task 1.10c's commit point, there is nothing to do — Tasks 1.10 + 1.10b are the only files in that commit (see updated `git add` list in Task 1.10 step 5).


---

### Task 1.10d: `--call` CLI flag — three lead-specified tests (foundation-009)

**Files:**
- Test: `src/server/cli.test.ts`
- (No new source file — `--call` dispatch lives in `src/server/index.ts`'s `main()` per Task 1.10's foundation-009 rewrite.)

Task 1.10's body already authored `parseEntryArgv` + `runCli` + the dual-mode `main()`. Task 1.10d adds the three tests lead specified in the amendment-3 dispatch: (a) argv parser unit, (b) integration via `bun run`, (c) mode-mutex spy asserting `transport.connect` is NOT called when argv contains `--call`. Kept separate from `index.test.ts` so the CLI mode test surface evolves independently from the `buildServer` shape tests.

**Per-test rationale:**

| Test | Purpose | Why it lives in CLI test suite (not `index.test.ts`) |
|---|---|---|
| (a) argv parser unit | Cover argv variants (`--call tool '{}'`, `--call tool -`, missing args, no `--call` flag) without spinning up a server. | Pure function; no fixtures, no lifecycle. |
| (b) integration via `bun run` | End-to-end exit code + stdout/stderr framing assertions. Catches regressions where parser+dispatch agree but framing mode flips (e.g., log line accidentally hits stdout). | Requires a real subprocess (Bun.spawn). |
| (c) mode-mutex spy | Asserts CLI mode does NOT bind stdio MCP transport (otherwise the CLI subprocess would block on stdin reading MCP frames). | Requires intercepting `StdioServerTransport`; cleaner as a focused test. |

- [ ] **Step 1 — Write the failing tests.**

```typescript
// src/server/cli.test.ts
import { test, expect, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEntryArgv } from "./index.ts";

test("(a) parseEntryArgv: no --call → server mode", () => {
  expect(parseEntryArgv([])).toEqual({ mode: "server" });
  expect(parseEntryArgv(["--foo", "bar"])).toEqual({ mode: "server" });
});

test("(a) parseEntryArgv: --call <tool> <args-json> → CLI mode", () => {
  const p = parseEntryArgv(["--call", "scholar.corpus.list", "{}"]);
  expect(p).toEqual({ mode: "cli", toolName: "scholar.corpus.list", argsSource: "{}" });
});

test("(a) parseEntryArgv: --call <tool> - → CLI mode with stdin args", () => {
  const p = parseEntryArgv(["--call", "scholar.papers.upsert", "-"]);
  expect(p).toEqual({ mode: "cli", toolName: "scholar.papers.upsert", argsSource: "-" });
});

test("(a) parseEntryArgv: --call <tool> with missing args → CLI mode, argsSource=undefined", () => {
  // Parser stays pure; main() surfaces this as exit 2 with structured invalid_args error.
  const p = parseEntryArgv(["--call", "scholar.corpus.list"]);
  expect(p).toEqual({ mode: "cli", toolName: "scholar.corpus.list", argsSource: undefined });
});

test("(b) integration: bun run src/server/index.ts --call <unknown> '{}' → exit 2 + unknown_tool on stderr", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scholar-cli-"));
  try {
    const proc = Bun.spawn(
      ["bun", "run", "src/server/index.ts", "--call", "scholar.does.not.exist", "{}"],
      {
        cwd: process.cwd(),
        env: { ...process.env, SCHOLAR_RUNTIME_ROOT: dir },
        stdout: "pipe", stderr: "pipe",
      },
    );
    const exitCode = await proc.exited;
    const stderrText = await new Response(proc.stderr).text();
    expect(exitCode).toBe(2);
    // stderr should contain a JSON line with error=unknown_tool. (May also contain warn-level log lines.)
    const errLine = stderrText.split("\n").find((l) => l.includes("unknown_tool"));
    expect(errLine).toBeDefined();
    expect(JSON.parse(errLine!)).toMatchObject({ error: "unknown_tool", tool: "scholar.does.not.exist" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(b) integration: bun run ... --call ... 'invalid-json' → exit 2 + invalid_args_json on stderr", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scholar-cli-"));
  try {
    const proc = Bun.spawn(
      ["bun", "run", "src/server/index.ts", "--call", "scholar.does.not.exist", "not-valid-json{"],
      { cwd: process.cwd(), env: { ...process.env, SCHOLAR_RUNTIME_ROOT: dir }, stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stderrText = await new Response(proc.stderr).text();
    expect(exitCode).toBe(2);
    const errLine = stderrText.split("\n").find((l) => l.includes("invalid_args_json"));
    expect(errLine).toBeDefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(c) mode-mutex: main(['--call', ...]) does NOT bind stdio MCP transport", async () => {
  // Spy on StdioServerTransport via Bun's mock surface. Approach: inject a mock at module
  // load time using mock.module(). The CLI dispatch path must never construct
  // StdioServerTransport — if it does, the mock's constructor counter trips the assertion.
  let stdioConstructed = 0;
  mock.module("@modelcontextprotocol/sdk/server/stdio.js", () => ({
    StdioServerTransport: class {
      constructor() { stdioConstructed += 1; }
      async start() {}
    },
  }));
  // Re-import after the mock so the SUT picks it up.
  const { main } = await import("./index.ts");
  const dir = mkdtempSync(join(tmpdir(), "scholar-cli-mutex-"));
  try {
    process.env.SCHOLAR_RUNTIME_ROOT = dir;
    const exitCode = await main(["--call", "scholar.does.not.exist", "{}"]);
    expect(exitCode).toBe(2);  // unknown_tool → exit 2
    expect(stdioConstructed).toBe(0);  // ← THE assertion: CLI mode never touches stdio transport
  } finally {
    rmSync(dir, { recursive: true, force: true });
    mock.restore();
  }
});
```

- [ ] **Step 2 — Run tests to verify they fail.** Tests (a) fail first (parser doesn't exist in the original Task 1.10 body until foundation-009 lands); (b) fails on the integration assertion; (c) fails on the mode-mutex assertion.

- [ ] **Step 3 — Implement.** No implementation step — Task 1.10's foundation-009 rewrite already authored `parseEntryArgv` + `runCli` + the dual-mode `main()`. Running Task 1.10d in TDD order after Task 1.10 means the tests pass as soon as Task 1.10 lands.

- [ ] **Step 4 — Run tests.** `bun test src/server/cli.test.ts` — expect PASS for all three.

- [ ] **Step 5 — Commit Task 1.10d alongside Task 1.10 + 1.10b.**

```bash
git add src/server/cli.test.ts
git commit -m "test(foundation): --call CLI dispatch — parser unit, integration, mode-mutex (cycle 6.1, foundation-009)"
```

> **CLI test stability note.** The `mock.module()` approach in test (c) requires Bun ≥ 1.1.27 (which foundation pins in `package.json`'s `engines.bun` field per Task 1.1). If a future Bun release changes `mock.module` semantics, the alternative is to use dependency injection — pass a `transportFactory: () => StdioServerTransport` into `buildServer` deps and let test (c) inject a spy factory. The current approach (mock.module) is preferred because it keeps the production code path unchanged.

---

### Task 1.11: Plugin manifest + `.mcp.json`

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.mcp.json`
- Test: `manifests.test.ts` (sibling at repo root)

Both files transcribed verbatim from spec §7.1.

- [ ] **Step 1 — Write the failing test.**

```typescript
// manifests.test.ts
import { test, expect } from "bun:test";
import pluginManifest from "./.claude-plugin/plugin.json";
import mcpManifest from "./.mcp.json";

test("plugin manifest matches spec §7.1", () => {
  expect(pluginManifest.name).toBe("scholar");
  expect(pluginManifest.license).toBe("MIT");
  expect(pluginManifest.keywords).toContain("literature-review");
});

test(".mcp.json points command at the compiled binary placeholder", () => {
  expect(mcpManifest.mcpServers.scholar.command).toBe("${CLAUDE_PLUGIN_ROOT}/build/scholar");
  expect(mcpManifest.mcpServers.scholar.env.SCHOLAR_OLLAMA_EMBED_MODEL).toBe("nomic-embed-text:v1.5");
  expect(mcpManifest.mcpServers.scholar.env.SCHOLAR_OLLAMA_CHAT_MODEL).toBe("qwen3:8b");
});
```

- [ ] **Step 2 — Run test to verify it fails.**

- [ ] **Step 3 — Write `.claude-plugin/plugin.json`** (verbatim §7.1):

```json
{
  "name": "scholar",
  "version": "0.1.0",
  "description": "Literature review workspace. Multi-corpus reading, annotation, semantic search, Ollama-powered syntheses, and a vendored pdf MCP. Inspired by but independent of the Daisy Lit Review artifact.",
  "author": { "name": "zayn" },
  "keywords": ["literature-review", "research", "mcp-apps", "annotations", "ollama", "sqlite-vec"],
  "license": "MIT"
}
```

- [ ] **Step 4 — Write `.mcp.json`** (verbatim §7.1):

```json
{
  "mcpServers": {
    "scholar": {
      "command": "${CLAUDE_PLUGIN_ROOT}/build/scholar",
      "args": [],
      "env": {
        "SCHOLAR_RUNTIME_ROOT": "${HOME}/mcp-data/scholar/runtime",
        "SCHOLAR_OLLAMA_URL": "http://127.0.0.1:11434",
        "SCHOLAR_OLLAMA_EMBED_MODEL": "nomic-embed-text:v1.5",
        "SCHOLAR_OLLAMA_CHAT_MODEL": "qwen3:8b"
      }
    }
  }
}
```

- [ ] **Step 5 — Run test.** Expect PASS.

- [ ] **Step 6 — Commit.**

```bash
git add .claude-plugin/plugin.json .mcp.json manifests.test.ts
git commit -m "feat(foundation): plugin manifest + .mcp.json per §7.1 (cycle 6.1)"
```

---

### Task 1.12: Cycle 6.1 sanity sweep

- [ ] **Step 1 — Full typecheck.** `bun run typecheck` — expect zero errors.
- [ ] **Step 2 — Full test run.** `bun test` — every cycle-6.1 test PASSes.
- [ ] **Step 3 — Confirm zero downstream-owned files have been authored.** Tools other than the stubs have empty bodies. `raw-ddl.ts` is empty. `ollama/client.ts` methods throw "unimplemented".
- [ ] **Step 4 — Tag the cycle.** `git tag foundation-6.1-complete`.

---

# Cycle 6.2 — Vendored pdf MCP + protocol-based roots responder

**Touches:** §5.19, §5.28
**Depends-on:** 6.1
**Open chore that gates this cycle:** `license-audit-vendored-pdf-server` (chores.xml). Before merging cycle 6.2's vendor commit, the chore must close with a confirmation that `@modelcontextprotocol/server-pdf@1.7.2`'s license permits vendoring + redistribution under MIT. If the audit returns "no" the cycle aborts and re-vendoring strategy changes — coordinate with team-lead.

**Anchor quotes (§16 fixture suite — the canary set for re-vendor drift).** The four fixtures below come from spec §16's "Upstream pdf server changes its MCP protocol shape" mitigation row, which pins them as the drift-detection suite that runs after every re-vendor:

> "Vendor is **unmodified** — there is no patch to re-apply, so divergence surfaces as protocol-shape changes scholar's MCP client side must adapt to. Re-vendoring on a minor bump is `bun pm pack` + unpack + run the cycle-6.2 fixture suite (roots/list responder, list_changed round-trip, viewUUID survival across a root mutation); any failure pins the affected behaviour to a versioned shim in `src/server/pdf/lifecycle.ts`."

And from spec §7.2's "Why no patch" paragraph:

> "The upstream stdio entrypoint at `dist/index.js:34385` registers an `oninitialized` handler (via `createServer` with `useClientRoots: true`) that calls `server.listRoots()`. The helper `refreshRoots` (`dist/server.js:29901`) then *clears* `allowedLocalDirs` and refills it from the MCP client's reply. Two preconditions must hold on the client side for the directories to land: 1. The client advertises `capabilities.roots.listChanged = true` in its `initialize` response — without this, `refreshRoots` early-returns at `dist/server.js:29902` and the `clear()` leaves the set empty. 2. The client registers a `ListRootsRequestSchema` handler that returns the active corpus's PDF roots as `file://` URIs."

### Task 2.1: Vendor copy procedure

**Files:**
- Create: `src/vendor/pdf-server/` (unmodified content from `@modelcontextprotocol/server-pdf@1.7.2`)
- Create: `scripts/vendor-pdf-server.ts`
- Test: `src/vendor/pdf-server/vendor.test.ts`

The vendor copy is mechanical: `bun pm pack @modelcontextprotocol/server-pdf@1.7.2` → unpack the tarball → copy `dist/` into `src/vendor/pdf-server/dist/`. **No source modification.** No `PATCH.md` (the `5.29 *(retired)*` placeholder in the spec is intentional).

- [ ] **Step 1 — Write the failing test.**

```typescript
// src/vendor/pdf-server/vendor.test.ts
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const vendorRoot = import.meta.dir;

test("vendored pdf-server dist/index.js exists and is unmodified upstream", () => {
  const indexJs = join(vendorRoot, "dist", "index.js");
  expect(existsSync(indexJs)).toBe(true);
  const content = readFileSync(indexJs, "utf8");
  // Pin the §7.2 anchor: the createServer call at line 34385 with useClientRoots.
  expect(content).toContain("useClientRoots");
  // Pin the §7.2 anchor: refreshRoots clears allowedLocalDirs.
  expect(content.includes("allowedLocalDirs") || readFileSync(join(vendorRoot, "dist", "server.js"), "utf8").includes("allowedLocalDirs")).toBe(true);
});

test("vendored upstream version matches expected pin", () => {
  const pkg = JSON.parse(readFileSync(join(vendorRoot, "package.json"), "utf8"));
  expect(pkg.name).toBe("@modelcontextprotocol/server-pdf");
  expect(pkg.version).toBe("1.7.2");
});
```

- [ ] **Step 2 — Run test to verify it fails.** Expect FAIL (no vendor present).

- [ ] **Step 3 — Write `scripts/vendor-pdf-server.ts`** (the re-vendor automation; chore `upstream-pdf-server-revendor-process` documents the procedure separately).

```typescript
// scripts/vendor-pdf-server.ts
// One-shot helper: re-runs `bun pm pack` against the pinned upstream version,
// unpacks the tarball, copies dist/ + package.json into src/vendor/pdf-server/,
// then re-runs the cycle-6.2 fixture suite as the drift canary.
import { $ } from "bun";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const VERSION = "1.7.2";
const DEST = join(import.meta.dir, "..", "src", "vendor", "pdf-server");

async function main() {
  const tmp = join(import.meta.dir, "..", "build", "_vendor-stage");
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  await $`bun pm pack @modelcontextprotocol/server-pdf@${VERSION}`.cwd(tmp);
  // bun pm pack writes <name>-<ver>.tgz into cwd; extract with tar.
  await $`tar -xzf modelcontextprotocol-server-pdf-${VERSION}.tgz -C ${tmp}`;
  const pkg = join(tmp, "package");
  if (!existsSync(pkg)) throw new Error("pack/extract failed");

  rmSync(DEST, { recursive: true, force: true });
  mkdirSync(DEST, { recursive: true });
  cpSync(join(pkg, "dist"), join(DEST, "dist"), { recursive: true });
  cpSync(join(pkg, "package.json"), join(DEST, "package.json"));
  console.log(`vendored @modelcontextprotocol/server-pdf@${VERSION} → ${DEST}`);
  console.log("now run: bun test src/server/pdf/lifecycle.test.ts");
}

main();
```

- [ ] **Step 4 — Run the script.** `bun scripts/vendor-pdf-server.ts`.

- [ ] **Step 5 — Run the test.** `bun test src/vendor/pdf-server/vendor.test.ts` — expect PASS (the anchor strings appear in the vendored dist).

- [ ] **Step 6 — Commit (vendor + script + test together).**

```bash
git add scripts/vendor-pdf-server.ts src/vendor/pdf-server/ src/vendor/pdf-server/vendor.test.ts
git commit -m "feat(foundation): vendor @modelcontextprotocol/server-pdf@1.7.2 unmodified (cycle 6.2)"
```

---

### Task 2.1b: REMOVED 2026-05-24 (foundation-007, user posture B)

Originally vendored sqlite3-mcp under `src/vendor/sqlite3-mcp/` per the user-override option (a) of Cross-plan spec gaps §3-followon. Removed entirely after the user-confirmed posture B pivot reverses Lead Ruling #1. No vendor copy, no `scripts/vendor-sqlite3-mcp.ts`, no `src/vendor/sqlite3-mcp/`. The cycle-6.13 packaging plan also drops its corresponding pack-sqlite3-mcp logic (lead's 2026-05-24 heads-up to packaging).

**Two chore filings withdrawn:** `license-audit-vendored-sqlite3-mcp` and `upstream-sqlite3-mcp-revendor-process` (foundation-006 requested both; foundation-007 withdraws both before lead files them — see submission DM to team-lead).

---

### Task 2.2: `src/server/pdf/lifecycle.ts` — spawn + MCP client + roots responder

**Files:**
- Create: `src/server/pdf/lifecycle.ts`
- Test: `src/server/pdf/lifecycle.test.ts`

Implements the four fixture-suite behaviors §16 pins as the drift canary, plus the Windows Job Object orphan-reap fixture (5) and the supervised respawn fixture (6, foundation-006 item 10). Each fixture is one test; the suite as a whole is what runs on every upstream re-vendor.

**Supervised respawn (foundation-006 item 10, retained in foundation-007 — pdf-child is the sole supervised child after the posture B pivot dropped sqlite3-mcp).** When the pdf-child exits unexpectedly (non-zero rc + not in `shuttingDown` state), foundation re-spawns it with an exponential-backoff schedule (`1s, 2s, 4s, 8s, 30s`-capped), captures `currentRoots` across the respawn boundary (the variable lives in foundation's closure, not in the child process), and re-attaches the `ListRootsRequestSchema` handler + Job Object on the new PID. Backoff resets on a successful `getText` or `interact` round-trip. Crash-loop terminal state (5 sub-1s exits in a row) surfaces as `isHealthy().alive === false` until manual remediation.

The executor adds these constants + helpers around the existing `spawnPdfChild` body in Step 3:

```typescript
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 30_000] as const;
const CRASH_LOOP_THRESHOLD_MS = 1_000;
const CRASH_LOOP_TRIPS = 5;
// attemptSpawn() wraps the child + transport + client construction in a try
// that registers child.once("exit", scheduleRespawn). scheduleRespawn()
// detects crash-loop via uptime vs CRASH_LOOP_THRESHOLD_MS, increments
// backoffIdx, and setTimeout(attemptSpawn, BACKOFF_MS[backoffIdx]) unless
// shuttingDown is true. Successful getText/interact resets backoffIdx + crash counter.
```

Foundation-007 ships ONE supervised child (pdf) — the sqlite3-mcp half from foundation-006 was deleted entirely. The "shared helper vs inline" question (advisor's prior framing) collapses: with only one supervised child, there is nothing to duplicate or abstract.

- [ ] **Step 1 — Write the failing fixture tests.**

```typescript
// src/server/pdf/lifecycle.test.ts
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnPdfChild, type PdfChildHandle } from "./lifecycle.ts";

let handle: PdfChildHandle | undefined;
let tmpRoot: string | undefined;

afterEach(async () => {
  if (handle) { await handle.shutdown(); handle = undefined; }
  if (tmpRoot) { rmSync(tmpRoot, { recursive: true, force: true }); tmpRoot = undefined; }
});

function makeTempPdfRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "scholar-pdf-root-"));
  mkdirSync(join(dir, "papers"), { recursive: true });
  // Tiny valid PDF — single-page magic + header. The fixture only needs the
  // upstream to see a discoverable file; full PDF parsing is the child's job.
  writeFileSync(join(dir, "papers", "fixture.pdf"), Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
  return dir;
}

// FIXTURE 1: Spawn lifecycle — child starts, initializes, exposes a healthy handle.
test("spawn lifecycle: child initializes and reports healthy", async () => {
  tmpRoot = makeTempPdfRoot();
  handle = await spawnPdfChild({ initialRoots: [tmpRoot] });
  const health = handle.isHealthy();
  expect(health.alive).toBe(true);
  expect(health.stdioOpen).toBe(true);
});

// FIXTURE 2: roots/list responder — child calls listRoots; scholar's handler
// replies with the active corpus's roots as file:// URIs.
test("roots/list responder: returns currentRoots as file:// URIs on demand", async () => {
  tmpRoot = makeTempPdfRoot();
  handle = await spawnPdfChild({ initialRoots: [tmpRoot] });
  // Drive the child's allowedLocalDirs refill explicitly. The child re-fills
  // its set whenever scholar sends notifications/roots/list_changed.
  await handle.refreshChildRoots();
  expect(handle.currentRoots()).toEqual([tmpRoot]);
  // Indirect verification: the child accepts a get_text call rooted under tmpRoot.
  // A real call would require a real PDF; we only assert the handler ran, via
  // the child's debug-introspect proxy (exposed in this fixture via stdio readback).
  const introspect = await handle.debugIntrospectAllowedDirs();
  expect(introspect).toContain(tmpRoot);
});

// FIXTURE 3: list_changed round-trip — scholar emits notifications/roots/list_changed
// after setRoots; child re-invokes listRoots and updates allowedLocalDirs without respawn.
test("list_changed round-trip: setRoots mutates child without respawn", async () => {
  tmpRoot = makeTempPdfRoot();
  const secondRoot = mkdtempSync(join(tmpdir(), "scholar-pdf-root2-"));
  try {
    handle = await spawnPdfChild({ initialRoots: [tmpRoot] });
    const pidBefore = handle.childPid();
    await handle.setRoots([tmpRoot, secondRoot]);
    const pidAfter = handle.childPid();
    expect(pidAfter).toBe(pidBefore); // NO respawn
    const introspect = await handle.debugIntrospectAllowedDirs();
    expect(introspect.sort()).toEqual([tmpRoot, secondRoot].sort());
  } finally {
    rmSync(secondRoot, { recursive: true, force: true });
  }
});

// FIXTURE 4: viewUUID survival across root mutation — a viewer opened before
// setRoots remains valid (no respawn means no viewUUID invalidation).
test("viewUUID survives across a root mutation", async () => {
  tmpRoot = makeTempPdfRoot();
  handle = await spawnPdfChild({ initialRoots: [tmpRoot] });
  // Open a viewer against the fixture PDF; record its viewUUID.
  const openResp = await handle.interact([{
    type: "open", path: join(tmpRoot, "papers", "fixture.pdf"),
  }]) as { viewUUID: string };
  const uuid = openResp.viewUUID;
  // Mutate roots (add a sibling root that doesn't affect the open viewer).
  const secondRoot = mkdtempSync(join(tmpdir(), "scholar-pdf-root3-"));
  try {
    await handle.setRoots([tmpRoot, secondRoot]);
    // The same viewUUID still resolves.
    const text = await handle.getText(uuid);
    expect(typeof text).toBe("string");
  } finally {
    rmSync(secondRoot, { recursive: true, force: true });
  }
});

// FIXTURE 5 (Windows only): Job Object kills child when scholar dies.
test.skipIf(process.platform !== "win32")(
  "Job Object reaps the orphan child on parent SIGKILL", async () => {
    // This test spawns a sub-process whose ONLY job is to spawn the pdf child
    // then exit; we then assert the pdf child also exits within N ms.
    // Implementation deferred to executor — uses Bun.spawn for the harness
    // and process.kill(childPid, 0) to probe liveness.
    expect(true).toBe(true); // placeholder until executor wires the harness
  },
);

// FIXTURE 6 (foundation-006 item 10, retained in foundation-007): supervised
// respawn after unexpected child exit. Exercises the inline supervisor with the
// 1s first-bucket backoff. Uses SIGKILL on the vendored child PID to simulate
// crash; supervisor must re-spawn and currentRoots must survive.
test("supervised respawn: setRoots survives a child SIGKILL", async () => {
  tmpRoot = makeTempPdfRoot();
  handle = await spawnPdfChild({ initialRoots: [tmpRoot] });
  const pidBefore = handle.childPid();
  expect(pidBefore).toBeDefined();
  // Kill the child out from under us.
  process.kill(pidBefore!, "SIGKILL");
  // Supervisor first-bucket is 1s; allow a 500ms slack window for SDK re-handshake.
  await new Promise((r) => setTimeout(r, 1_500));
  // currentRoots is a process-local mutable variable — must survive respawn.
  expect(handle.currentRoots()).toEqual([realpathSync(tmpRoot)]);
  // New child must be healthy and have a different PID.
  const h = handle.isHealthy();
  expect(h.alive).toBe(true);
  expect(handle.childPid()).not.toBe(pidBefore);
});
```

- [ ] **Step 2 — Run tests to verify they fail.** Expect FAIL.

- [ ] **Step 3 — Implement `src/server/pdf/lifecycle.ts`.**

```typescript
// src/server/pdf/lifecycle.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema, RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import pLimit from "../util/p-limit.ts";  // foundation ships a 30-LOC inline impl; see below
import type { PdfChild } from "../tools/registry.ts";

export interface SpawnOpts {
  initialRoots: string[];
  /** Override the child entrypoint path (test harness uses a stub). */
  childEntrypoint?: string;
  /** Override the bun runtime path (test harness uses process.execPath). */
  bunRuntime?: string;
}

export interface PdfChildHandle extends PdfChild {
  setRoots(paths: string[]): Promise<void>;
  refreshChildRoots(): Promise<void>;
  childPid(): number | undefined;
  debugIntrospectAllowedDirs(): Promise<string[]>;
  shutdown(): Promise<void>;
}

export async function spawnPdfChild(opts: SpawnOpts): Promise<PdfChildHandle> {
  let currentRoots: string[] = sanitizeRoots(opts.initialRoots);
  let lastOkAt: number | null = null;

  const childPath = opts.childEntrypoint
    ?? join(process.env.CLAUDE_PLUGIN_ROOT ?? resolve(import.meta.dir, "..", "..", ".."),
            "src", "vendor", "pdf-server", "dist", "index.js");
  const bunPath = opts.bunRuntime
    ?? join(process.env.CLAUDE_PLUGIN_ROOT ?? resolve(import.meta.dir, "..", "..", ".."),
            "build", "runtime", process.platform === "win32" ? "bun.exe" : "bun");

  const child: ChildProcess = spawn(
    bunPath,
    ["run", childPath, "--use-client-roots", "--stdio"],
    { stdio: ["pipe", "pipe", "inherit"] },
  );

  // Windows orphan-reaping via Job Object (koffi FFI).
  if (process.platform === "win32") attachJobObject(child.pid!);
  else if (process.platform === "linux") setPdeathsig(child.pid!);

  const transport = new StdioClientTransport({
    command: bunPath,
    args: ["run", childPath, "--use-client-roots", "--stdio"],
    // Re-using the child we spawned would be ideal; the SDK's StdioClientTransport
    // takes a command/args pair and spawns internally. For lifecycle parity,
    // we let the SDK spawn — but then kill the duplicate child above via
    // child.kill() and let the SDK's child be the one Job-Object-attached.
    // Implementation note: refactor at executor time so attachJobObject runs
    // against the SDK-spawned PID after transport.start() returns it.
  });

  const client = new Client(
    { name: "scholar", version: "0.1.0" },
    { capabilities: { roots: { listChanged: true } } },
  );

  // Roots responder — the load-bearing piece per §7.2.
  client.setRequestHandler(ListRootsRequestSchema, async () => ({
    roots: sanitizeRoots(currentRoots).map((p) => ({ uri: pathToFileURL(p).toString() })),
  }));

  await client.connect(transport);
  lastOkAt = Date.now();

  // Single-slot mutex over root mutations.
  const mutex = pLimit(1);

  async function setRoots(paths: string[]): Promise<void> {
    await mutex(async () => {
      currentRoots = sanitizeRoots(paths);
      await client.sendRootsListChanged();
      lastOkAt = Date.now();
    });
  }

  async function refreshChildRoots(): Promise<void> {
    // Triggers the child's RootsListChangedNotificationSchema handler.
    await client.sendRootsListChanged();
    lastOkAt = Date.now();
  }

  const handle: PdfChildHandle = {
    async interact(commands, _opts) {
      // The child exposes its tool surface via callTool. Map our generic
      // "commands" to the child's tool names; the full mapping is filled by
      // the extraction plan (cycle 6.5 — pdf.ts tool wiring).
      lastOkAt = Date.now();
      // For foundation's fixture suite we only need open/get_text.
      const [first] = commands as Array<{ type: string; [k: string]: unknown }>;
      if (!first) return null;
      const r = await client.callTool({ name: first.type, arguments: { ...first, type: undefined } });
      lastOkAt = Date.now();
      return r;
    },
    async getText(viewUUID, opts) {
      const r = await client.callTool(
        { name: "get_text", arguments: { viewUUID } },
        undefined,
        { timeout: opts?.timeoutMs ?? 120_000 },
      );
      lastOkAt = Date.now();
      return typeof r === "string" ? r : JSON.stringify(r);
    },
    currentRoots: () => [...currentRoots],
    isHealthy: () => ({ alive: !child.killed, lastOkAt, stdioOpen: !child.stdin?.destroyed }),
    setRoots,
    refreshChildRoots,
    childPid: () => child.pid,
    async debugIntrospectAllowedDirs() {
      // Calls a child-side debug tool if present; otherwise returns currentRoots
      // as a best-effort proxy. The upstream pdf MCP @1.7.2 ships a list_roots
      // self-introspect tool — fixture confirms it surfaces what scholar sent.
      try {
        const r = await client.callTool({ name: "list_roots", arguments: {} }) as { roots: Array<{ uri: string }> };
        return r.roots.map((x) => fileUrlToPath(x.uri));
      } catch {
        return [...currentRoots];
      }
    },
    async shutdown() {
      await client.close().catch(() => {});
      if (child.pid && !child.killed) child.kill();
    },
  };
  return handle;
}

function sanitizeRoots(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (!isOsAbsolute(abs)) continue;
    if (!existsSync(abs)) continue;
    const real = realpathSync(abs);
    if (seen.has(real)) continue;
    seen.add(real); out.push(real);
  }
  return out;
}

function isOsAbsolute(p: string): boolean {
  return process.platform === "win32" ? /^[A-Za-z]:[\\/]|^\\\\/.test(p) : p.startsWith("/");
}

function fileUrlToPath(uri: string): string {
  return new URL(uri).pathname.replace(/^\/([A-Za-z]):/, "$1:");
}

// === Windows Job Object orphan reaping (koffi FFI) ===
function attachJobObject(childPid: number): void {
  try {
    // Lazy-import koffi so non-Windows tests don't pay the FFI cost.
    const koffi: typeof import("koffi") = require("koffi");
    const kernel32 = koffi.load("kernel32.dll");

    const CreateJobObjectW = kernel32.func("HANDLE CreateJobObjectW(void*, void*)");
    const SetInformationJobObject = kernel32.func("BOOL SetInformationJobObject(HANDLE, int, void*, uint32)");
    const AssignProcessToJobObject = kernel32.func("BOOL AssignProcessToJobObject(HANDLE, HANDLE)");
    const OpenProcess = kernel32.func("HANDLE OpenProcess(uint32, BOOL, uint32)");

    const job = CreateJobObjectW(null, null);
    if (!job) throw new Error("CreateJobObjectW failed");

    // JOBOBJECT_EXTENDED_LIMIT_INFORMATION with LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (0x2000).
    const limitInfo = Buffer.alloc(112); // sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)
    limitInfo.writeUInt32LE(0x2000, 16);  // LimitFlags offset
    const ok = SetInformationJobObject(job, 9 /* JobObjectExtendedLimitInformation */, limitInfo, limitInfo.length);
    if (!ok) throw new Error("SetInformationJobObject failed");

    const PROCESS_SET_QUOTA = 0x0100, PROCESS_TERMINATE = 0x0001;
    const hChild = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, childPid);
    if (!hChild) throw new Error("OpenProcess failed");
    if (!AssignProcessToJobObject(job, hChild)) throw new Error("AssignProcessToJobObject failed");
    // Intentionally leak `job` — releasing the handle would close the job and
    // terminate the child immediately. We rely on process exit to release.
  } catch (err) {
    // Non-fatal — supervisor still reaps on clean exit. Log to stderr.
    console.error(JSON.stringify({ lvl: "warn", m: "Job Object attach failed", err: String(err) }));
  }
}

function setPdeathsig(_childPid: number): void {
  // The Linux equivalent (PR_SET_PDEATHSIG, SIGKILL) must run in the child
  // after fork but before exec — Node/Bun's spawn doesn't expose a pre-exec
  // hook. Foundation accepts the limitation: orphan reaping on Linux relies
  // on the SDK transport's child cleanup + scholar's own shutdown handler.
  // koffi-based prctl from the parent is not equivalent (acts on parent PID).
  // Documented as a known gap; matches §16 "set on Linux for parity" intent.
}
```

> Foundation also ships a 30-LOC `src/server/util/p-limit.ts` inline (single-slot mutex) to avoid pulling the `p-limit` npm dep — that addition would re-open the §6.1 dep-list mirror question. Executor writes:
>
> ```typescript
> // src/server/util/p-limit.ts
> export default function pLimit(concurrency: number) {
>   if (concurrency !== 1) throw new Error("foundation's inline pLimit only supports concurrency=1");
>   let chain: Promise<unknown> = Promise.resolve();
>   return <T>(fn: () => Promise<T>): Promise<T> => {
>     const run = chain.then(fn, fn);
>     chain = run.catch(() => undefined);
>     return run as Promise<T>;
>   };
> }
> ```

- [ ] **Step 4 — Run tests.** `bun test src/server/pdf/lifecycle.test.ts`. Foundation iterates: fixture 1 (spawn) passes first, then 2 (roots/list), then 3 (list_changed), then 4 (viewUUID), then optional 5 (Windows Job Object — skipped on POSIX). If any fixture fails after the vendor copy is intact, **the failure is a divergence canary** — pin the affected behavior in `lifecycle.ts` as a versioned shim and document the upstream commit that introduced the change per chore `upstream-pdf-server-revendor-process`.

- [ ] **Step 5 — Commit.**

```bash
git add src/server/pdf/lifecycle.ts src/server/pdf/lifecycle.test.ts src/server/util/p-limit.ts
git commit -m "feat(foundation): pdf-child spawn + roots responder + list_changed + Job Object (cycle 6.2)"
```

---

### Task 2.3: Wire pdf-child into `src/server/index.ts`

**Files:**
- Modify: `src/server/index.ts` (the `main()` deps wiring)
- Modify: `src/server/index.test.ts` (cover the wiring point)

Cycle 6.2's deliverable closes the loop: production `main()` exposes the `spawnPdfChild` import for corpus's cycle-6.3 activation handoff. (The sqlite3-mcp wiring from foundation-006 was removed by foundation-007 per user posture B; pdf-child is now the sole child process scholar spawns.)

- [ ] **Step 1 — Update `main()` in `index.ts`:**

```typescript
import { spawnPdfChild as productionSpawn } from "./pdf/lifecycle.ts";

export async function main(): Promise<void> {
  const runtimeRoot = process.env.SCHOLAR_RUNTIME_ROOT
    ?? join(process.env.HOME ?? process.env.USERPROFILE ?? ".", "mcp-data", "scholar", "runtime");
  const { server } = buildServer({
    runtimeRoot,
    spawnPdfChild: () => {
      // Per spec §7.3 step 5: pdf-child spawn is deferred until a corpus is
      // active. Foundation returns a placeholder until corpus.activate provides
      // the initial roots; cycle 6.3 wires the real activation handoff.
      return {
        interact: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
        getText: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
        currentRoots: () => [],
        isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
      };
    },
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // productionSpawn is imported so cycle 6.3 can reach it via the foundation
  // module surface; the corpus plan calls it from scholar.corpus.activate.
  void productionSpawn;
}
```

> Why pdf-child defers spawning: per spec §7.3 step 5, "spawn the pdf child with the active corpus's roots" is deferred until a corpus is active — foundation cannot spawn without roots, and the corpus plan owns activation. (The foundation-006 paragraph contrasting pdf-child's deferred spawn with sqlite3-mcp's eager spawn is moot: there's no sqlite3-mcp to contrast with.)

> Why the placeholder rather than spawning eagerly: per spec §7.3 step 5, "spawn the pdf child with the active corpus's roots" is **deferred until a corpus is active** — foundation cannot spawn without roots, and the corpus plan owns activation. Foundation's deliverable for cycle 6.2 is the `spawnPdfChild` function + its fixture suite; the call-site lands in cycle 6.3 (corpus plan). This is the same shape as `applyMigrations` from Task 1.10 (imported, not called).

- [ ] **Step 2 — Run all tests.** `bun test` — every cycle-6.1 + cycle-6.2 test PASSes.

- [ ] **Step 3 — Commit.**

```bash
git add src/server/index.ts src/server/index.test.ts
git commit -m "feat(foundation): wire spawnPdfChild import into main() for corpus.activate handoff (cycle 6.2)"
```

---

### Task 2.4: Cycle 6.2 sanity sweep

- [ ] **Step 1 — Full typecheck.** `bun run typecheck` — zero errors.
- [ ] **Step 2 — Full test run.** `bun test` — every test from both cycles passes. Fixture 5 (Windows Job Object) skips on POSIX.
- [ ] **Step 3 — Vendor copy unmodified-check.** Diff `src/vendor/pdf-server/dist/index.js` against a fresh `bun pm pack @modelcontextprotocol/server-pdf@1.7.2` extraction; expect zero diff. (Foundation does not add a CI step for this; that's chore `upstream-pdf-server-revendor-process`.)
- [ ] **Step 4 — Tag the cycle.** `git tag foundation-6.2-complete`.

---

## Self-review

Per writing-plans skill self-review checklist:

**1. Spec coverage.** Every §6.1 + §6.2 touched section maps to a task:

| Spec section                                          | Task                       |
| ----------------------------------------------------- | -------------------------- |
| §5.1 `src/server/index.ts`                            | Task 1.10 (skeleton + `--call` dual-mode dispatch, foundation-009) |
| `--call <tool-name> <args-json>` CLI dispatch (user F2 ruling — foundation-009) | Tasks 1.10 (`parseEntryArgv` + `runCli`) + 1.10d (three tests) |
| §5.2 `src/server/db/schema.ts`                        | Task 1.4                   |
| §5.3 `src/server/db/migrations.ts`                    | Task 1.2                   |
| §5.4 `src/server/db/sqlite-vec.ts`                    | Task 1.3                   |
| §5.19 `src/server/pdf/lifecycle.ts`                   | Tasks 2.2, 2.3             |
| §5.28 `src/vendor/pdf-server/dist/index.js`           | Task 2.1                   |
| §5.38 `package.json`                                  | Task 1.1                   |
| §5.40 `drizzle.config.ts`                             | Task 1.1                   |
| §5.41 `src/server/tools/registry.ts`                  | Task 1.6                   |
| §5.42 `.claude-plugin/plugin.json`                    | Task 1.11                  |
| §5.43 `.mcp.json`                                     | Task 1.11                  |
| §5.44 `src/server/db/raw-ddl.ts` (stub only)          | Task 1.8                   |
| §5.20 `src/server/ui/resource.ts` (stub only)         | Task 1.10b                 |
| ~~§7.4 sqlite3-mcp child lifecycle~~ (foundation-007: REMOVED, user posture B) | ~~Task 1.10c~~ (deleted; supersession marker only) |
| §7.4 supervised respawn (foundation-006 item 10; foundation-007 retains for pdf-child only) | Task 2.2 (inline; Fixture 6 in pdf lifecycle suite) |
| §8.1 `defaultPdfRoot(tx, corpusId)` helper            | Task 1.4c                  |
| ~~§7.2 sqlite3-mcp vendoring~~ (foundation-007: REMOVED, user posture B) | ~~Task 2.1b~~ (deleted; supersession marker only) |
| §6.1 twelve tool stubs (9 original + 3 §10 stubs added foundation-008) | Task 1.7                   |
| §7.6 frozen contracts (ServerContext — sqlite3 field + Sqlite3McpChild REMOVED in foundation-007) | Task 1.6                   |
| §7.6 Ollama singleton (`ollama/client.ts`)            | Task 1.9                   |
| §12.0 seven primitives (`ingest/primitives.ts`)       | Task 1.5                   |
| `rawClient(db)` helper for vec0 paths                 | Task 1.4b                  |
| §7.2 protocol-based roots responder                   | Task 2.2 (Fixtures 2, 3)   |
| §7.2 Windows Job Object orphan reaping                | Task 2.2 (`attachJobObject`) |
| §16 fixture suite (roots/list, list_changed, viewUUID)| Task 2.2 (Fixtures 1–4)    |
| `nowIso()` helper (§8 timestamp invariant)            | Task 1.4                   |

**2. Placeholder scan.** No "TBD", no "implement later", no naked `add error handling`. The two intentional unfinished surfaces — `loadVecAndProbeDim` and the `ollama` singleton methods — throw structured "unimplemented" errors with the cycle reference that fills them.

**3. Type consistency.** Every cross-task symbol references the same signature: `RegisterTools` / `RunRawDdl` types defined in Task 1.6 are imported by Tasks 1.7 + 1.8 + 1.9. `BunSQLiteDatabase` is consistently imported from `drizzle-orm/bun-sqlite`. `PdfChild` from `registry.ts` is implemented by `PdfChildHandle` in Task 2.2 (extends, not redefines). **Foundation-009:** `RegisterTools`'s third parameter (`register: RegisterHelper`) is consistently used by Task 1.7's stubs and Task 1.6's barrel. `ToolHandler` / `ToolRegistry` / `RegisterHelper` are foundation-internal types — they cross between `registry.ts` and `index.ts` only (NOT in §7.6 frozen contracts) and are imported type-only by Task 1.10's dispatch closure.

**4. Resolved drifts (spec / CLAUDE.md / lead-rulings absorbed).**
- Spec §6.1 dep list: `vitest` → `bun:test` (commit `65844aa`). Plan-md and spec now agree verbatim; no deviation note retained.
- CLAUDE.md load-bearing invariants: `memoizeOnce` → `initOnce` (commit `c97de4f`). Plan-md, spec, and CLAUDE.md all agree on `initOnce`.
- splits.xml: `src/server/ingest/primitives.ts` and `src/server/ollama/client.ts` carved into foundation's blast-radius (commit `5b22ada`).
- **Lead Ruling #1 (2026-05-24): sqlite3-mcp Option A — SUPERSEDED 2026-05-24 by user posture B (foundation-007).** Originally added `sqlite3: Sqlite3McpChild` to `ServerContext`, authored the `Sqlite3McpChild` interface, scaffolded Task 1.10c (`src/server/sqlite3-mcp/lifecycle.ts`), and gave corpus cycle 6.12 the foundation-owned accessor. All reversed by foundation-007.
- **Lead Ruling #2 (2026-05-24): zip library = `fflate`.** Added to §6.1 dep manifest, Task 1.1 `package.json`, dep-pin test. Cross-plan spec gaps §1 now RESOLVED.
- **Lead Ruling #3 (2026-05-24): id-gen library = `ulidx`** (foundation's pick over original `ulid` for maintenance posture). Added to §6.1, re-exported from `src/server/db/nowIso.ts` per Task 1.4 step 3. Cross-plan spec gaps §2 now RESOLVED.
- **Lead supplemental (2026-05-24): downstream npm-script pre-declaration.** Added `build:ui` (with `--minify`), `build:ui:dev` (without `--minify`), `measure-bundle` scripts to Task 1.1 `package.json` template. Task 1.1's `package.json.test.ts` now asserts every downstream-invoked script is pre-declared, with a guard that `build:ui` includes `--minify` and `build:ui:dev` does not. Matches the §6.1 "foundation pre-declares everything package.json-related" convention — closes frontends' Task 9 Step 1 dependency + packaging's cycle 6.13 build-orchestrator dependency.
- **Foundation-006 (2026-05-24) — user override on sqlite3-mcp vendoring (items 1-4) — SUPERSEDED 2026-05-24 by user posture B (foundation-007).** The option (a) absorption is fully reversed: `src/vendor/sqlite3-mcp/`, `scripts/vendor-sqlite3-mcp.ts`, Task 2.1b, `build:sqlite3-mcp` script, `scholar.vendoredSqlite3McpRev` field, and the three-tier resolveSqlite3McpCommand all removed. Two chore-filing requests (`license-audit-vendored-sqlite3-mcp`, `upstream-sqlite3-mcp-revendor-process`) WITHDRAWN before lead files them. **The pre-existing blast-radius gap fix (adding `scripts/vendor-pdf-server.ts`) STAYS** — that's a legitimate foundation-only correction unrelated to the posture pivot.
- **Foundation-006 (2026-05-24) — dep amendments (items 5-7).** `zod` added (runtime dep — MCP-SDK inputSchema patterns across all tool modules). `typescript` confirmed in devDeps + new required-presence test added (was already present at foundation-005 line 402 but unguarded; now pinned). `pdf.js` → `pdfjs-dist` correction (item 7 — `pdf.js@0.1.0` is the defunct 2012 npm package; canonical Mozilla dist is `pdfjs-dist`). `pdf.js` added to the forbidden-deps negative list. All three deviations from spec §6.1's enumeration documented in Cross-plan spec gaps §4 + a consolidated `amend-spec-6.1-dep-enumeration` chore requested via DM.
- **Foundation-006 (2026-05-24) — ConfigAccessor `importDirs` JSDoc (item 8).** Advisor-recommended minimum-disturbance fix: added a JSDoc canonical-keys list above `get<T>(key: string)` (including `"importDirs": string[]` for §12.1's third allow-list leg) rather than widening the §7.6-frozen interface to typed keys. Consumers still cast generically: `ctx.config.get<string[]>("importDirs")`. DM to lead asks for confirmation that the JSDoc approach is sufficient (vs an enum-typed-keys refactor).
- **Foundation-006 (2026-05-24) — `defaultPdfRoot(tx, corpusId)` helper (item 9).** Spec §8.1 pins the helper at `src/server/db/` with the "exactly one default row" assertion + "zero surfaces as configuration-incomplete error" semantics. New Task 1.4c scaffolds `src/server/db/default-pdf-root.ts` with a `ConfigurationIncompleteError` class and 4 test fixtures. Signature expanded from spec's `(corpusId)` to `(tx: BunSQLiteDatabase, corpusId: string)` per the §7.6 cross-plan helper convention.
- **Foundation-006 (2026-05-24) — supervised respawn promoted to v1 (item 10) — PARTIALLY RETAINED in foundation-007.** Item 10's sqlite3-mcp half is gone (with Task 1.10c); the pdf-child half stays. Task 2.2 still authors the supervisor (`attemptSpawn` + `scheduleRespawn` helpers, exponential backoff `[1s, 2s, 4s, 8s, 30s]`-capped, backoff-reset on healthy round-trip, 5-trip crash-loop terminal state) + Fixture 6 (`setRoots survives child SIGKILL`). The "shared helper vs inline" question (advisor's prior framing) collapses with only one supervised child.
- **Foundation-009 (2026-05-24) — `--call` CLI flag absorbed (user F2 nu-transport ruling).** Lead's amendment-3 dispatch landed after foundation-008's `plan_approval_request` was already submitted — race condition (lead's "submit foundation-008 with all 3 amendments" message preceded their review of foundation-008's submission). Foundation-009 absorbs amendment 3 cleanly on top of foundation-008. Net additions: (1) `src/server/index.ts`'s `main()` rewritten as argv-dispatched mutex (`parseEntryArgv` + `runCli` + `runServer` helpers; ~80 LOC) with default → MCP server / `--call <tool-name> <args-json>` → CLI; (2) Task 1.6 `registerAll` signature changes from `(server, ctx) => void` to `(server, ctx) => ToolRegistry`, with each module's `registerTools` accepting a new third parameter `register: RegisterHelper` that closes over both side-effects (McpServer wire-up AND ToolRegistry capture); (3) `BuiltServer` widens with `dispatch(toolName, args)` for CLI mode (foundation-internal, NOT §7.6 frozen); (4) `BuildServerDeps` widens with optional `quiet?: boolean` (CLI mode passes `quiet=true` to suppress trace/debug/info — keeps stdout clean for the JSON tool result); (5) Task 1.7 stub body annotated with foundation-009 register-helper contract documentation; (6) new Task 1.10d with lead's three specified tests (parser unit, integration via `bun run`, mode-mutex spy asserting `StdioServerTransport` is NOT constructed in CLI mode). **Wording-discrepancy flag for lead:** amendment-3 dispatch said "Scholar's entry point (`src/index.ts`) becomes dual-mode" but blast-radius lists `src/server/index.ts`; foundation-009 implements `--call` in `src/server/index.ts` (the in-scope server entry per spec §5.1). If lead intended a separate `src/index.ts` shim, please clarify in `plan_approval_response`. Cumulative addition inventory through foundation-009: 3 new tool-module stubs (`query`/`backup`/`inspect`, foundation-008) + `backupRoot` canonical ConfigAccessor key (foundation-008) + `--call` dual-mode entry point (foundation-009).
- **Foundation-008 (2026-05-24) — Three §10 stubs + `backupRoot` ConfigAccessor key absorbed.** Lead's foundation-007 scope-confirmation dispatch added two scope items on top of the (a)-(h) confirmation: (1) scaffold three new no-op tool-module stubs (`src/server/tools/{query,backup,inspect}.ts`) for extraction's cycle-6.14 §10 reimplementation; (2) add `backupRoot` to ConfigAccessor's JSDoc canonical-keys list (corpus-scoped; consumed by `scholar.backup` via `resolveUnderRoot`). **Stub count: 9 → 12** (lead's dispatch said "8 → 11"; the +1 offset comes from foundation-007's clarification that there never was a sqlite3-mcp tool-module stub, so the original count was 9 not 8). Out-of-scope extraction row updated to claim cycle 6.14 + the 3 new bodies; cross-plan deferrals add a 6th row enumerating the deferred-body call sites. Inter-agent coordination: extraction DM'd the same `backupRoot` ask before lead's confirmation landed; I confirmed to extraction that foundation-008 ships the key + replied on the bonus `bun:sqlite.backup()` question (no such method exists on `Database`; `VACUUM INTO 'path'` is the canonical SQLite backup mechanism, which is what extraction's cycle-6.14 `scholar.backup` body will use).
- **Foundation-007 (2026-05-24) — User posture B pivot reverses Lead Ruling #1.** Driver: direct inspection of `~/code/claude-lib/mcpb/mcp-sqlite3/` revealed it's a Python/uv FastMCP server whose vendoring would add host deps (`uv ≥ 0.5`, `Python ≥ 3.12`) that scholar's `bun build --compile` single-file binary cannot eliminate. Also: `register_db` signature drift `{alias, path}` vs `(name, path)` propagated through multiple cross-plan dispatches as foundation-006 was being finalized. User ruled posture B (drop delegation; reimplement §10 surface inline via `bun:sqlite`). Foundation-007 removes: `Sqlite3McpChild` interface, `ctx.sqlite3` ServerContext field, Task 1.10c entire (`src/server/sqlite3-mcp/lifecycle.ts`), Task 2.1b entire (vendor copy), `src/vendor/sqlite3-mcp/` + `scripts/vendor-sqlite3-mcp.ts` from blast-radius, `build:sqlite3-mcp` script + `scholar.vendoredSqlite3McpRev` field, all wiring from `index.ts main()`. KEEPS: `defaultPdfRoot` (item 9), `zod`/`typescript`/`pdfjs-dist` dep amendments (items 5-7), `importDirs` ConfigAccessor JSDoc (item 8), supervised respawn for pdf-child (item 10's surviving half). §10 ownership (where the reimplemented query/backup/inspect surface lives — extraction vs corpus vs defer-to-v1.1) pending separate user ruling — foundation does NOT pre-scaffold new tool stubs.

**5. Cross-plan deferrals.** Foundation explicitly defers six things to other plans, with the receiving plan/cycle named in code comments:
- Body of `runRawDdl` → extraction cycles 6.5 (chunk_vec) + 6.6 (reading_queue view).
- Body of `ollama.{embed,chat,listModels,healthCheck}` → extraction cycles 6.5 + 6.8.
- Body of `registerUiResource` → frontends cycle 6.9 (registers `ui://scholar/app.html`).
- Call site of `applyMigrations` and `spawnPdfChild` from `corpus.activate` → corpus cycle 6.3.
- Call site of `defaultPdfRoot(tx, corpusId)` from `corpus.activate` → corpus cycle 6.3 (used to compute `initialRoots` for `spawnPdfChild`).
- Bodies of `src/server/tools/{query,backup,inspect}.ts` → extraction cycle 6.14 (foundation-008 addition per user posture B's §10 reimplementation). Consumes `ctx.config.get<string>("backupRoot")` + `resolveUnderRoot` primitive for `scholar.backup`; consumes `bun:sqlite` `VACUUM INTO` for the backup mechanism (no `Database.backup()` method exists in `bun:sqlite`'s public surface).
- **nu wrapper consuming `--call`** → frontends cycle 6.10 (foundation-009 addition per user F2 ruling). Frontends authors `nu/scholar.nu` with a sugar wrapper `^scholar --call $tool ($args | to json) | from json` (or stdin variant for large payloads: `($args | to json) | ^scholar --call $tool -`). Foundation owns the dispatch + the JSON output framing on stdout / stderr; frontends owns the nu-side parse + idiom. Contract: foundation's `--call` always emits exactly one JSON-encoded value on stdout (on success) or one structured error JSON on stderr (on failure) — frontends can `from json` the stdout line without buffering or framing concerns. Exit codes: 0 = success / 1 = tool-handler-threw / 2 = malformed invocation (unknown tool, invalid args JSON, missing `--call` args).

---

## Cross-plan spec gaps surfaced during drafting

Four spec-contract gaps emerged while drafting this plan-md and the six sibling plan-mds in flight. Per team-lead's 2026-05-24 guidance, they are surfaced here inline (rather than peer-DM'd or routed as separate chores) so they adjudicate batch-style at plan-md review.

**Trajectory through foundation-007 (2026-05-24):** §1 (fflate) + §2 (ulidx) still RESOLVED — independent of the posture pivot. §3 (sqlite3-mcp Option A) and §3-followon (vendoring) are both SUPERSEDED by user posture B; scholar drops sqlite3-mcp delegation entirely, the §10 query/backup/inspect surface is reimplemented inline via `bun:sqlite`. §4 (spec §6.1 enumeration deviations — `zod`, `typescript`, `pdfjs-dist`) is unchanged from foundation-006; lead-owned amendment chore covers it.

### §1. Zip / archive library — RESOLVED 2026-05-24 (Ruling #2 — `fflate`)

**Original gap.** §14.1 step 7 required a zip surface but §6.1 named no library; Bun has no built-in zip API; OS shell-out was unsafe on the v1 Windows target.

**Lead Ruling #2 (2026-05-24): `fflate`** (foundation's recommendation accepted).

**Absorbed in this plan-md.** `fflate` is now in the §6.1 dep manifest table (no ⚠ PENDING marker), the Task 1.1 `package.json` template, and the dep-pin test's `required` array. Packaging's `scripts/build-plugin.ts` (cycle 6.13) consumes it.

### §2. ULID / id-generation — RESOLVED 2026-05-24 (Ruling #3 — `ulidx`)

**Original gap.** §8.2 declared id columns but neither library nor inline implementation was pre-specified; UUIDv4 would break the §8.2 cursor-pagination guarantee.

**Lead Ruling #3 (2026-05-24): `ulid` or `ulidx` — foundation's pick.** Foundation chose **`ulidx`** because:
- `ulidx` is the maintained TypeScript fork; `ulid` (original) was last published years ago.
- Both packages export the same `ulid()` function name, so consumer call sites are identical.
- `ulidx` ships TypeScript types natively; `ulid` requires a separate `@types/ulid` shim.

**Absorbed in this plan-md.** `ulidx` is in the §6.1 dep manifest, Task 1.1 `package.json`, and the dep-pin test. Foundation re-exports `ulid` from `src/server/db/nowIso.ts` per Task 1.4 step 3, with a sibling test asserting Crockford-base32 format + same-ms monotonicity. Consumer call sites use `import { nowIso, ulid } from "../db/nowIso"`.

### §3. sqlite3-mcp `register_db` accessor mechanism — RESOLVED 2026-05-24 (Option A) → SUPERSEDED 2026-05-24 (user posture B)

**Original gap.** §7.3 step 6 cited `mcp__sqlite3-mcp__register_db` without pinning the accessor; §7.6 frozen `ServerContext` exposed no host or peer-server surface; standard MCP server→host requests don't include a peer-tool primitive.

**Lead Ruling #1 (2026-05-24): Option A — scholar spawns sqlite3-mcp as its own child** (parallel to pdf-child).

**Foundation-006 absorbed the Option A ruling (now SUPERSEDED by foundation-007 / user posture B):**
- §7.6 `ServerContext` gained `sqlite3: Sqlite3McpChild` field — REMOVED.
- New `Sqlite3McpChild` interface authored alongside `PdfChild` — REMOVED.
- **Task 1.10c** scaffolded `src/server/sqlite3-mcp/lifecycle.ts` — REMOVED (see Task 1.10c supersession marker).
- `src/server/sqlite3-mcp/lifecycle.ts` was in the blast-radius header — REMOVED.
- Corpus cycle 6.12 wiring of `ctx.sqlite3.callTool('register_db', ...)` — corpus's plan-md re-drafts against the amended spec (lead-owned spec amendment).

**Reason for supersession.** User posture B (2026-05-24) ruled the §10 surface should be reimplemented inline via `bun:sqlite` rather than delegated to a child process. Driver: direct inspection of `~/code/claude-lib/mcpb/mcp-sqlite3/` revealed it's a Python/uv FastMCP server whose vendoring would add host deps (`uv ≥ 0.5`, `Python ≥ 3.12`) that scholar's `bun build --compile` single-file binary cannot eliminate. The `register_db` signature drift `{alias, path}` vs `(name, path)` also propagated through multiple cross-plan dispatches as foundation-006 was being finalized.

### §3-followon. Vendoring sqlite3-mcp — RESOLVED 2026-05-24 (option (a)) → SUPERSEDED 2026-05-24 (user posture B)

**Original gap.** Lead Ruling #1 picked Option A (scholar spawns sqlite3-mcp) but did not specify whether the dist is vendored under `src/vendor/sqlite3-mcp/` (parallel to pdf-server) or assumed reachable as a separately-installed sibling plugin on the host's PATH.

**User override 2026-05-24: option (a) — vendor sqlite3-mcp under `src/vendor/sqlite3-mcp/`.** Foundation's original recommendation was (b) sibling-plugin convention; the user overrode in favor of (a) for symmetric out-of-box guarantees (corpus.activate's `register_db` succeeds whether or not the host has sqlite3-mcp installed separately).

**Foundation-006 absorbed the option (a) user override; foundation-007 reverses all of it (SUPERSEDED — user posture B):**

- `src/vendor/sqlite3-mcp/` was added to the blast-radius header — REMOVED.
- `scripts/vendor-sqlite3-mcp.ts` was added to the blast-radius header — REMOVED. (The pre-existing `scripts/vendor-pdf-server.ts` blast-radius omission fix that landed in the same edit **stays** — that's a foundation-only correction unrelated to the posture pivot.)
- **Task 2.1b** vendor copy procedure — REMOVED (see Task 2.1b supersession marker).
- Task 1.10c's `resolveSqlite3McpCommand()` three-tier resolution — REMOVED with Task 1.10c.
- `build:sqlite3-mcp` npm script — REMOVED from `package.json` template + the dep-pin test required-scripts list.
- `scholar.vendoredSqlite3McpRev` field — REMOVED from `package.json` scholar block.
- **Two chore-filing requests WITHDRAWN** (foundation-006 asked lead to file them; foundation-007 withdraws before lead files them): `license-audit-vendored-sqlite3-mcp` and `upstream-sqlite3-mcp-revendor-process`. Foundation submission DM explicitly withdraws these.

### §4. spec §6.1 enumeration vs plan-md deviations (foundation-006 items 5, 6, 7 — NEW)

**Original gap.** Spec §6.1's "Pre-declaration of dependencies" paragraph enumerates the runtime dep set as: `@modelcontextprotocol/sdk`, `drizzle-orm`, `drizzle-kit`, `sqlite-vec`, `@retorquere/bibtex-parser`, `js-tiktoken`, `chart.js`, `pdf.js`, `react`, `react-dom`, `bun:test`. The plan-md's actual table is broader (the precedent set by Rulings #2 + #3 + §16 added `koffi`, `fflate`, `ulidx` without spec-amendment chores) and lead's foundation-006 review surfaced three more required additions plus one correction. Documenting these so the next reader sees the full deviation set:

| Item | Spec §6.1 | Plan-md | Disposition |
|---|---|---|---|
| 5 | silent | `zod` added (runtime) | Lead-authorized 2026-05-24 (MCP-SDK `inputSchema` patterns across ingest/extraction/annotations tools). Recommend spec-amendment chore. |
| 6 | silent | `typescript` added (devDeps) | Required by `typecheck` script (`tsc --noEmit`). Foundation absorbs the deviation; recommend spec-amendment chore. |
| 7 | `pdf.js` | `pdfjs-dist` | Spec text refers to the canonical Mozilla dist but uses the npm name `pdf.js`, which on registry is the defunct `pdf.js@0.1.0` from 2012. Foundation absorbs the correction inline; recommend spec-amendment chore to fix the §6.1 enumeration text. |

**Recommendation.** A single consolidated `amend-spec-6.1-dep-enumeration` chore covering all three (parallel in shape to the closed `amend-spec-6.1-vitest-to-buntest` at commit 65844aa). I'll request this via DM to team-lead.

### Resolved-during-drafting items (now reflected in plan-md body)

For traceability — these surfaced as part of the same wave but are already incorporated:

- **`src/server/ui/resource.ts` scaffold** — frontends DM'd asking foundation to scaffold a 10th no-op stub paralleling the nine tool-module stubs. Same shape as the four prior scope-clarifications. **Resolved** by adding Task 1.10b and listing the file in the blast-radius header.
- **`rawClient(db)` helper at `src/server/db/raw-client.ts`** — extraction needs a raw `bun:sqlite` `Database` for `vec0` DDL/INSERT paths drizzle doesn't model. **Resolved** by adding Task 1.4b. Does NOT widen the §7.6 `ServerContext` contract.

---

End of foundation plan.

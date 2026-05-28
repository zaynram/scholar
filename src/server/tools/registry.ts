// src/server/tools/registry.ts — foundation cycle 6.1 (Task 1.6)
//
// Exports the §7.6 FROZEN cross-plan contracts (verbatim from spec §7.6) plus
// the registerAll barrel that wires every tool stub. Foundation is the SOLE
// writer of this file. Schema/signature changes are foundation-only edits.
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PdfCommand } from "../../vendor/pdf-server/dist/src/commands.js";

// =========================================================================
// FROZEN CROSS-PLAN CONTRACTS (spec §7.6)
// Every interface below is exported type-only and MUST NOT be edited by any
// downstream plan.
// =========================================================================

/**
 * pdf child-process handle. Produced by src/server/pdf/lifecycle.ts (foundation,
 * cycle 6.2); consumed by pdf.ts (extraction) and annotations.ts (annotations).
 *
 * Wire-envelope contract (spec §13 v1.1, 2026-05-27 amendment):
 *   - Vendor exposes ONE tool named "interact" with input shape
 *     {viewUUID, action, ...sibling-fields-per-action}.
 *   - PdfCommand is the vendor's source of truth at
 *     src/vendor/pdf-server/dist/src/commands.d.ts. The spec MAY NOT invent
 *     vendor capabilities (§16 vendor-tool truth invariant).
 *   - lifecycle.ts's interact() translates the discriminated {type, ...rest}
 *     command shape into the vendor's {viewUUID, action: type, ...rest}
 *     callTool argument shape.
 */
export interface PdfChild {
  /**
   * Single-command interact. The viewUUID identifies which open viewer the
   * call targets (vendor requires it as a sibling of `action`). Default
   * timeoutMs = 30_000. AbortSignal and timeoutMs both honoured.
   */
  interact(
    cmd: PdfCommand,
    opts: { viewUUID: string; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<unknown>;
  /**
   * Calls the vendor's `get_text` action via the `interact` tool under the
   * hood. Default timeoutMs = 120_000 (text extraction can be slow on large
   * papers).
   */
  getText(opts: { viewUUID: string; timeoutMs?: number }): Promise<string>;
  /**
   * Opens a PDF in the vendor's interactive viewer by calling the vendor's
   * `display_pdf` tool (which is a separate vendor tool, NOT an `interact`
   * action). Returns the viewUUID that subsequent `interact` calls must
   * carry. `source` is either an absolute local path, a file:// URL, or an
   * HTTPS URL. Consumed by `scholar.pdf.open` to populate
   * `ServerContext.pdfViews`. Default timeoutMs = 30_000.
   */
  displayPdf(source: string, opts?: { timeoutMs?: number }): Promise<{ viewUUID: string }>;
  currentRoots(): string[];
  /**
   * Update the set of file:// roots scholar advertises to the pdf child via
   * the MCP `roots/list_changed` protocol. The pdf child responds to the
   * resulting `roots/list` request with the new set. Used by corpus.activate
   * (to install the active corpus's roots) and by scholar.roots.add/remove
   * (to push live mutations). Implementation lives in src/server/pdf/lifecycle.ts.
   */
  setRoots(roots: string[]): Promise<void>;
  isHealthy(): { alive: boolean; lastOkAt: number | null; stdioOpen: boolean };
}

// Sqlite3McpChild interface — REMOVED 2026-05-24 (foundation-007, user posture B).
// Lead Ruling #1 (Option A — scholar spawns sqlite3-mcp as its own child) is
// SUPERSEDED. The §10 query/backup/inspect surface is re-implemented inline via
// `bun:sqlite` by extraction cycle 6.14.

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
 * corpora table; canonical row type lives in src/server/db/schema.ts (re-exported
 * here type-only to keep §7.6 frozen).
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
  /**
   * Canonical configuration keys (foundation-006 item 8 — JSDoc set rather than
   * typed keys, to preserve the §7.6-frozen `get<T>(string)` shape):
   *   - "importDirs" : string[]    — §12.1 third allow-list leg for ingest scan paths
   *   - "backupRoot" : string      — destination root for `scholar.backup`
   *                                  (foundation-008, per posture B §10 reimpl);
   *                                  corpus-scoped; settable via the corpus tools;
   *                                  consumer pattern: `resolveUnderRoot(backupRoot, args.dest)`
   *                                  (§12.0 primitive rejects path traversal). Reads to
   *                                  undefined surface as a configuration-incomplete error
   *                                  from the backup tool.
   *   - "crossref.mailto" : string  — CrossRef polite-tier `?mailto=` parameter (ingest cycle 6.4)
   *   - "ollama.host" / "ollama.model.embed" / "ollama.model.chat"
   *   - "scholar.askClaudeEnabled" — per-request opt-in default for cowork.askClaude
   *   - "ui.theme" / "ui.lastView"
   * Consumers cast generically: `ctx.config.get<string[]>("importDirs")`. Adding
   * a new key requires only documenting it here — no interface change.
   */
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  corpora(): CorpusRow[];
  activeCorpusId(): string | undefined;
}

/** The context every tool module receives. */
export interface ServerContext {
  /**
   * Active per-corpus Drizzle db; undefined until a corpus is active.
   * SNAPSHOT-AT-ENTRY rule: tool handlers must snapshot into a local on the
   * first line and read from that local for the rest of the call. corpus.activate
   * mutates this field in place.
   */
  db: BunSQLiteDatabase | undefined;
  configDb: BunSQLiteDatabase;
  pdf: PdfChild;
  /**
   * Process-local paper_id → viewUUID map (spec §7.6 + §13 v1.1, 2026-05-27).
   * Populated by `scholar.pdf.open(paper_id, source)` after the vendor's
   * `display_pdf` returns a viewUUID; consumed by `scholar.annotations.{upsert,delete}`
   * and `scholar.pdf.refresh-extraction` to resolve viewUUID for outbound
   * `interact` calls. Not persisted across scholar restart. A pdf-child crash +
   * supervisor respawn (§5.19) renders cached entries stale; v1 surfaces the
   * resulting vendor error on the next interact call (the user re-opens to
   * refresh the entry).
   */
  pdfViews: Map<string, string>;
  // sqlite3 field — REMOVED 2026-05-24 (foundation-007, user posture B). The §10
  // surface is reimplemented inline via bun:sqlite by extraction cycle 6.14.
  config: ConfigAccessor;
  log: Logger;
  /** Closes over the entry snapshot and passes it to fn. Prefer this in new handlers. */
  withCorpus<T>(fn: (db: BunSQLiteDatabase) => Promise<T> | T): Promise<T>;
}

// =========================================================================
// FOUNDATION-INTERNAL TYPES (NOT §7.6 frozen)
// ToolHandler / ToolRegistry / RegisterHelper exist to support the --call CLI
// mode added in foundation-009. Downstream plans should NOT import these;
// they import RegisterTools and call the helper passed to them.
// =========================================================================

export type ToolHandler = (args: unknown, ctx: ServerContext) => Promise<unknown>;
export type ToolRegistry = Map<string, ToolHandler>;

export type RegisterHelper = (
  name: string,
  def: { description: string; inputSchema: unknown },
  handler: ToolHandler,
) => void;

/** Frozen tool-registration signature. Every tool module exports this. */
export type RegisterTools = (server: McpServer, ctx: ServerContext, register: RegisterHelper) => void;

/**
 * Frozen raw-DDL hook. raw-ddl.ts exports this; migrations.ts calls it
 * immediately after Drizzle migrations at corpus open (§7.3 step 4).
 */
export type RunRawDdl = (db: BunSQLiteDatabase) => void;

// =========================================================================
// BARREL — statically imports every tool stub. Downstream plans fill the
// bodies of the imported stubs; nobody edits this file.
// =========================================================================

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
  // Foundation-009: `register` helper closes over both side-effects — McpServer
  // wire-up for stdio mode, and ToolRegistry capture for CLI (`--call`) mode dispatch.
  const register: RegisterHelper = (name, def, handler) => {
    registry.set(name, handler);
    // `server.registerTool(name, def, handler-wrapper)` — the wrapper applies ctx
    // closure so the MCP-side handler signature matches SDK expectations. The
    // ToolRegistry-side handler is invoked directly from CLI mode with `args, ctx`.
    (server as unknown as {
      registerTool: (n: string, d: unknown, h: (args: unknown) => Promise<unknown>) => void;
    }).registerTool(name, def, async (args: unknown) => {
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

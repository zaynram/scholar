// src/server/index.ts — foundation cycle 6.1 (Task 1.10 + foundation-009 dual-mode dispatcher)
//
// The McpServer construction skeleton + ServerContext assembly. CLI mode
// (`--call <tool-name> <args-json>`) reuses buildServer() — no context fork.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";
import {
  registerAll,
  type PdfChild,
  type ServerContext,
  type ConfigAccessor,
  type CorpusRow,
  type Logger,
  type ToolRegistry,
} from "./tools/registry.ts";
import { registerUiResource } from "./ui/resource.ts";
import { reopenPersistedCorpus, resolveRuntimeRoot } from "./tools/corpus.ts";
import { acquireSessionLock } from "./session-lock.ts";
import { openWithPragmas, applyMigrations } from "./db/migrations.ts";
import {
  spawnPdfChild as productionSpawnPdfChild,
  type SpawnOpts,
  type PdfChildHandle,
} from "./pdf/lifecycle.ts";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Re-export of the production pdf-child spawner so cycle 6.3 (corpus plan)
 * can import it from the foundation module surface. Foundation does NOT call
 * this during `main()` — pdf-child spawn is deferred per spec §7.3 step 5
 * (must wait for an active corpus's roots; corpus.activate is the call site).
 */
export const spawnPdfChild = productionSpawnPdfChild;

/**
 * Bug #3 fix (2026-06-03 — first real smoke test). Bridge the production pdf-child
 * spawner into buildServer.
 *
 * `buildServer` consumes a *synchronous* `() => PdfChild` factory, but the
 * production spawner (`pdf/lifecycle.ts`) is `async (opts) => Promise<PdfChildHandle>`
 * — signature-incompatible, which is why no entry point ever wired it and ctx.pdf
 * was always the throwing stub. This awaits the async spawn once, then returns a
 * sync closure yielding the resolved handle (`PdfChildHandle` structurally extends
 * `PdfChild`, so the closure satisfies `deps.spawnPdfChild`).
 *
 * Two failure modes are made non-fatal so a broken pdf child never takes down the
 * corpus / search / digest surfaces:
 *   - spawn throws (entrypoint missing, bun fails) → degrade to stub + warn.
 *   - spawn hangs on the MCP handshake → `client.connect` would block scholar's
 *     own `initialize`, so the host sees scholar fail to start with no reason. We
 *     bound it with `timeoutMs` and degrade on timeout. The abandoned spawn promise
 *     may leak its child process — accepted: that path is already the failure case
 *     and no handle exists to shut it down.
 *
 * Degrade-to-stub is intentionally *visible*, not silent (the stub's
 * PDF_CHILD_UNAVAILABLE is otherwise indistinguishable from "#3 never landed"):
 * `scholar.corpus.status.pdf_child` surfaces `isHealthy()` as the operator-facing
 * real-child (`alive:true`) vs stub (`alive:false`) discriminator.
 */
export async function resolvePdfSpawnFactory(
  spawn: (opts: SpawnOpts) => Promise<PdfChild> = productionSpawnPdfChild,
  timeoutMs = 15_000,
): Promise<(() => PdfChild) | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const handle = await Promise.race([
      spawn({ initialRoots: [] }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`pdf child spawn timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return () => handle;
  } catch (err) {
    console.error(
      JSON.stringify({
        lvl: "warn",
        m: "pdf child spawn failed; degrading to stub (pdf features unavailable — check scholar.corpus.status.pdf_child)",
        err: String(err),
      }),
    );
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface BuildServerDeps {
  runtimeRoot: string;
  openConfigDb?: (path: string) => BunSQLiteDatabase;
  spawnPdfChild?: () => PdfChild;
  /**
   * Foundation-009: pass `{ quiet: true }` to drop log level to warn (CLI mode
   * keeps stdout clean for the JSON tool result).
   */
  quiet?: boolean;
}

export interface BuiltServer {
  server: McpServer;
  ctx: ServerContext;
  /**
   * Foundation-009 (NOT §7.6 frozen — foundation-internal): dispatch a tool by
   * name without round-tripping through the stdio MCP transport. Used by CLI
   * mode (`--call`). Throws if the tool is unknown; rethrows tool handler errors
   * unchanged so the caller can convert to structured exit codes.
   */
  dispatch: (toolName: string, args: unknown) => Promise<unknown>;
}

function makeStdoutLogger(quiet: boolean): Logger {
  // All log lines go to stderr (stdout is reserved for the CLI mode tool result).
  const log = (lvl: string, m: string, f?: Record<string, unknown>) =>
    console.error(JSON.stringify({ lvl, m, ...f }));
  if (quiet) {
    return {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: (m, f) => log("warn", m, f),
      error: (m, f) => log("error", m, f),
    };
  }
  return {
    trace: (m, f) => log("trace", m, f),
    debug: (m, f) => log("debug", m, f),
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
  };
}

function buildConfigAccessor(configDb: BunSQLiteDatabase): ConfigAccessor {
  // Foundation-owned implementation (filled by chore foundation-fill-corpus-prereqs
  // 2026-05-25). Reads/writes the `settings` table for typed key-value config
  // and the `corpora` table for the canonical corpus list. The activeCorpusId
  // read-path comes from the settings table (key='activeCorpusId'); corpus.activate
  // is responsible for keeping the settings row in sync with runtime/config.json
  // (the DB UPDATE is the durable point per spec §7.3; config.json is a
  // denormalized cache used at startup before the active corpus DB is opened).
  return {
    get<T>(key: string): T | undefined {
      const row = configDb.all(
        sql`SELECT value FROM settings WHERE key = ${key}`,
      ) as { value: string }[];
      if (row.length === 0) return undefined;
      return JSON.parse(row[0]!.value) as T;
    },
    set(key: string, value: unknown): void {
      const serialized = JSON.stringify(value);
      configDb.run(
        sql`INSERT INTO settings (key, value) VALUES (${key}, ${serialized})
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );
    },
    corpora(): CorpusRow[] {
      return configDb.all(
        sql`SELECT id, display_name, archived_at, last_opened_at, created_at
            FROM corpora ORDER BY created_at ASC`,
      ) as CorpusRow[];
    },
    activeCorpusId(): string | undefined {
      const row = configDb.all(
        sql`SELECT value FROM settings WHERE key = 'activeCorpusId'`,
      ) as { value: string }[];
      if (row.length === 0) return undefined;
      const parsed = JSON.parse(row[0]!.value) as string | null;
      return parsed ?? undefined;
    },
  };
}

export function buildServer(deps: BuildServerDeps): BuiltServer {
  const configDbPath = join(deps.runtimeRoot, "dbs", "scholar-config.db");
  const openCfg = deps.openConfigDb ?? openWithPragmas;
  // Ensure the dbs/ parent exists when the default opener is used. Test-harness
  // overrides supply their own openConfigDb and skip this branch implicitly via
  // the fact that they don't touch the filesystem.
  if (!deps.openConfigDb) {
    mkdirSync(dirname(configDbPath), { recursive: true });
  }
  const configDb = openCfg(configDbPath);
  // Migrate the config DB so the corpora / pdf_roots / settings tables exist.
  // Symmetric with how corpus.ts migrates each per-corpus DB (applyMigrations).
  // Guarded to the default opener: test-harness overrides inject a config DB
  // they have already migrated (or intend to leave bare), so we must not run
  // migrations on an injected handle. runRawDdl is config-DB-safe here — it
  // creates only the reading_queue view (papers exists in every migrated DB)
  // and skips chunk_vec while embed.dim is unset, so no vec0 load is needed.
  if (!deps.openConfigDb) {
    applyMigrations(configDb);
  }

  // Stub pdf so foundation can construct ServerContext before cycle 6.2 lands
  // the real spawn lifecycle. Production uses deps.spawnPdfChild (set by
  // cycle 6.2's main()).
  const pdf: PdfChild = deps.spawnPdfChild?.() ?? {
    interact: async () => {
      throw new Error("PDF_CHILD_UNAVAILABLE");
    },
    getText: async () => {
      throw new Error("PDF_CHILD_UNAVAILABLE");
    },
    displayPdf: async () => {
      throw new Error("PDF_CHILD_UNAVAILABLE");
    },
    currentRoots: () => [],
    setRoots: async () => {
      throw new Error("PDF_CHILD_UNAVAILABLE");
    },
    isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
  };

  const ctx: ServerContext = {
    db: undefined,
    configDb,
    pdf,
    // §13 v1.1: process-local paper_id → viewUUID map. Populated by
    // scholar.pdf.open; consumed by annotations.{upsert,delete} and
    // pdf.refresh-extraction. Never persisted (in-memory only).
    pdfViews: new Map<string, string>(),
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
  registerUiResource(server, ctx); // ← scaffolded stub in Task 1.10b; filled by frontends cycle 6.9

  // Foundation-009: dispatch closure for CLI mode. Same ServerContext as stdio mode.
  const dispatch = async (toolName: string, args: unknown): Promise<unknown> => {
    const handler = registry.get(toolName);
    if (!handler) {
      const err = new Error(`unknown_tool: ${toolName}`) as Error & {
        errorCode: string;
        tool: string;
      };
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
// ====================================================================

export interface ParsedArgv {
  mode: "server" | "cli";
  toolName?: string;
  argsSource?: string; // raw JSON string (or "-" for stdin)
}

/**
 * Parse argv into (mode, optional tool name, optional args source).
 *   - `--call <tool-name> <args-json>` → CLI mode.
 *   - `--call <tool-name> -` → CLI mode, args from stdin.
 *   - anything else → server mode.
 * Parser is pure: malformed `--call` does not exit here. main() surfaces it
 * as exit 2 with a structured `invalid_args` error on stderr.
 */
export function parseEntryArgv(argv: string[]): ParsedArgv {
  const idx = argv.indexOf("--call");
  if (idx === -1) return { mode: "server" };
  const rest = argv.slice(idx + 1);
  if (rest.length < 2) {
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

/**
 * F1 fix (2026-06-04). Build the one-shot teardown wired to every server exit
 * path (stdin EOF, SIGINT, SIGTERM). It (1) reaps the pdf child, (2) releases the
 * session lock, (3) exits — in that order, idempotently across the multiple paths
 * that may fire (e.g. host SIGTERM arriving after stdin 'end').
 *
 * Why this exists: `StdioServerTransport` registers only 'data'/'error' on stdin
 * (no 'end' handler), and the live pdf child keeps the event loop alive, so the
 * server never self-exits on stdin EOF (verified: `bun run index.ts < /dev/null`
 * hung). The host then falls back to its stdin.end()→2s→SIGTERM→2s→SIGKILL ladder
 * (SDK client/stdio.js) — a dead ~2s wait on every session close — and on Linux
 * the pdf child is orphaned (lifecycle.ts:388 names a "scholar's own shutdown
 * handler" that did not exist; PR_SET_PDEATHSIG is unavailable, Job Object is
 * win32-only). This is that handler.
 *
 * Why a direct pid signal, not `handle.shutdown()`: the pdf child runs the SAME
 * transport and also hangs on its own stdin EOF, so shutdown()→client.close()
 * would re-incur the ~2s ladder against the child. On a host-driven teardown
 * there is nothing to flush, so a direct SIGTERM is correct and instant; the
 * kernel reaps the child regardless of scholar's state.
 *
 * Exported (NOT §7.6 — entry-point internal) so the reap+release+exit+idempotency
 * logic is unit-tested via injected kill/exit; the live EOF→exit wiring (runServer
 * binds a real transport, un-drivable in-process) is proven by a real-artifact run.
 */
export function makeServerTeardown(opts: {
  releaseLock: () => void;
  pdfChildPid: () => number | undefined;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  exit?: (code: number) => void;
}): (code: number) => void {
  const kill = opts.kill ?? ((pid, signal) => process.kill(pid, signal));
  const exit = opts.exit ?? ((code) => process.exit(code));
  let done = false;
  return (code: number) => {
    if (done) return; // a second exit path (e.g. SIGTERM after 'end') is a no-op
    done = true;
    const pid = opts.pdfChildPid();
    if (typeof pid === "number" && pid > 0) {
      try {
        kill(pid, "SIGTERM"); // instant; child has no SIGTERM handler → default-terminates
      } catch {
        /* already gone (ESRCH) / not ours — teardown must still proceed */
      }
    }
    opts.releaseLock();
    exit(code);
  };
}

async function runServer(runtimeRoot: string): Promise<void> {
  // Single-active-session guard (INV-1). Server-only: runCli is intentionally
  // lock-free (`--call` is single-shot; Bug #2b runs many concurrent processes).
  // Throws errorCode "SCHOLAR_LOCKED" if a live server already holds this root;
  // main() catches it and emits a structured line + exit 1.
  const releaseLock = acquireSessionLock(runtimeRoot);

  // Bug #3 fix: spawn the real pdf child and hand the resolved handle to
  // buildServer (degrades to the stub + warn on spawn failure/timeout). CLI mode
  // (runCli) intentionally stays on the stub — `--call` is single-shot and
  // stateless, so spawning a child per call would be wasteful and pdf features
  // are a long-lived-session concern. Materialize the handle here (not only inside
  // buildServer) so teardown can reap the child by pid.
  const spawnPdf = await resolvePdfSpawnFactory();
  const pdfChild = spawnPdf?.();
  const { server } = buildServer({
    runtimeRoot,
    spawnPdfChild: pdfChild ? () => pdfChild : undefined,
  });

  // F1 fix (2026-06-04): graceful teardown on every exit path. Without this the
  // server hangs on stdin EOF (StdioServerTransport has no 'end' handler; the pdf
  // child keeps the loop alive), forcing the host's dead ~2s wait + SIGTERM and
  // orphaning the pdf child on Linux. See makeServerTeardown for the full root
  // cause. Wiring stdin EOF here also makes the INV-1 lock release independent of
  // any signal arriving from the host.
  //
  // Registered BEFORE connect(): connect()→transport.start() adds the stdin 'data'
  // listener that puts stdin into flowing mode. If stdin is already at EOF (e.g.
  // host closed it before we subscribed), the 'end'/'close' events would fire as
  // soon as it flows — subscribing first guarantees we never miss them. A bare
  // 'end' listener does not itself drain the stream; the transport's 'data'
  // listener is what drives it to EOF.
  const teardown = makeServerTeardown({
    releaseLock,
    // pdfChild is a PdfChildHandle when the real spawner ran (childPid present);
    // the stub/degraded path has no childPid → nothing to reap.
    pdfChildPid: () => (pdfChild as Partial<PdfChildHandle> | undefined)?.childPid?.(),
  });
  // 'exit' is the sync backstop for any OTHER exit (uncaught throw, hard crash):
  // it can only release the lock (reaping/async is not reliable inside 'exit').
  process.on("exit", releaseLock);
  process.once("SIGINT", () => teardown(0));
  process.once("SIGTERM", () => teardown(0));
  process.stdin.once("end", () => teardown(0));
  process.stdin.once("close", () => teardown(0));

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function runCli(
  runtimeRoot: string,
  toolName: string | undefined,
  argsSource: string | undefined,
): Promise<number> {
  if (!toolName || argsSource === undefined) {
    process.stderr.write(
      JSON.stringify({
        error: "invalid_args",
        message: "--call requires <tool-name> <args-json>; pass `-` as args-json to read from stdin",
      }) + "\n",
    );
    return 2;
  }
  let args: unknown;
  try {
    args = await readArgsJson(argsSource);
  } catch (e) {
    const err = e as { errorCode?: string; message?: string };
    process.stderr.write(
      JSON.stringify({ error: err.errorCode ?? "invalid_args_json", message: err.message }) + "\n",
    );
    return 2;
  }
  const built = buildServer({ runtimeRoot, quiet: true }); // quiet=true for CLI mode
  // Bug #2b: a fresh `--call` process has ctx.db === undefined (corpus.activate is the
  // only path that opens it, and the CLI never calls it). Re-open the persisted active
  // corpus so active-corpus tools (papers.search/ingest/digest) work instead of throwing
  // NO_ACTIVE_CORPUS. No-op when no corpus is persisted; stays on the pdf stub by design.
  reopenPersistedCorpus(built.ctx, runtimeRoot);
  try {
    const result = await built.dispatch(toolName, args);
    process.stdout.write(JSON.stringify(result) + "\n");
    return 0;
  } catch (e) {
    const err = e as {
      errorCode?: string;
      message?: string;
      details?: unknown;
      tool?: string;
    };
    if (err.errorCode === "unknown_tool") {
      process.stderr.write(
        JSON.stringify({ error: "unknown_tool", tool: err.tool ?? toolName }) + "\n",
      );
      return 2;
    }
    process.stderr.write(
      JSON.stringify({
        error: err.errorCode ?? "tool_error",
        message: err.message ?? String(e),
        details: err.details,
      }) + "\n",
    );
    return 1;
  }
}

/** Entry point for the compiled binary (bun build --compile) and `bun run`. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  // Single source of truth (INV-3): delegate to the same resolver the corpus
  // handlers use, so the config DB (buildServer deps.runtimeRoot) and the corpus
  // DBs (handlers via resolveRuntimeRoot) can never resolve to different roots.
  // The previous inline computation was byte-identical but a second, drift-prone
  // source.
  const runtimeRoot = resolveRuntimeRoot();
  const parsed = parseEntryArgv(argv);
  if (parsed.mode === "cli") {
    return await runCli(runtimeRoot, parsed.toolName, parsed.argsSource);
  }
  try {
    await runServer(runtimeRoot);
    return 0; // unreachable in normal flow (server runs until transport closes)
  } catch (e) {
    const err = e as { errorCode?: string; message?: string };
    if (err.errorCode === "SCHOLAR_LOCKED") {
      process.stderr.write(JSON.stringify({ error: "SCHOLAR_LOCKED", message: err.message }) + "\n");
      return 1;
    }
    throw e;
  }
}

if (import.meta.main) {
  main()
    .then((code) => {
      if (code !== 0) process.exit(code);
    })
    .catch((err) => {
      console.error(JSON.stringify({ lvl: "fatal", m: "scholar startup failed", err: String(err) }));
      process.exit(1);
    });
}

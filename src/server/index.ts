// src/server/index.ts — foundation cycle 6.1 (Task 1.10 + foundation-009 dual-mode dispatcher)
//
// The McpServer construction skeleton + ServerContext assembly. CLI mode
// (`--call <tool-name> <args-json>`) reuses buildServer() — no context fork.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import {
  registerAll,
  type PdfChild,
  type ServerContext,
  type ConfigAccessor,
  type Logger,
  type ToolRegistry,
} from "./tools/registry.ts";
import { registerUiResource } from "./ui/resource.ts";
import { openWithPragmas } from "./db/migrations.ts";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

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
  // Ensure the dbs/ parent exists when the default opener is used. Test-harness
  // overrides supply their own openConfigDb and skip this branch implicitly via
  // the fact that they don't touch the filesystem.
  if (!deps.openConfigDb) {
    mkdirSync(dirname(configDbPath), { recursive: true });
  }
  const configDb = openCfg(configDbPath);

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
    currentRoots: () => [],
    isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
  };

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
  registerUiResource(server); // ← scaffolded stub in Task 1.10b; filled by frontends cycle 6.9

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

async function runServer(runtimeRoot: string): Promise<void> {
  const { server } = buildServer({ runtimeRoot });
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
  const runtimeRoot =
    process.env.SCHOLAR_RUNTIME_ROOT ??
    join(process.env.HOME ?? process.env.USERPROFILE ?? ".", "mcp-data", "scholar", "runtime");
  const parsed = parseEntryArgv(argv);
  if (parsed.mode === "cli") {
    return await runCli(runtimeRoot, parsed.toolName, parsed.argsSource);
  }
  await runServer(runtimeRoot);
  return 0; // unreachable in normal flow (server runs until transport closes)
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

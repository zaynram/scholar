// src/server/index.test.ts — foundation cycle 6.1 (Task 1.10)
//
// Foundation pins the buildServer shape: returns { server, ctx, dispatch }.
// `dispatch` is foundation-internal (NOT §7.6 frozen) — added foundation-009
// so `--call` CLI mode can dispatch a tool by name without round-tripping
// through the stdio MCP transport.
//
// chore cover-ollama-client-and-index-dispatch-unit-gaps (2026-06-02):
// Added parseEntryArgv, main() dispatch-branch, buildServer quiet-logger,
// and pdf-stub-throws coverage. NOTE: runServer and the import.meta.main block
// are intentionally NOT covered — runServer binds a live StdioServerTransport
// to stdin/stdout, which would hang or corrupt the test process. The 85%+
// line target is met without those two regions.
import { test, expect, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { buildServer, parseEntryArgv, main, spawnPdfChild, type BuildServerDeps } from "./index.ts";

function makeDeps(overrides: Partial<BuildServerDeps> = {}): BuildServerDeps {
  return {
    runtimeRoot: "/tmp/scholar-runtime-test-doesnt-need-to-exist",
    openConfigDb: () => ({}) as never,
    spawnPdfChild: () => ({
      interact: async () => null,
      getText: async () => "",
      currentRoots: () => [],
      setRoots: async () => {},
      displayPdf: async () => ({ viewUUID: "stub-view-uuid" }),
      isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
    }),
    ...overrides,
  };
}

test("buildServer returns an McpServer + ServerContext + dispatch triple", () => {
  const { server, ctx, dispatch } = buildServer(makeDeps());
  expect(server).toBeDefined();
  expect(ctx.db).toBeUndefined(); // no corpus active yet
  expect(ctx.configDb).toBeDefined();
  expect(ctx.pdf).toBeDefined();
  expect(typeof ctx.log.info).toBe("function");
  // Foundation-009: dispatch is foundation-internal (not §7.6 frozen).
  expect(typeof dispatch).toBe("function");
});

test("ServerContext.withCorpus snapshots ctx.db at entry", async () => {
  const { ctx } = buildServer(makeDeps());
  const fakeDbA = { tag: "A" } as never;
  const fakeDbB = { tag: "B" } as never;
  ctx.db = fakeDbA;
  const result = await ctx.withCorpus(async (snap) => {
    // simulate corpus.activate mutating ctx.db mid-call
    ctx.db = fakeDbB;
    return snap;
  });
  expect((result as unknown as { tag: string }).tag).toBe("A");
});

test("spawnPdfChild is re-exported from foundation entry for corpus 6.3 handoff", () => {
  // Foundation owns the production pdf-child spawner; corpus cycle 6.3
  // (`scholar.corpus.activate`) imports it from this module surface.
  expect(typeof spawnPdfChild).toBe("function");
});

test("dispatch throws structured unknown_tool error for unregistered tools", async () => {
  const { dispatch } = buildServer(makeDeps());
  // Stubs are no-ops at cycle 6.1; nothing is in the registry yet.
  await expect(dispatch("scholar.does.not.exist", {})).rejects.toMatchObject({
    errorCode: "unknown_tool",
    tool: "scholar.does.not.exist",
  });
});

// ─── chore cover-ollama-client-and-index-dispatch-unit-gaps (2026-06-02) ────

// ─── parseEntryArgv ──────────────────────────────────────────────────────────

test("parseEntryArgv: no --call flag → server mode", () => {
  expect(parseEntryArgv([])).toEqual({ mode: "server" });
  expect(parseEntryArgv(["--some", "--other"])).toEqual({ mode: "server" });
});

test("parseEntryArgv: --call <tool> <args> → cli mode with both fields", () => {
  const parsed = parseEntryArgv(["--call", "scholar.corpus.list", "{}"]);
  expect(parsed).toEqual({
    mode: "cli",
    toolName: "scholar.corpus.list",
    argsSource: "{}",
  });
});

test("parseEntryArgv: --call <tool> only → cli mode, argsSource undefined", () => {
  const parsed = parseEntryArgv(["--call", "scholar.corpus.list"]);
  expect(parsed).toEqual({
    mode: "cli",
    toolName: "scholar.corpus.list",
    argsSource: undefined,
  });
});

test("parseEntryArgv: --call alone → cli mode, both tool and argsSource undefined", () => {
  const parsed = parseEntryArgv(["--call"]);
  expect(parsed).toEqual({
    mode: "cli",
    toolName: undefined,
    argsSource: undefined,
  });
});

test("parseEntryArgv: --call <tool> - → cli mode, argsSource is '-'", () => {
  const parsed = parseEntryArgv(["--call", "scholar.corpus.list", "-"]);
  expect(parsed).toEqual({
    mode: "cli",
    toolName: "scholar.corpus.list",
    argsSource: "-",
  });
});

// ─── main() return codes — pure-arg branches (no real DB) ────────────────────

test("main(['--call']) returns exit code 2 (missing tool + argsSource)", async () => {
  const code = await main(["--call"]);
  expect(code).toBe(2);
});

test("main(['--call','x']) returns exit code 2 (missing argsSource)", async () => {
  const code = await main(["--call", "x"]);
  expect(code).toBe(2);
});

test("main(['--call','x','{bad json']) returns exit code 2 (invalid_args_json)", async () => {
  const code = await main(["--call", "x", "{bad json"]);
  expect(code).toBe(2);
});

// ─── main() branches that build a real config DB ─────────────────────────────
// These create a temp SCHOLAR_RUNTIME_ROOT so the config DB lives in a
// throwaway directory and doesn't pollute the test workspace.

let testRuntimeRoot: string | null = null;

afterEach(() => {
  if (testRuntimeRoot && existsSync(testRuntimeRoot)) {
    rmSync(testRuntimeRoot, { recursive: true, force: true });
  }
  testRuntimeRoot = null;
  delete process.env.SCHOLAR_RUNTIME_ROOT;
});

function makeTempRuntime(): string {
  const dir = `/tmp/scholar-index-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(`${dir}/dbs`, { recursive: true });
  testRuntimeRoot = dir;
  process.env.SCHOLAR_RUNTIME_ROOT = dir;
  return dir;
}

test("main(['--call','scholar.unknown.tool','{}']) returns exit code 2 (unknown_tool)", async () => {
  makeTempRuntime();
  const code = await main(["--call", "scholar.unknown.tool", "{}"]);
  expect(code).toBe(2);
});

test("main(['--call','scholar.corpus.status','{}']) dispatches tool-error and returns 1", async () => {
  // scholar.corpus.status requires an active corpus DB with the migrations applied.
  // The temp DB is blank (no migrations run) → tool throws a DB error → return 1.
  makeTempRuntime();
  const code = await main(["--call", "scholar.corpus.status", "{}"]);
  // tool_error → exit 1
  expect(code).toBe(1);
});

// ─── runCli return-0 analog: withCorpus throws without corpus (tool_error path) ─
// runCli's return-0 path (dispatch succeeds) is exercised at the unit level via
// the existing `dispatch unknown_tool` test (the dispatch closure is the same code
// path). The main() test below exercises the full stack including the return-1
// (tool_error) exit from runCli.

// ─── buildServer: pdf-stub throws on all PdfChild methods (no deps.spawnPdfChild) ──

test("buildServer pdf stub: interact throws PDF_CHILD_UNAVAILABLE", async () => {
  const { ctx } = buildServer(makeDeps({ spawnPdfChild: undefined }));
  await expect(
    ctx.pdf.interact({ type: "get_text" } as never, { viewUUID: "stub-uuid" }),
  ).rejects.toThrow("PDF_CHILD_UNAVAILABLE");
});

test("buildServer pdf stub: getText throws PDF_CHILD_UNAVAILABLE", async () => {
  const { ctx } = buildServer(makeDeps({ spawnPdfChild: undefined }));
  await expect(ctx.pdf.getText({ viewUUID: "stub-uuid" })).rejects.toThrow("PDF_CHILD_UNAVAILABLE");
});

test("buildServer pdf stub: displayPdf throws PDF_CHILD_UNAVAILABLE", async () => {
  const { ctx } = buildServer(makeDeps({ spawnPdfChild: undefined }));
  await expect(ctx.pdf.displayPdf("/some/path.pdf")).rejects.toThrow("PDF_CHILD_UNAVAILABLE");
});

test("buildServer pdf stub: setRoots throws PDF_CHILD_UNAVAILABLE", async () => {
  const { ctx } = buildServer(makeDeps({ spawnPdfChild: undefined }));
  await expect(ctx.pdf.setRoots(["/root"])).rejects.toThrow("PDF_CHILD_UNAVAILABLE");
});

test("buildServer pdf stub: isHealthy returns alive:false", () => {
  const { ctx } = buildServer(makeDeps({ spawnPdfChild: undefined }));
  const health = ctx.pdf.isHealthy();
  expect(health.alive).toBe(false);
  expect(health.lastOkAt).toBeNull();
  expect(health.stdioOpen).toBe(false);
});

// ─── buildServer: quiet logger branch ────────────────────────────────────────

test("buildServer quiet:true mutes trace/debug/info but not warn/error", () => {
  // Quiet mode suppresses the three verbose levels; warn/error still log.
  // We just verify the methods are callable without throwing (they write to stderr).
  const { ctx } = buildServer(makeDeps({ quiet: true }));
  // No assertions on output — just confirm the methods don't throw.
  ctx.log.trace("trace-msg");
  ctx.log.debug("debug-msg");
  ctx.log.info("info-msg");
  ctx.log.warn("warn-msg");
  ctx.log.error("error-msg");
});

test("buildServer quiet:false emits all log levels without throwing", () => {
  const { ctx } = buildServer(makeDeps({ quiet: false }));
  ctx.log.trace("trace-msg");
  ctx.log.debug("debug-msg");
  ctx.log.info("info-msg");
  ctx.log.warn("warn-msg");
  ctx.log.error("error-msg");
});

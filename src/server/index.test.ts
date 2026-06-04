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
import {
  buildServer,
  parseEntryArgv,
  main,
  spawnPdfChild,
  resolvePdfSpawnFactory,
  makeServerTeardown,
  type BuildServerDeps,
} from "./index.ts";

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

test("buildServer populates ctx.runtimeRoot from deps, not from env (§7.6 maintenance amendment 2026-06-04, Δ2 single resolution path)", () => {
  // Pins ONE link of the single-resolution chain: the ctx literal sources
  // runtimeRoot from deps, not a fresh re-resolve. Make deps and env DISAGREE —
  // ctx.runtimeRoot must reflect the deps value buildServer was handed (catches
  // a regression to `runtimeRoot: resolveRuntimeRoot()` in the literal). It does
  // NOT prove the handlers consume the field rather than re-reading env on the
  // hot path — that discrimination lives in corpus.test.ts "writes the
  // per-corpus DB under ctx.runtimeRoot, ignoring a divergent
  // SCHOLAR_RUNTIME_ROOT" (the strong Δ2 tripwire). See audit Δ7.
  const fromDeps = "/tmp/scholar-runtime-from-deps";
  const origEnv = process.env.SCHOLAR_RUNTIME_ROOT;
  process.env.SCHOLAR_RUNTIME_ROOT = "/tmp/scholar-runtime-from-env-SHOULD-NOT-WIN";
  try {
    const { ctx } = buildServer(makeDeps({ runtimeRoot: fromDeps }));
    expect(ctx.runtimeRoot).toBe(fromDeps);
  } finally {
    if (origEnv === undefined) delete process.env.SCHOLAR_RUNTIME_ROOT;
    else process.env.SCHOLAR_RUNTIME_ROOT = origEnv;
  }
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

// ─── Bug #3 (2026-06-03): production pdf-child wiring — resolvePdfSpawnFactory ──
// The first real smoke test exposed that NO production entry point ever passed
// the spawner to buildServer, so ctx.pdf was always the throwing stub. Worse,
// the real spawner is `async (opts) => Promise<PdfChildHandle>` while
// `BuildServerDeps.spawnPdfChild` is `() => PdfChild` (sync) — signature-
// incompatible. resolvePdfSpawnFactory bridges them: await the async spawn once
// (bounded by a timeout so a hung MCP handshake can't block scholar's own
// initialize), then return a sync closure yielding the resolved handle.
// A live child reports `isHealthy().alive === true`; the stub reports `false` —
// that gap is the production-visible discriminator (surfaced via corpus.status).

// A fake "live" pdf child: isHealthy → alive:true, distinguishing a real spawned
// handle from the buildServer stub (alive:false).
function aliveChild(): ReturnType<NonNullable<BuildServerDeps["spawnPdfChild"]>> {
  return {
    interact: async () => null,
    getText: async () => "",
    currentRoots: () => [],
    setRoots: async () => {},
    displayPdf: async () => ({ viewUUID: "live-view-uuid" }),
    isHealthy: () => ({ alive: true, lastOkAt: 1, stdioOpen: true }),
  };
}

test("resolvePdfSpawnFactory: a successful async spawn yields a factory that wires the live child", async () => {
  const factory = await resolvePdfSpawnFactory(async () => aliveChild());
  expect(factory).toBeDefined();
  const { ctx } = buildServer(makeDeps({ spawnPdfChild: factory! }));
  // ctx.pdf is the spawned child (alive:true), NOT the throwing stub (alive:false).
  expect(ctx.pdf.isHealthy().alive).toBe(true);
});

test("resolvePdfSpawnFactory: a spawn rejection degrades to the stub (undefined factory, no throw)", async () => {
  const factory = await resolvePdfSpawnFactory(async () => {
    throw new Error("pdf entrypoint missing");
  });
  expect(factory).toBeUndefined();
  // buildServer with undefined → throwing stub (alive:false): degrade is graceful,
  // not fatal — corpus/search/digest still work without a pdf child.
  const { ctx } = buildServer(makeDeps({ spawnPdfChild: factory }));
  expect(ctx.pdf.isHealthy().alive).toBe(false);
});

test("resolvePdfSpawnFactory: a hung spawn is bounded by the timeout and degrades to the stub", async () => {
  // A spawn that never settles (hung MCP handshake) must not block forever —
  // it would otherwise stall scholar's own initialize and the host would see
  // scholar fail to start with no reason. Bounded → undefined (degrade to stub).
  const factory = await resolvePdfSpawnFactory(() => new Promise<never>(() => {}), 20);
  expect(factory).toBeUndefined();
});

// ─── F1 fix (2026-06-04): graceful teardown on every server exit path ───────
// Root cause (verified): StdioServerTransport registers only 'data'/'error' on
// stdin (no 'end'), and the live pdf child keeps the event loop alive — so the
// server never self-exits on stdin EOF. The host then falls back to its
// stdin.end()→2s→SIGTERM→2s→SIGKILL ladder (SDK client/stdio.js), i.e. a dead
// ~2s wait on EVERY session close, and on Linux the pdf child (lifecycle.ts:388
// "relies on scholar's own shutdown handler" — which did not exist) is orphaned.
// makeServerTeardown is that handler, wired to stdin 'end'/'close', SIGINT, and
// SIGTERM. It reaps the child by a DIRECT pid signal (instant) rather than
// handle.shutdown(): the child also hangs on its own stdin EOF, so shutdown()
// would re-incur ~2s; on a host-driven teardown there is nothing to flush, so a
// direct signal is correct. The live EOF→exit wiring is proven by a real-artifact
// run (runServer binds a live transport and cannot be driven in-process); these
// unit tests pin the injectable reap+release+exit+idempotency logic.
test("makeServerTeardown reaps the pdf child, releases the lock, then exits — in that order", () => {
  const calls: string[] = [];
  const teardown = makeServerTeardown({
    releaseLock: () => calls.push("release"),
    pdfChildPid: () => 4242,
    kill: (pid, sig) => calls.push(`kill:${pid}:${sig}`),
    exit: (code) => calls.push(`exit:${code}`),
  });
  teardown(0);
  // reap BEFORE release/exit so the child dies even if a later step throws.
  expect(calls).toEqual(["kill:4242:SIGTERM", "release", "exit:0"]);
});

test("makeServerTeardown is idempotent — a second exit path is a no-op", () => {
  let releases = 0;
  let exits = 0;
  const teardown = makeServerTeardown({
    releaseLock: () => {
      releases++;
    },
    pdfChildPid: () => undefined,
    kill: () => {},
    exit: () => {
      exits++;
    },
  });
  teardown(0);
  teardown(0); // e.g. SIGTERM arriving after stdin 'end' already fired
  expect(releases).toBe(1);
  expect(exits).toBe(1);
});

test("makeServerTeardown skips the kill when there is no live pdf child pid", () => {
  for (const pid of [undefined, 0, -1]) {
    let killed = false;
    const teardown = makeServerTeardown({
      releaseLock: () => {},
      pdfChildPid: () => pid,
      kill: () => {
        killed = true;
      },
      exit: () => {},
    });
    teardown(0);
    expect(killed).toBe(false); // stub/degraded child or invalid pid → nothing to reap
  }
});

test("makeServerTeardown still releases + exits when the pdf-child kill throws", () => {
  const calls: string[] = [];
  const teardown = makeServerTeardown({
    releaseLock: () => calls.push("release"),
    pdfChildPid: () => 999999,
    kill: () => {
      throw new Error("ESRCH"); // child already dead — must not abort teardown
    },
    exit: (code) => calls.push(`exit:${code}`),
  });
  teardown(0);
  expect(calls).toEqual(["release", "exit:0"]);
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
  // The config DB is migrated by buildServer, but no corpus is active, so
  // scholar.corpus.status throws NO_ACTIVE_CORPUS → tool_error → exit 1.
  makeTempRuntime();
  const code = await main(["--call", "scholar.corpus.status", "{}"]);
  // tool_error → exit 1
  expect(code).toBe(1);
});

// ─── REGRESSION: buildServer must migrate the config DB (default opener) ──────
// Bug surfaced 2026-06-03 (first real smoke test): buildServer opened the config
// DB via the default opener but never ran migrations on it, so the corpora /
// pdf_roots / settings tables never existed. Every real install hit "no such
// table: corpora" on scholar.corpus.{list,create} — the entire corpus workflow
// was unreachable outside tests. Tests masked it by injecting a *pre-migrated*
// openConfigDb (makeDeps), so the production opener path had zero coverage.
// This guards the real opener directly: a fresh on-disk runtime must yield a
// migrated config DB where corpus.list returns an empty corpora set, not a throw.
test("buildServer migrates the config DB so corpus.list works on a fresh runtime", async () => {
  const dir = makeTempRuntime();
  const { dispatch } = buildServer({ runtimeRoot: dir, quiet: true });
  const result = (await dispatch("scholar.corpus.list", {})) as { corpora: unknown[] };
  expect(result.corpora).toEqual([]);
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

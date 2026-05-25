// src/server/index.test.ts — foundation cycle 6.1 (Task 1.10)
//
// Foundation pins the buildServer shape: returns { server, ctx, dispatch }.
// `dispatch` is foundation-internal (NOT §7.6 frozen) — added foundation-009
// so `--call` CLI mode can dispatch a tool by name without round-tripping
// through the stdio MCP transport.
import { test, expect } from "bun:test";
import { buildServer, spawnPdfChild, type BuildServerDeps } from "./index.ts";

function makeDeps(overrides: Partial<BuildServerDeps> = {}): BuildServerDeps {
  return {
    runtimeRoot: "/tmp/scholar-runtime-test-doesnt-need-to-exist",
    openConfigDb: () => ({}) as never,
    spawnPdfChild: () => ({
      interact: async () => null,
      getText: async () => "",
      currentRoots: () => [],
      setRoots: async () => {},
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

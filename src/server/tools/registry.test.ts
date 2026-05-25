// src/server/tools/registry.test.ts — foundation cycle 6.1 (Task 1.6)
//
// Shape-only test: foundation pins the `registerAll(server, ctx) → ToolRegistry`
// contract. Stubs are no-ops at cycle 6.1; downstream plans fill bodies and the
// registry populates accordingly.
import { test, expect } from "bun:test";
import { registerAll, type ToolRegistry } from "./registry.ts";

test("registerAll is a function that takes (server, ctx) and returns a ToolRegistry", () => {
  expect(typeof registerAll).toBe("function");
  expect(registerAll.length).toBe(2);
});

test("registerAll invokes every tool module's registerTools and returns a Map<string, handler>", () => {
  const calls: string[] = [];
  const fakeServer = {
    registerTool: (name: string) => {
      calls.push(name);
    },
  } as unknown as Parameters<typeof registerAll>[0];
  const ctx = {
    db: undefined,
    configDb: {} as never,
    pdf: {
      interact: async () => null,
      getText: async () => "",
      currentRoots: () => [],
      isHealthy: () => ({ alive: true, lastOkAt: null, stdioOpen: true }),
    },
    config: { get: () => undefined, set: () => {}, corpora: () => [], activeCorpusId: () => undefined },
    log: { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    withCorpus: async (fn: (db: unknown) => unknown) => fn({} as never),
  } as unknown as Parameters<typeof registerAll>[1];
  const registry: ToolRegistry = registerAll(fakeServer, ctx);
  expect(registry).toBeInstanceOf(Map);
  // Stubs are no-ops at cycle 6.1; the registry is empty until downstream plans fill bodies.
  expect(typeof registry.get).toBe("function");
  // No stub may have registered anything at the cycle-6.1 scaffold.
  expect(registry.size).toBe(0);
});

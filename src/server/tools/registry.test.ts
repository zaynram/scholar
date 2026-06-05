// src/server/tools/registry.test.ts — foundation cycle 6.1 (Task 1.6)
//
// Shape-only test: foundation pins the `registerAll(server, ctx) → ToolRegistry`
// contract. Stubs are no-ops at cycle 6.1; downstream plans fill bodies and the
// registry populates accordingly.
//
// H2 (2026-05-28): added a wrapper-shape test. The MCP wrapper around every
// handler was unconditionally serializing every result into a `text` content
// block, losing the typed view-opener payload that hosts want under
// `structuredContent`. The new test captures the wrapper at registration time
// and asserts it emits `structuredContent` when the handler returns a `view`
// payload, and keeps the legacy text-only shape otherwise.
//
// §9 amendment (2026-06-04): the view-opener contract was unified onto the
// `ViewInput` discriminant (`{view, ...ids}` in structuredContent) — retiring the
// old `{openView:{resource,route}}` shape — and each view-opener tool DEF now
// carries `_meta.ui.resourceUri` (both modern + legacy keys) so the host renders
// the iframe. These tests pin both halves.
import { test, expect } from "bun:test";
import { registerAll, type ToolRegistry } from "./registry.ts";
import { APP_URI } from "../ui/resource.ts";

const VIEW_OPENERS = [
  "scholar.dashboard",
  "scholar.paper.show",
  "scholar.digest.show",
  "scholar.prompts.show",
  "scholar.progress.show",
];

function fakeCtx() {
  return {
    db: undefined,
    configDb: {} as never,
    pdf: {
      interact: async () => null,
      getText: async () => "",
      currentRoots: () => [],
      // setRoots added to PdfChild contract by chore foundation-fill-corpus-prereqs (2026-05-25).
      setRoots: async () => {},
      isHealthy: () => ({ alive: true, lastOkAt: null, stdioOpen: true }),
    },
    config: { get: () => undefined, set: () => {}, corpora: () => [], activeCorpusId: () => undefined },
    log: { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    withCorpus: async (fn: (db: unknown) => unknown) => fn({} as never),
  } as unknown as Parameters<typeof registerAll>[1];
}

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
  const registry: ToolRegistry = registerAll(fakeServer, fakeCtx());
  expect(registry).toBeInstanceOf(Map);
  // Downstream plans fill bodies as waves complete; the registry grows accordingly.
  // After corpus wave 2 (cycle 6.3): corpus + roots tools are registered.
  // Remaining stubs (ingest, pdf, papers, etc.) are filled by later waves.
  expect(typeof registry.get).toBe("function");
  // Registry has at least the corpus + roots tools filled by corpus plan cycle 6.3.
  expect(registry.size).toBeGreaterThan(0);
});

test("MCP wrapper emits structuredContent for view-opener results (view discriminant)", async () => {
  // Capture the SDK-facing wrapper functions registered by every tool module.
  // The wrapper is what runs when the MCP host invokes a tool; if it doesn't
  // promote the `view` payload into `structuredContent`, the host can never
  // deliver it to the App (it only sees stringified JSON inside a text block).
  const wrappers = new Map<string, (args: unknown) => Promise<unknown>>();
  const fakeServer = {
    registerTool: (
      name: string,
      _def: unknown,
      wrapper: (args: unknown) => Promise<unknown>,
    ) => {
      wrappers.set(name, wrapper);
    },
  } as unknown as Parameters<typeof registerAll>[0];
  registerAll(fakeServer, fakeCtx());

  // scholar.paper.show returns { view: "paper", paper_id } — the unified
  // ViewInput shape (§9 amendment); wrapper must surface it as structuredContent.
  const showWrapper = wrappers.get("scholar.paper.show");
  expect(showWrapper, "scholar.paper.show must be registered").toBeDefined();
  const result = (await showWrapper!({ paper_id: "p1" })) as {
    content: Array<{ type: string; text: string }>;
    structuredContent?: { view?: string; paper_id?: string };
  };
  expect(result.structuredContent).toMatchObject({ view: "paper", paper_id: "p1" });
  // Backwards-compat: the legacy text block stays so hosts that don't read
  // structuredContent still get the payload as JSON.
  expect(result.content?.[0]?.type).toBe("text");
});

test("view-opener tool defs carry _meta.ui.resourceUri (both modern + legacy keys)", () => {
  // The host renders the app iframe only when the triggering tool's definition
  // declares the UI resource it opens. Pin all five view-opener defs.
  const defs = new Map<string, { _meta?: Record<string, unknown> }>();
  const fakeServer = {
    registerTool: (name: string, def: { _meta?: Record<string, unknown> }) => {
      defs.set(name, def);
    },
  } as unknown as Parameters<typeof registerAll>[0];
  registerAll(fakeServer, fakeCtx());

  for (const name of VIEW_OPENERS) {
    const def = defs.get(name);
    expect(def, `${name} must be registered`).toBeDefined();
    const meta = def!._meta as
      | { ui?: { resourceUri?: string }; "ui/resourceUri"?: string }
      | undefined;
    expect(meta?.ui?.resourceUri, `${name} _meta.ui.resourceUri`).toBe(APP_URI);
    expect(meta?.["ui/resourceUri"], `${name} legacy _meta["ui/resourceUri"]`).toBe(APP_URI);
  }
});

test("MCP wrapper leaves non-view-opener results as text-only", async () => {
  const wrappers = new Map<string, (args: unknown) => Promise<unknown>>();
  const fakeServer = {
    registerTool: (
      name: string,
      _def: unknown,
      wrapper: (args: unknown) => Promise<unknown>,
    ) => {
      wrappers.set(name, wrapper);
    },
  } as unknown as Parameters<typeof registerAll>[0];
  registerAll(fakeServer, fakeCtx());

  // scholar.corpus.list returns a plain array of corpora — no openView.
  const listWrapper = wrappers.get("scholar.corpus.list");
  expect(listWrapper).toBeDefined();
  const result = (await listWrapper!({})) as {
    content: Array<{ type: string; text: string }>;
    structuredContent?: unknown;
  };
  expect(result.structuredContent).toBeUndefined();
  expect(result.content?.[0]?.type).toBe("text");
});

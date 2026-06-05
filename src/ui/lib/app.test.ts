// src/ui/lib/app.test.ts — MCP Apps client bridge (§9 amendment 2026-06-04).
//
// Pins the ext-apps `App` adapter in src/ui/lib/app.ts against a FakeApp
// (app.testkit.ts). The load-bearing guarantee is the ONE-SHOT ordering:
// initApp must register the `toolresult` handler BEFORE `connect()`, or the
// triggering notification is missed on a real host and the panel renders blank.
import { describe, beforeAll, afterAll, beforeEach, test, expect } from "bun:test";
import { registerDom, unregisterDom } from "%/util/preload.ts";
import {
  installExtAppsMock,
  latestFakeApp,
  resetFakeApps,
} from "./app.testkit.ts";

// Install the ext-apps mock BEFORE lib/app.ts is (dynamically) imported.
installExtAppsMock();

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe("lib/app.ts — ext-apps bridge adapter", () => {
  // initApp() / isAskClaudeAvailable() are window-guarded (SSR-safe); a DOM must
  // be registered for them to run their real paths.
  beforeAll(registerDom);
  afterAll(unregisterDom);

  beforeEach(() => {
    resetFakeApps();
    delete (globalThis as Record<string, unknown>).cowork;
  });

  test("initApp registers toolresult + hostcontextchanged BEFORE connect (one-shot)", async () => {
    const { initApp } = await import("./app.ts");
    initApp({ onView: () => {}, onHostContext: () => {} });
    const app = latestFakeApp();
    const iResult = app.log.indexOf("addEventListener:toolresult");
    const iHost = app.log.indexOf("addEventListener:hostcontextchanged");
    const iConnect = app.log.indexOf("connect");
    expect(iResult).toBeGreaterThanOrEqual(0);
    expect(iConnect).toBeGreaterThanOrEqual(0);
    // The whole point: handlers registered before the handshake.
    expect(iResult).toBeLessThan(iConnect);
    expect(iHost).toBeLessThan(iConnect);
  });

  test("toolresult with structuredContent.view dispatches onView; non-view is ignored", async () => {
    const { initApp } = await import("./app.ts");
    const seen: unknown[] = [];
    initApp({ onView: (v) => seen.push(v), onHostContext: () => {} });
    const app = latestFakeApp();

    app.fire("toolresult", { structuredContent: { view: "paper", paper_id: "p1" } });
    app.fire("toolresult", { structuredContent: { hits: [] } }); // no `view` — ignored
    app.fire("toolresult", { content: [] }); // no structuredContent — ignored

    expect(seen).toEqual([{ view: "paper", paper_id: "p1" }]);
  });

  test("callServerTool returns structuredContent when the tool provides it", async () => {
    const { initApp, callServerTool } = await import("./app.ts");
    initApp({ onView: () => {}, onHostContext: () => {} });
    const app = latestFakeApp();
    app.callServerToolImpl = async () => ({
      content: [{ type: "text", text: "ignored" }],
      structuredContent: { view: "dashboard" },
    });
    const res = await callServerTool("scholar.dashboard", {});
    expect(res).toEqual({ view: "dashboard" });
  });

  test("callServerTool parses the text-JSON block for data tools (no structuredContent)", async () => {
    const { initApp, callServerTool } = await import("./app.ts");
    initApp({ onView: () => {}, onHostContext: () => {} });
    const app = latestFakeApp();
    // The registry wrapper leaves non-view tools text-only; the adapter must
    // parse the JSON so callers get the data object directly (res.hits, etc).
    app.callServerToolImpl = async () => ({
      content: [{ type: "text", text: JSON.stringify({ hits: [{ id: "p1" }], still_indexing: false }) }],
      structuredContent: undefined,
    });
    const res = (await callServerTool("scholar.papers.search", { q: "" })) as {
      hits?: Array<{ id: string }>;
      still_indexing?: boolean;
    };
    expect(res.hits).toEqual([{ id: "p1" }]);
    expect(res.still_indexing).toBe(false);
    // and the args are forwarded under the ext-apps {name, arguments} shape
    expect(app.callServerToolCalls[0]).toEqual({
      name: "scholar.papers.search",
      arguments: { q: "" },
    });
  });

  test("callServerTool surfaces the askClaude sentinel from the text block", async () => {
    const { initApp, callServerTool } = await import("./app.ts");
    initApp({ onView: () => {}, onHostContext: () => {} });
    const app = latestFakeApp();
    const sentinel = { prompt: "summarize", data: { papers: [] } };
    app.callServerToolImpl = async () => ({
      content: [{ type: "text", text: JSON.stringify({ askClaude: sentinel }) }],
    });
    const res = (await callServerTool("scholar.digest.generate", {})) as {
      askClaude?: unknown;
    };
    expect(res.askClaude).toEqual(sentinel);
  });

  test("readResource maps to App.readServerResource and returns its contents", async () => {
    const { initApp, readResource } = await import("./app.ts");
    initApp({ onView: () => {}, onHostContext: () => {} });
    const app = latestFakeApp();
    app.readServerResourceImpl = async () => ({
      contents: [{ uri: "ui://scholar/pdf/p1", mimeType: "application/pdf", blob: "QUJD" }],
    });
    const res = await readResource("ui://scholar/pdf/p1");
    expect(app.readResourceCalls[0]).toEqual({ uri: "ui://scholar/pdf/p1" });
    expect(res.contents[0]?.blob).toBe("QUJD");
  });

  test("sendMessage translates a string into the {role,content[]} message shape", async () => {
    const { initApp, sendMessage } = await import("./app.ts");
    initApp({ onView: () => {}, onHostContext: () => {} });
    const app = latestFakeApp();
    sendMessage("scholar: Attention Is All You Need");
    await flush();
    expect(app.sendMessageCalls[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "scholar: Attention Is All You Need" }],
    });
  });

  test("initial host context is applied once after connect resolves", async () => {
    const { initApp } = await import("./app.ts");
    const seen: unknown[] = [];
    initApp({ onView: () => {}, onHostContext: (c) => seen.push(c) });
    const app = latestFakeApp();
    // connect()'s .then() reads getHostContext() on a microtask; set the
    // handshake snapshot synchronously now (before flush) so it is in place.
    app.hostContext = { theme: "dark", styles: { variables: { "--color-text-primary": "#fff" } } };
    await flush();
    expect(seen).toEqual([
      { theme: "dark", cssVars: { "--color-text-primary": "#fff" } },
    ]);
  });

  test("isAskClaudeAvailable degrades to false without a cowork host global", async () => {
    const { isAskClaudeAvailable } = await import("./app.ts");
    expect(isAskClaudeAvailable()).toBe(false);
    (globalThis as Record<string, unknown>).cowork = { askClaude: async () => "ok" };
    expect(isAskClaudeAvailable()).toBe(true);
  });
});

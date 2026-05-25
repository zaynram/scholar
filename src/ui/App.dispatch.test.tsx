// src/ui/App.dispatch.test.tsx
// DOM-based dispatch wiring test. Exercises App.tsx's switch(view.view) — catches
// typos like case "prompt" vs case "prompts" that renderToString tests miss.
//
// SDK mechanism: OPTION B (property-handler on window.mcp.ontoolinput) —
// selected per spec §line 253 "wires the App SDK lifecycle (`ontoolinput`,
// `ontoolresult`, `onhostcontextchanged`)" — property-style names, not events.
// Cowork host convention is window.cowork.askClaude (property on global object),
// same pattern.
//
// Uses registerDom/unregisterDom opt-in pattern (chore 859263d).
import { describe, beforeAll, afterAll, test, expect, beforeEach, afterEach } from "bun:test";
import { registerDom, unregisterDom } from "../../test-preload.ts";

describe("App.tsx — view dispatcher (OPTION B: property-handler)", () => {
  beforeAll(registerDom);
  afterAll(unregisterDom);

  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    // Reset the mock MCP surface installed by lib/app.ts onToolInput.
    (globalThis as Record<string, unknown>).mcp = {
      callTool: async () => ({}),
      readResource: async () => ({ contents: [] }),
    };
  });
  afterEach(() => {
    document.body.removeChild(container);
    delete (globalThis as Record<string, unknown>).mcp;
  });

  const VIEW_CASES: Array<{ input: { view: string } & Record<string, unknown>; attr: string }> = [
    { input: { view: "dashboard" }, attr: 'data-view="dashboard"' },
    { input: { view: "paper", paper_id: "p1" }, attr: 'data-view="paper"' },
    { input: { view: "digest", scope_key: "all" }, attr: 'data-view="digest"' },
    { input: { view: "prompts" }, attr: 'data-view="prompts"' },
    { input: { view: "progress" }, attr: 'data-view="progress"' },
  ];

  for (const { input, attr } of VIEW_CASES) {
    test(`App.tsx dispatches to ${input.view} view (property-handler mechanism)`, async () => {
      const { createRoot } = await import("react-dom/client");
      const { createElement, act } = await import("react");
      const { App } = await import("./App.tsx");

      await act(async () => {
        createRoot(container).render(createElement(App, {}));
      });

      // OPTION B: property-handler dispatch. The App's useEffect installs
      // window.mcp.ontoolinput; invoking it triggers the React state update.
      const mcp = (globalThis as Record<string, unknown>).mcp as {
        ontoolinput?: (input: unknown) => void;
      };
      expect(typeof mcp.ontoolinput).toBe("function");

      await act(async () => {
        mcp.ontoolinput!(input);
      });

      expect(container.innerHTML).toContain(attr);
    });
  }
});

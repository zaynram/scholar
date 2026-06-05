// src/ui/App.dispatch.test.tsx
// DOM-based dispatch wiring test. Exercises App.tsx's switch(view.view) — catches
// typos like case "prompt" vs case "prompts" that renderToString tests miss.
//
// Mechanism (§9 conformance amendment 2026-06-04): the view discriminant arrives
// on the ext-apps `App`'s `toolresult` notification, carried in the tool RESULT
// `structuredContent`. We mock @modelcontextprotocol/ext-apps with a FakeApp
// (app.testkit.ts), render <App/> (which wires initApp), then fire `toolresult`
// for each view and assert the rendered data-view attribute.
import { describe, beforeAll, afterAll, test, expect, beforeEach, afterEach } from "bun:test";
import { registerDom, unregisterDom } from "%/util/preload.ts";
import { installExtAppsMock, latestFakeApp, resetFakeApps } from "./lib/app.testkit.ts";

// Install the ext-apps mock BEFORE App.tsx (-> lib/app.ts) is imported.
installExtAppsMock();

// React 18 act() environment flag — required for act() to flush state updates.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("App.tsx — view dispatcher (ext-apps toolresult carrier)", () => {
  beforeAll(registerDom);
  afterAll(unregisterDom);

  let container: HTMLDivElement;
  beforeEach(() => {
    resetFakeApps();
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
  });

  const VIEW_CASES: Array<{ input: { view: string } & Record<string, unknown>; attr: string }> = [
    { input: { view: "dashboard" }, attr: 'data-view="dashboard"' },
    { input: { view: "paper", paper_id: "p1" }, attr: 'data-view="paper"' },
    { input: { view: "digest", scope_key: "all" }, attr: 'data-view="digest"' },
    { input: { view: "prompts" }, attr: 'data-view="prompts"' },
    { input: { view: "progress" }, attr: 'data-view="progress"' },
  ];

  for (const { input, attr } of VIEW_CASES) {
    test(`App.tsx dispatches to ${input.view} view (toolresult -> structuredContent)`, async () => {
      const { createRoot } = await import("react-dom/client");
      const { createElement, act } = await import("react");
      const { App } = await import("./App.tsx");

      await act(async () => {
        createRoot(container).render(createElement(App, {}));
      });

      // App.tsx's useEffect wired initApp -> a FakeApp with a toolresult handler
      // registered before connect. Delivering the notification drives the React
      // state update, exactly as a real host would after the triggering call.
      const app = latestFakeApp();
      expect(app.log.indexOf("addEventListener:toolresult")).toBeLessThan(
        app.log.indexOf("connect"),
      );

      await act(async () => {
        app.fire("toolresult", { structuredContent: input });
      });

      expect(container.innerHTML).toContain(attr);
    });
  }
});

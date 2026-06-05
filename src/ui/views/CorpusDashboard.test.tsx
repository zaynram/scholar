// src/ui/views/CorpusDashboard.test.tsx
// SA1 test — still_indexing pill in CorpusDashboard.
//
// Anchor (spec §11, verbatim per chore 1c9e0d3 PART C SA1 pin):
//   "Semantic-search code paths (scholar.papers.search with semantic mode) check
//    settings.chunk_vec.created and degrade to lexical with a 'still indexing' pill
//    when false — the same affordance used for partially-embedded chunks."
//
// Mechanism (§9 conformance amendment 2026-06-04): CorpusDashboard calls
// callServerTool from lib/app.ts, which proxies through the ext-apps App. We mock
// @modelcontextprotocol/ext-apps with a FakeApp (app.testkit.ts) and call
// initApp() to establish the bridge, then configure the fake's search response.
//
// Contract:
//   - pill with data-badge="still-indexing" IS present when the search resolves
//     { hits: [], still_indexing: true }
//   - pill is ABSENT when it resolves { hits: [], still_indexing: false }
import {
  describe,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  test,
  expect,
} from "bun:test";
import { registerDom, unregisterDom } from "%/util";
import {
  installExtAppsMock,
  latestFakeApp,
  resetFakeApps,
  type FakeApp,
} from "../lib/app.testkit.ts";

// Install the ext-apps mock BEFORE lib/app.ts is (dynamically) imported.
installExtAppsMock();

// React 18 act() environment flag — makes act() flush state updates synchronously.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("CorpusDashboard — SA1 still_indexing pill (spec §11)", () => {
  beforeAll(registerDom);
  afterAll(unregisterDom);

  let container: HTMLDivElement;
  let fake: FakeApp;
  beforeEach(async () => {
    resetFakeApps();
    container = document.createElement("div");
    document.body.appendChild(container);
    const { initApp } = await import("../lib/app.ts");
    initApp({ onView: () => {}, onHostContext: () => {} });
    fake = latestFakeApp();
  });
  afterEach(() => {
    document.body.removeChild(container);
  });

  test("SA1 pill-present: data-badge='still-indexing' rendered when still_indexing=true", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { CorpusDashboard } = await import("./CorpusDashboard.tsx");

    fake.callServerToolImpl = async () => ({
      structuredContent: { hits: [], still_indexing: true },
    });

    await act(async () => {
      createRoot(container).render(
        createElement(CorpusDashboard, { papers: [], onAction: () => { } }),
      );
    });
    // Let the useEffect-triggered search resolve.
    await act(async () => { });

    expect(container.innerHTML).toContain('data-badge="still-indexing"');
  });

  test("SA1 pill-absent: data-badge='still-indexing' not rendered when still_indexing=false", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { CorpusDashboard } = await import("./CorpusDashboard.tsx");

    fake.callServerToolImpl = async () => ({
      structuredContent: { hits: [], still_indexing: false },
    });

    await act(async () => {
      createRoot(container).render(
        createElement(CorpusDashboard, { papers: [], onAction: () => { } }),
      );
    });
    await act(async () => { });

    expect(container.innerHTML).not.toContain('data-badge="still-indexing"');
  });
});

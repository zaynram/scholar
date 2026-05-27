// src/ui/views/CorpusDashboard.test.tsx
// SA1 Red test — still_indexing pill in CorpusDashboard. (chore 1c9e0d3 PART C)
//
// Anchor (spec §11 line 1007, echoed at line 1346) — preserved verbatim per
// chore 1c9e0d3 PART C SA1 pin:
//   "Semantic-search code paths (scholar.papers.search with semantic mode) check
//    settings.chunk_vec.created and degrade to lexical with a 'still indexing' pill
//    when false — the same affordance used for partially-embedded chunks."
//
// Contract:
//   - pill with data-badge="still-indexing" IS present when callServerTool resolves
//     { hits: [], still_indexing: true }
//   - pill is ABSENT when callServerTool resolves { hits: [], still_indexing: false }
//
// Tests use the registerDom/unregisterDom opt-in (chore 859263d). The async
// useEffect that fires scholar.papers.search resolves through act() ticks.
//
// Expected at Red: FAIL — Cannot find module './CorpusDashboard'.
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

// React 18 act() environment flag — silences "not configured to support act"
// warnings and makes act() actually flush state updates synchronously.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("CorpusDashboard — SA1 still_indexing pill (spec §11)", () => {
  beforeAll(registerDom);
  afterAll(unregisterDom);

  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    delete (globalThis as Record<string, unknown>).mcp;
  });
  afterEach(() => {
    document.body.removeChild(container);
    delete (globalThis as Record<string, unknown>).mcp;
  });

  // Anchor (spec §11 line 1007, verbatim per chore 1c9e0d3 PART C SA1):
  //   "Semantic-search code paths (scholar.papers.search with semantic mode)
  //    check settings.chunk_vec.created and degrade to lexical with a 'still
  //    indexing' pill when false — the same affordance used for partially-
  //    embedded chunks."
  test("SA1 pill-present: data-badge='still-indexing' rendered when still_indexing=true", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { CorpusDashboard } = await import("./CorpusDashboard.tsx");

    (globalThis as Record<string, unknown>).mcp = {
      callTool: async (_name: string, _args: unknown) => ({
        hits: [],
        still_indexing: true,
      }),
    };

    await act(async () => {
      createRoot(container).render(
        createElement(CorpusDashboard, { papers: [], onAction: () => { } }),
      );
    });
    // Let the useEffect-triggered search resolve.
    await act(async () => { });

    expect(container.innerHTML).toContain('data-badge="still-indexing"');
  });

  // Same anchor: pill absent when still_indexing=false.
  test("SA1 pill-absent: data-badge='still-indexing' not rendered when still_indexing=false", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { CorpusDashboard } = await import("./CorpusDashboard.tsx");

    (globalThis as Record<string, unknown>).mcp = {
      callTool: async (_name: string, _args: unknown) => ({
        hits: [],
        still_indexing: false,
      }),
    };

    await act(async () => {
      createRoot(container).render(
        createElement(CorpusDashboard, { papers: [], onAction: () => { } }),
      );
    });
    await act(async () => { });

    expect(container.innerHTML).not.toContain('data-badge="still-indexing"');
  });
});

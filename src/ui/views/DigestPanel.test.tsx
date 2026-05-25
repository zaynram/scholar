// src/ui/views/DigestPanel.test.tsx
// SA2/SA3/SA4 Red tests for DigestPanel. (chore 1c9e0d3 PART C)
//
// All five tests are written BEFORE DigestPanel exists; they fail at import time
// (Red phase). Tests use the registerDom/unregisterDom opt-in (chore 859263d)
// to exercise interactive behavior (button clicks, async callTool round-trips).
//
// Expected at Red: FAIL — Cannot find module './DigestPanel'.
import {
  describe,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  test,
  expect,
  mock,
} from "bun:test";
import { registerDom, unregisterDom } from "../../../test-preload.ts";

// React 18: set IS_REACT_ACT_ENVIRONMENT so act() flushes state updates
// synchronously and click handlers run their async callTool chains within
// the act() boundary. Without this, useState updates batch and the SA3/SA4
// tests race past their captures.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("DigestPanel — SA2/SA3/SA4 verbatim anchors (chore 1c9e0d3 PART C)", () => {
  beforeAll(registerDom);
  afterAll(unregisterDom);

  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.removeChild(container);
    delete (globalThis as Record<string, unknown>).cowork;
    delete (globalThis as Record<string, unknown>).mcp;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SA2 — askClaude sentinel + host-capability detection
  //
  // Anchor (spec §11 lines 1030-1035, verbatim per chore 1c9e0d3 PART C SA2):
  //   "window.cowork.askClaude is a Cowork-host-provided global ... The UI
  //    feature-detects with typeof window.cowork?.askClaude === 'function' on
  //    mount ... Absent. The toggle is hidden entirely; in its place the UI
  //    renders a single static note: 'Claude fallback unavailable in this host.'
  //    Servers still receive askClaude: undefined in tool calls (the toggle
  //    was never offered)."
  // ──────────────────────────────────────────────────────────────────────────

  test("SA2 capability-detect: host-absent → static note rendered, 'Use Claude instead' toggle absent", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { DigestPanel } = await import("./DigestPanel.tsx");

    // No window.cowork set — host absent (capability detect must return false).
    const mockCallTool = mock(async () => ({ body_md: "digest body" }));
    (globalThis as Record<string, unknown>).mcp = { callTool: mockCallTool };

    await act(async () => {
      createRoot(container).render(
        createElement(DigestPanel, {
          scopeKey: "all",
          digest: null,
          onAction: () => {},
        }),
      );
    });

    // Static note must be present.
    expect(container.innerHTML).toContain("Claude fallback unavailable in this host.");
    // Toggle must NOT be present.
    expect(container.innerHTML).not.toContain("Use Claude instead");
  });

  // Anchor (spec §11 lines 1015-1028, verbatim per chore 1c9e0d3 PART C SA2):
  //   "On seeing structuredContent.askClaude, the UI calls
  //    window.cowork.askClaude(askClaude.prompt, askClaude.data) (a host-provided
  //    global in the MCP App iframe) and renders the result. This sentinel shape
  //    is the contract shared between the producers (src/server/tools/digest.ts,
  //    prompts.ts) and the consumer (src/ui/views/DigestPanel.tsx)."
  test("SA2 sentinel-forwarding: host-present + structuredContent.askClaude → window.cowork.askClaude called", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { DigestPanel } = await import("./DigestPanel.tsx");

    const askClaudeMock = mock(
      async (_prompt: string, _data: unknown) => "Claude result",
    );
    (globalThis as Record<string, unknown>).cowork = { askClaude: askClaudeMock };

    const sentinelPayload = {
      prompt: "Summarize this corpus.",
      data: { papers: [] },
    };
    const mockCallTool = mock(async () => ({ askClaude: sentinelPayload }));
    (globalThis as Record<string, unknown>).mcp = { callTool: mockCallTool };

    await act(async () => {
      createRoot(container).render(
        createElement(DigestPanel, {
          scopeKey: "all",
          digest: null,
          onAction: () => {},
        }),
      );
    });

    // Trigger generateDigest(false) — find "Generate (Ollama)" by text
    // (the first <button> is the "Digest" tab-switcher, not the generator).
    const buttons = container.querySelectorAll("button");
    const generateBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Generate (Ollama)"),
    );
    expect(generateBtn).toBeDefined();
    await act(async () => {
      generateBtn!.click();
    });
    // Flush microtasks for the async callTool → askClaude chain.
    await act(async () => {});

    expect(askClaudeMock).toHaveBeenCalledWith(
      sentinelPayload.prompt,
      sentinelPayload.data,
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SA3 — scope_key enum (digest scope contract)
  //
  // Anchor (spec §9.3 line 935, verbatim per chore 1c9e0d3 PART C SA3):
  //   "Defaults to the current scope. Shows the cached digest if recent;
  //    otherwise calls app.callServerTool('digest.generate', {scope_key}) which
  //    runs the Ollama chat model against a paperLine-style corpus slice
  //    (preserving the Daisy prompt skeleton but rewriting it for Qwen)."
  // Anchor (spec §8.2 line 841): `scope_key: text("scope_key").notNull()`
  // ──────────────────────────────────────────────────────────────────────────

  test("SA3 scope_key enum: tool-call args carry scope_key matching the four-pattern enum", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { DigestPanel } = await import("./DigestPanel.tsx");

    let capturedArgs: Record<string, unknown> | null = null;
    const mockCallTool = mock(
      async (_name: string, args: Record<string, unknown>) => {
        capturedArgs = args;
        return { body_md: "ok" };
      },
    );
    (globalThis as Record<string, unknown>).mcp = { callTool: mockCallTool };

    const validScopeKeys = [
      "all",
      "stale",
      "section:introduction",
      "selection:abc123hash",
    ] as const;

    for (const scopeKey of validScopeKeys) {
      capturedArgs = null;
      const localContainer = document.createElement("div");
      document.body.appendChild(localContainer);
      try {
        await act(async () => {
          createRoot(localContainer).render(
            createElement(DigestPanel, {
              scopeKey,
              digest: null,
              onAction: () => {},
            }),
          );
        });
        // Find "Generate (Ollama)" by text — first <button> is the tab switcher.
        const buttons = localContainer.querySelectorAll("button");
        const generateBtn = Array.from(buttons).find((b) =>
          b.textContent?.includes("Generate (Ollama)"),
        );
        await act(async () => {
          generateBtn?.click();
        });
        await act(async () => {});

        expect(capturedArgs).not.toBeNull();
        expect((capturedArgs as unknown as Record<string, unknown>).scope_key).toBe(scopeKey);
        // Must NOT use `since` (old field name — renamed to scope_key).
        expect(capturedArgs).not.toHaveProperty("since");
        // Must NOT include corpus_id (per-corpus ctx.db snapshot).
        expect(capturedArgs).not.toHaveProperty("corpus_id");
      } finally {
        document.body.removeChild(localContainer);
      }
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SA4 — use_claude opt-in (mechanical-LLM-default discipline)
  //
  // Anchor (CLAUDE.md Load-bearing invariants, verbatim per chore 1c9e0d3 PART C SA4):
  //   "Mechanical LLM → local Ollama. Embeddings, digest, and reading-prompts
  //    default to local Ollama. cowork.askClaude is an explicit per-request
  //    opt-in only — never the default path."
  // Anchor (spec §11 line 1361):
  //   "Mechanical LLM work → Ollama by default; cowork.askClaude is opt-in only."
  // ──────────────────────────────────────────────────────────────────────────

  test("SA4 default: 'Generate (Ollama)' fires tool call with use_claude=false (or omitted)", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { DigestPanel } = await import("./DigestPanel.tsx");

    let capturedArgs: Record<string, unknown> | null = null;
    const mockCallTool = mock(
      async (_name: string, args: Record<string, unknown>) => {
        capturedArgs = args;
        return { body_md: "ok" };
      },
    );
    (globalThis as Record<string, unknown>).mcp = { callTool: mockCallTool };

    await act(async () => {
      createRoot(container).render(
        createElement(DigestPanel, {
          scopeKey: "all",
          digest: null,
          onAction: () => {},
        }),
      );
    });

    // Find "Generate (Ollama)" by text — first <button> is the tab switcher.
    const buttons = container.querySelectorAll("button");
    const generateBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Generate (Ollama)"),
    );
    await act(async () => {
      generateBtn?.click();
    });
    await act(async () => {});

    expect(capturedArgs).not.toBeNull();
    const uc = (capturedArgs as unknown as Record<string, unknown>).use_claude;
    // use_claude=false OR omitted — both equivalent at the server.
    expect(uc === false || uc === undefined).toBe(true);
  });

  test("SA4 toggle-on: 'Use Claude instead' button fires tool call with use_claude=true", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { DigestPanel } = await import("./DigestPanel.tsx");

    // Host must be present for the toggle to appear (SA2 discipline).
    (globalThis as Record<string, unknown>).cowork = {
      askClaude: async () => "Claude result",
    };

    let capturedArgs: Record<string, unknown> | null = null;
    const mockCallTool = mock(
      async (_name: string, args: Record<string, unknown>) => {
        capturedArgs = args;
        return { body_md: "ok" };
      },
    );
    (globalThis as Record<string, unknown>).mcp = { callTool: mockCallTool };

    await act(async () => {
      createRoot(container).render(
        createElement(DigestPanel, {
          scopeKey: "all",
          digest: null,
          onAction: () => {},
        }),
      );
    });

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const claudeBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Use Claude instead"),
    );
    expect(claudeBtn).toBeDefined();
    await act(async () => {
      claudeBtn!.click();
    });
    await act(async () => {});

    expect(capturedArgs).not.toBeNull();
    expect((capturedArgs as unknown as Record<string, unknown>).use_claude).toBe(true);
  });
});

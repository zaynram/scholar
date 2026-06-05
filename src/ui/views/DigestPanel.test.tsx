// src/ui/views/DigestPanel.test.tsx
// SA2/SA3/SA4 tests for DigestPanel.
//
// Mechanism (§9 conformance amendment 2026-06-04): DigestPanel calls
// callServerTool / isAskClaudeAvailable / askClaude from lib/app.ts. We mock
// @modelcontextprotocol/ext-apps with a FakeApp (app.testkit.ts) and call
// initApp() to establish the bridge, then configure the fake's tool response.
// isAskClaudeAvailable/askClaude still read the `cowork` host global (the degrade
// path is unchanged), so the SA2 host-present/absent cases set/unset it directly.
import {
  describe,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  test,
  expect,
} from "bun:test"
import { registerDom, unregisterDom } from "%/util"
import {
  installExtAppsMock,
  latestFakeApp,
  resetFakeApps,
  type FakeApp,
} from "../lib/app.testkit.ts"

// Install the ext-apps mock BEFORE lib/app.ts is (dynamically) imported.
installExtAppsMock();

// React 18: set IS_REACT_ACT_ENVIRONMENT so act() flushes state updates
// synchronously and click handlers run their async callTool chains within act().
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("DigestPanel — SA2/SA3/SA4 verbatim anchors", () => {
  beforeAll(registerDom)
  afterAll(unregisterDom)

  let container: HTMLDivElement
  let fake: FakeApp
  beforeEach(async () => {
    resetFakeApps()
    container = document.createElement("div");
    document.body.appendChild(container);
    // Establish the bridge (sets lib/app.ts's _app to a FakeApp) — mirrors
    // production where App.tsx's initApp runs before any view mounts.
    const { initApp } = await import("../lib/app.ts");
    initApp({ onView: () => {}, onHostContext: () => {} });
    fake = latestFakeApp();
  })
  afterEach(() => {
    document.body.removeChild(container);
    delete (globalThis as Record<string, unknown>).cowork;
  })

  // ──────────────────────────────────────────────────────────────────────────
  // SA2 — askClaude sentinel + host-capability detection
  //
  // Anchor (spec §11, verbatim): "window.cowork.askClaude is a Cowork-host-
  //   provided global ... feature-detects with typeof window.cowork?.askClaude
  //   === 'function' ... Absent. The toggle is hidden entirely; in its place the
  //   UI renders a single static note: 'Claude fallback unavailable in this
  //   host.' Servers still receive askClaude: undefined in tool calls."
  // ──────────────────────────────────────────────────────────────────────────

  test("SA2 capability-detect: host-absent → static note rendered, 'Use Claude instead' toggle absent", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { DigestPanel } = await import("./DigestPanel.tsx");

    // No cowork global — host absent (capability detect must return false).
    fake.callServerToolImpl = async () => ({ structuredContent: { body_md: "digest body" } });

    await act(async () => {
      createRoot(container).render(
        createElement(DigestPanel, {
          scopeKey: "all",
          digest: null,
          onAction: () => { },
        }),
      );
    });

    expect(container.innerHTML).toContain("Claude fallback unavailable in this host.");
    expect(container.innerHTML).not.toContain("Use Claude instead");
  });

  // Anchor (spec §11, verbatim): "On seeing structuredContent.askClaude, the UI
  //   calls window.cowork.askClaude(askClaude.prompt, askClaude.data) ... the
  //   contract shared between the producers (digest.ts, prompts.ts) and the
  //   consumer (DigestPanel.tsx)."
  test("SA2 sentinel-forwarding: host-present + askClaude sentinel → cowork.askClaude called", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { DigestPanel } = await import("./DigestPanel.tsx");

    const askClaudeCalls: Array<[string, unknown]> = [];
    (globalThis as Record<string, unknown>).cowork = {
      askClaude: async (prompt: string, data: unknown) => {
        askClaudeCalls.push([prompt, data]);
        return "Claude result";
      },
    };

    const sentinelPayload = { prompt: "Summarize this corpus.", data: { papers: [] } };
    fake.callServerToolImpl = async () => ({
      content: [{ type: "text", text: JSON.stringify({ askClaude: sentinelPayload }) }],
    });

    await act(async () => {
      createRoot(container).render(
        createElement(DigestPanel, {
          scopeKey: "all",
          digest: null,
          onAction: () => { },
        }),
      );
    });

    // Trigger generateDigest(false) — find "Generate (Ollama)" by text (the first
    // <button> is the "Digest" tab-switcher, not the generator).
    const generateBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Generate (Ollama)"),
    );
    expect(generateBtn).toBeDefined();
    await act(async () => {
      generateBtn!.click();
    });
    await act(async () => { });

    expect(askClaudeCalls[0]).toEqual([sentinelPayload.prompt, sentinelPayload.data]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SA3 — scope_key enum (digest scope contract)
  // Anchor (spec §9.3): "...calls app.callServerTool('digest.generate',
  //   {scope_key})..."; (spec §8.2): scope_key text notNull.
  // ──────────────────────────────────────────────────────────────────────────

  test("SA3 scope_key enum: tool-call args carry scope_key matching the (post-#6) panel-forwardable enum", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { DigestPanel } = await import("./DigestPanel.tsx");

    fake.callServerToolImpl = async () => ({ structuredContent: { body_md: "ok" } });

    // Defect #6 (2026-06-05) scrub: the panel can only forward scopes it can
    // satisfy without selection-state. `stale` (unimplemented) and `selection:`
    // (needs paper_ids the panel doesn't carry) were removed from the advertised
    // enum — forwarding either would only ever produce a fail-closed server error.
    const validScopeKeys = [
      "all",
      "section:introduction",
    ] as const;

    for (const scopeKey of validScopeKeys) {
      const localContainer = document.createElement("div");
      document.body.appendChild(localContainer);
      try {
        await act(async () => {
          createRoot(localContainer).render(
            createElement(DigestPanel, { scopeKey, digest: null, onAction: () => { } }),
          );
        });
        const generateBtn = Array.from(localContainer.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("Generate (Ollama)"),
        );
        await act(async () => {
          generateBtn?.click();
        });
        await act(async () => { });

        const args = fake.callServerToolCalls.at(-1)?.arguments;
        expect(args).toMatchObject({ scope_key: scopeKey });
        expect(args).not.toHaveProperty("since"); // renamed to scope_key
        expect(args).not.toHaveProperty("corpus_id"); // per-corpus ctx.db snapshot
      } finally {
        document.body.removeChild(localContainer);
      }
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // SA4 — use_claude opt-in (mechanical-LLM-default discipline)
  // Anchor (CLAUDE.md / spec §11): "Mechanical LLM → local Ollama ...
  //   cowork.askClaude is an explicit per-request opt-in only — never the default."
  // ──────────────────────────────────────────────────────────────────────────

  test("SA4 default: 'Generate (Ollama)' fires tool call with use_claude=false (or omitted)", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { DigestPanel } = await import("./DigestPanel.tsx");

    fake.callServerToolImpl = async () => ({ structuredContent: { body_md: "ok" } });

    await act(async () => {
      createRoot(container).render(
        createElement(DigestPanel, { scopeKey: "all", digest: null, onAction: () => { } }),
      );
    });

    const generateBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Generate (Ollama)"),
    );
    await act(async () => {
      generateBtn?.click();
    });
    await act(async () => { });

    const args = (fake.callServerToolCalls.at(-1)?.arguments ?? {}) as Record<string, unknown>;
    const uc = args.use_claude;
    expect(uc === false || uc === undefined).toBe(true);
  });

  test("SA4 toggle-on: 'Use Claude instead' button fires tool call with use_claude=true", async () => {
    const { createRoot } = await import("react-dom/client");
    const { createElement, act } = await import("react");
    const { DigestPanel } = await import("./DigestPanel.tsx");

    // Host must be present for the toggle to appear (SA2 discipline).
    (globalThis as Record<string, unknown>).cowork = { askClaude: async () => "Claude result" };

    fake.callServerToolImpl = async () => ({ structuredContent: { body_md: "ok" } });

    await act(async () => {
      createRoot(container).render(
        createElement(DigestPanel, { scopeKey: "all", digest: null, onAction: () => { } }),
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
    await act(async () => { });

    const args = (fake.callServerToolCalls.at(-1)?.arguments ?? {}) as Record<string, unknown>;
    expect(args.use_claude).toBe(true);
  });
});

// src/ui/lib/app.ts
// MCP App SDK wrapper for the Cowork host.
//
// SDK mechanism: OPTION B (property-handler on window.mcp / window.cowork) —
// pinned per spec §line 253 "wires the App SDK lifecycle (`ontoolinput`,
// `ontoolresult`, `onhostcontextchanged`)". The property-style names (no `:`
// separator typical of event names) indicate handler assignment on the global,
// matching the Cowork host's existing window.cowork.askClaude convention.
//
// All getters are SSR-safe: they return undefined / no-op closures when
// window is absent (renderToString context).

export type HostContext = {
  theme?: "light" | "dark";
  cssVars?: Record<string, string>;
};

// View-opener payload shapes. Each view tool emits one of these as its
// structuredContent.view input; App.tsx switches on the `view` field.
export type ViewInput =
  | { view: "dashboard"; corpus_id?: string }
  | { view: "paper"; paper_id: string }
  | { view: "digest"; scope_key: string }
  | { view: "prompts"; paper_id?: string }
  | { view: "progress" };

// askClaude sentinel — spec §11 shape: {prompt, data}. No `reason` field in v1.
export type AskClaudePayload = {
  prompt: string;
  data: unknown;
};

// ── MCP tool call surface ────────────────────────────────────────────────────

export async function callServerTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const mcp = (globalThis as Record<string, unknown>).mcp as
    | { callTool: (name: string, args: unknown) => Promise<unknown> }
    | undefined;
  if (!mcp) throw new Error("MCP App SDK not available in this host");
  return mcp.callTool(name, args);
}

// ── MCP resources/read surface ───────────────────────────────────────────────

export type ReadResourceResult = {
  contents: Array<{ uri?: string; mimeType?: string; text?: string; blob?: string }>;
};

export async function readResource(uri: string): Promise<ReadResourceResult> {
  const mcp = (globalThis as Record<string, unknown>).mcp as
    | { readResource: (params: { uri: string }) => Promise<ReadResourceResult> }
    | undefined;
  if (!mcp) throw new Error("MCP App SDK not available in this host");
  return mcp.readResource({ uri });
}

// ── Cowork host send-to-chat helper ──────────────────────────────────────────

export function sendMessage(content: string): void {
  const mcp = (globalThis as Record<string, unknown>).mcp as
    | { sendMessage?: (content: string) => void }
    | undefined;
  mcp?.sendMessage?.(content);
}

// ── SA2: askClaude capability detect + forward ───────────────────────────────

// SSR-safe: returns false when window is undefined (renderToString context).
export function isAskClaudeAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const cowork = (globalThis as Record<string, unknown>).cowork as
    | { askClaude?: unknown }
    | undefined;
  return typeof cowork?.askClaude === "function";
}

export async function askClaude(payload: AskClaudePayload): Promise<unknown> {
  const cowork = (globalThis as Record<string, unknown>).cowork as
    | { askClaude: (prompt: string, data: unknown) => Promise<unknown> }
    | undefined;
  if (!cowork?.askClaude) throw new Error("cowork.askClaude not available");
  return cowork.askClaude(payload.prompt, payload.data);
}

// ── OPTION B: SDK lifecycle property-handlers ────────────────────────────────
// Spec §line 253: "wires the App SDK lifecycle (ontoolinput, ontoolresult,
// onhostcontextchanged)". Host invokes window.mcp.ontoolinput(input) on each
// tool-input event; our subscriber stores the previous handler and chains.

export function onToolInput(cb: (input: ViewInput) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mcp = (globalThis as Record<string, unknown>).mcp as
    | { ontoolinput?: (input: unknown) => void }
    | undefined;
  if (!mcp) return () => {};
  const prev = mcp.ontoolinput;
  mcp.ontoolinput = (input: unknown) => {
    if (
      typeof input === "object" &&
      input !== null &&
      "view" in (input as Record<string, unknown>)
    ) {
      cb(input as ViewInput);
    }
    prev?.(input);
  };
  return () => {
    mcp.ontoolinput = prev;
  };
}

export function onHostContextChanged(cb: (ctx: HostContext) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mcp = (globalThis as Record<string, unknown>).mcp as
    | { onhostcontextchanged?: (ctx: unknown) => void }
    | undefined;
  if (!mcp) return () => {};
  const prev = mcp.onhostcontextchanged;
  mcp.onhostcontextchanged = (ctx: unknown) => {
    cb(ctx as HostContext);
    prev?.(ctx);
  };
  return () => {
    mcp.onhostcontextchanged = prev;
  };
}

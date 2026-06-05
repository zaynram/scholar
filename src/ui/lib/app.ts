// src/ui/lib/app.ts
// MCP Apps client bridge (§9 conformance amendment, 2026-06-04).
//
// Drives the official @modelcontextprotocol/ext-apps `App` over a
// PostMessageTransport to the host parent frame — the finalized MCP Apps
// protocol (SEP-1865). This REPLACES the retired v1.0 "OPTION B" bridge that
// read host-injected `window.mcp` / `window.cowork` globals; no standard host
// populates those, so the panel was inert end to end.
//
// Carrier: the view discriminant rides each view-opener tool's RESULT
// `structuredContent`, delivered on `app.ontoolresult` — NOT `ontoolinput`
// (which carries only the tool INPUT args). `ontoolresult` for the triggering
// call is a ONE-SHOT event fired right after the `ui/initialize` handshake, so
// initApp() registers handlers BEFORE calling `connect()`; registering after
// races the host and yields a rendered-but-blank panel.
//
// Public surface (consumed by the view components — unchanged shapes):
//   callServerTool(name, args) -> the tool's data payload (structuredContent, or
//                                 the parsed text-JSON block for data tools that
//                                 the registry wrapper leaves text-only)
//   readResource(uri)          -> ReadResourceResult ({contents})
//   sendMessage(text)          -> fire-and-forget chat message
//   isAskClaudeAvailable()     -> host-capability detect (degrades when absent)
//   askClaude(payload)         -> Cowork host fallback (opt-in only)
//   initApp({onView, onHostContext}) -> wire lifecycle; returns cleanup

import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";

export type HostContext = {
  theme?: "light" | "dark";
  cssVars?: Record<string, string>;
};

// View-opener payload shapes. Each view tool emits one of these as its result
// `structuredContent`; App.tsx switches on the `view` field. `digest.scope_key`
// and `prompts.paper_id` are optional — the openers may omit them (view defaults).
export type ViewInput =
  | { view: "dashboard"; corpus_id?: string }
  | { view: "paper"; paper_id: string }
  | { view: "digest"; scope_key?: string }
  | { view: "prompts"; paper_id?: string }
  | { view: "progress" };

// askClaude sentinel — spec §11 shape: {prompt, data}. No `reason` field in v1.
export type AskClaudePayload = {
  prompt: string;
  data: unknown;
};

export type ReadResourceResult = {
  contents: Array<{ uri?: string; mimeType?: string; text?: string; blob?: string }>;
};

// ── App singleton ────────────────────────────────────────────────────────────
// initApp() (called once by App.tsx on mount) constructs and connects the App
// and publishes it here; the call helpers below await readiness before using it.

let _app: App | undefined;
let _ready: Promise<void> | undefined;

async function ensureReady(): Promise<void> {
  if (_ready) await _ready;
}

export type InitAppOptions = {
  onView: (view: ViewInput) => void;
  onHostContext: (ctx: HostContext) => void;
};

function toHostContext(params: unknown): HostContext {
  const p = (params ?? {}) as {
    theme?: "light" | "dark";
    styles?: { variables?: Record<string, string> };
  };
  return { theme: p.theme, cssVars: p.styles?.variables };
}

/**
 * Wire the App lifecycle and return a cleanup function.
 *
 * Ordering is load-bearing: notification handlers are registered BEFORE
 * `connect()` because the host fires the triggering `toolresult` (and the
 * initial `hostcontextchanged`) as one-shot events right after the handshake.
 * After connect resolves, the initial host context snapshot is applied once so
 * theming is correct even without a subsequent change notification.
 */
export function initApp(opts: InitAppOptions): () => void {
  if (typeof window === "undefined") return () => {};

  const app = new App({ name: "scholar-ui", version: "0.1.0" }, {});
  _app = app;

  const onResult = (params: unknown) => {
    const sc = (params as { structuredContent?: Record<string, unknown> })?.structuredContent;
    if (sc && typeof sc === "object" && "view" in sc) {
      opts.onView(sc as unknown as ViewInput);
    }
  };
  const onHostCtx = (params: unknown) => {
    opts.onHostContext(toHostContext(params));
  };

  // Register BEFORE connect — one-shot delivery (see header).
  app.addEventListener("toolresult", onResult);
  app.addEventListener("hostcontextchanged", onHostCtx);

  _ready = app
    .connect(new PostMessageTransport(window.parent, window.parent))
    .then(() => {
      // Apply the initial host-context snapshot from the handshake response.
      const initial = app.getHostContext?.();
      if (initial) opts.onHostContext(toHostContext(initial));
    })
    .catch((e: unknown) => {
      // Surface, don't swallow: a failed connect leaves the panel inert and the
      // operator needs the reason (host not MCP-Apps-capable, transport blocked).
      console.warn("scholar UI: app.connect failed", e);
    });

  return () => {
    app.removeEventListener("toolresult", onResult);
    app.removeEventListener("hostcontextchanged", onHostCtx);
  };
}

// ── MCP tool call surface ────────────────────────────────────────────────────

export async function callServerTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!_app) throw new Error("MCP App SDK not available — initApp() not called");
  await ensureReady();
  const result = (await _app.callServerTool({ name, arguments: args })) as {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
  };
  // View-opener tools return their payload as `structuredContent`; data tools
  // (search, annotations, digest/prompts generate) are left text-only by the
  // registry wrapper, so fall back to parsing the JSON text block. Either way
  // the caller receives the data object directly (preserves the v1.0 contract).
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent;
  }
  const textItem = result.content?.find((c) => c?.type === "text");
  if (textItem?.text != null) {
    try {
      return JSON.parse(textItem.text);
    } catch {
      return textItem.text;
    }
  }
  return result;
}

// ── MCP resources/read surface ───────────────────────────────────────────────

export async function readResource(uri: string): Promise<ReadResourceResult> {
  if (!_app) throw new Error("MCP App SDK not available — initApp() not called");
  await ensureReady();
  return (await _app.readServerResource({ uri })) as ReadResourceResult;
}

// ── host chat helper ─────────────────────────────────────────────────────────

export function sendMessage(content: string): void {
  if (!_app) return;
  const app = _app;
  void ensureReady()
    .then(() => app.sendMessage({ role: "user", content: [{ type: "text", text: content }] }))
    .catch((e: unknown) => console.warn("scholar UI: sendMessage failed", e));
}

// ── askClaude capability detect + forward (Cowork host only; degrades) ────────

// SSR-safe: returns false when window is undefined (renderToString context). On
// a standard Claude Desktop host there is no `cowork` global, so this returns
// false and the UI hides the toggle (§11 Host-capability detection). A
// conformant port onto App.createSamplingMessage is future work, not v1.
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

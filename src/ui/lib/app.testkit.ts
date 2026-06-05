// src/ui/lib/app.testkit.ts
// Shared test double for the @modelcontextprotocol/ext-apps `App` over which
// src/ui/lib/app.ts drives the MCP Apps bridge (§9 amendment 2026-06-04).
//
// Containment: ONLY src/ui/lib/app.ts imports `@modelcontextprotocol/ext-apps`,
// so mock.module of that package is scoped to the UI test set — it never reaches
// the server-side tests (the server bundle hardcodes the profile mime and does
// not import ext-apps). All three UI test files install the SAME factory via
// installExtAppsMock(), so cross-file module caching is benign (identical fake).
import { mock } from "bun:test";

/** Records the registration/connect call order so tests can assert that the
 *  one-shot `toolresult` handler is registered BEFORE `connect()` (else the
 *  triggering notification is missed and the panel renders blank). */
export class FakeApp {
  static instances: FakeApp[] = [];

  /** Ordered op log, e.g. ["addEventListener:toolresult", "addEventListener:hostcontextchanged", "connect"]. */
  log: string[] = [];
  listeners: Record<string, Array<(p: unknown) => void>> = {};
  connected = false;
  sendMessageCalls: unknown[] = [];
  callServerToolCalls: Array<{ name: string; arguments?: unknown }> = [];
  readResourceCalls: Array<{ uri: string }> = [];

  /** Configurable responses — a test sets these on the latest instance. */
  callServerToolImpl: (p: { name: string; arguments?: unknown }) => Promise<unknown> =
    async () => ({ content: [], structuredContent: undefined });
  readServerResourceImpl: (p: { uri: string }) => Promise<unknown> =
    async () => ({ contents: [] });
  hostContext: unknown = undefined;

  constructor(_info?: unknown, _caps?: unknown) {
    FakeApp.instances.push(this);
  }

  addEventListener(ev: string, cb: (p: unknown) => void): void {
    this.log.push(`addEventListener:${ev}`);
    (this.listeners[ev] ??= []).push(cb);
  }
  removeEventListener(ev: string, cb: (p: unknown) => void): void {
    this.listeners[ev] = (this.listeners[ev] ?? []).filter((f) => f !== cb);
  }
  async connect(_transport?: unknown): Promise<void> {
    this.log.push("connect");
    this.connected = true;
  }
  getHostContext(): unknown {
    return this.hostContext;
  }
  async callServerTool(p: { name: string; arguments?: unknown }): Promise<unknown> {
    this.callServerToolCalls.push(p);
    return this.callServerToolImpl(p);
  }
  async readServerResource(p: { uri: string }): Promise<unknown> {
    this.readResourceCalls.push(p);
    return this.readServerResourceImpl(p);
  }
  async sendMessage(p: unknown): Promise<{ isError?: boolean }> {
    this.sendMessageCalls.push(p);
    return {};
  }

  /** Test helper — deliver a notification to every registered listener. */
  fire(ev: string, params: unknown): void {
    for (const cb of [...(this.listeners[ev] ?? [])]) cb(params);
  }
}

export class FakePostMessageTransport {
  constructor(_a?: unknown, _b?: unknown) {}
}

/** Install the ext-apps module mock. Call at top-of-file BEFORE importing
 *  (statically or dynamically) src/ui/lib/app.ts. */
export function installExtAppsMock(): void {
  mock.module("@modelcontextprotocol/ext-apps", () => ({
    App: FakeApp,
    PostMessageTransport: FakePostMessageTransport,
    RESOURCE_MIME_TYPE: "text/html;profile=mcp-app",
  }));
}

/** The most-recently-constructed FakeApp (lib/app.ts builds one per initApp). */
export function latestFakeApp(): FakeApp {
  const a = FakeApp.instances[FakeApp.instances.length - 1];
  if (!a) throw new Error("no FakeApp instance — call initApp() first");
  return a;
}

export function resetFakeApps(): void {
  FakeApp.instances = [];
}

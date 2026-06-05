// src/server/ui/resource.test.ts
// Cycle 6.9 tests for registerUiResource — fills the foundation no-op stub
// with: (a) ui://scholar/app.html serving the single-file React bundle,
// (b) ui://scholar/pdf/<paper_id> serving per-paper PDF bytes via resources/read
// (Task 8b + chore 9d78da3).
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUI } from "^scripts/build-plugin.ts";
import { registerUiResource, viewMeta, APP_URI, MCP_APP_MIME } from "./resource.ts";
import type { ServerContext } from "../tools/registry.ts";

// Minimal ctx mock with a pdf stub. Cycle 6.9 only exercises ctx.pdf for the
// per-paper PDF resource handler; the other ServerContext fields are unused.
const FIXTURE_PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
]); // "%PDF-1.4"

function mockCtxWithPdf(pdfBytes: Uint8Array | null = FIXTURE_PDF_BYTES): ServerContext {
  const openPdf = pdfBytes
    ? async (_paperId: string) => pdfBytes
    : undefined;
  return {
    pdf: {
      openPdf,
      interact: async () => {
        throw new Error("not implemented");
      },
      getText: async () => {
        throw new Error("not implemented");
      },
      currentRoots: () => [],
      setRoots: async () => {},
      isHealthy: () => ({ alive: true, lastOkAt: Date.now(), stdioOpen: true }),
    },
  } as unknown as ServerContext;
}

test("registerUiResource does not throw with the widened (server, ctx) signature", () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  expect(() => registerUiResource(server, mockCtxWithPdf())).not.toThrow();
});

test("ui://scholar/app.html is enumerable and readable via MCP protocol", async () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerUiResource(server, mockCtxWithPdf());

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  const resourceList = await client.listResources();
  const found = resourceList.resources.find((r) => r.uri === "ui://scholar/app.html");
  expect(found).toBeDefined();
  // MCP Apps render gate (§9 amendment 2026-06-04): the host only renders the
  // iframe when the resource is served with the profile mime, not plain text/html.
  expect(found?.mimeType).toBe("text/html;profile=mcp-app");

  const result = await client.readResource({ uri: "ui://scholar/app.html" });
  expect(result.contents).toHaveLength(1);
  const appContent = result.contents[0] as { text?: string; blob?: string; mimeType?: string };
  expect(typeof appContent.text).toBe("string");
  // The read content item carries the profile mime too (content-item value is
  // what the host actually inspects on resources/read).
  expect(appContent.mimeType).toBe("text/html;profile=mcp-app");

  await client.close();
  await server.close();
});

// §9 amendment (2026-06-04): viewMeta builds the tool _meta that links a
// view-opener tool to ui://scholar/app.html. Both the modern nested key and the
// legacy flat key are emitted (hosts must check both — ext-apps registerAppTool
// normalizes the same way). MCP_APP_MIME is the profile mime constant.
test("viewMeta emits both modern and legacy ui resourceUri keys", () => {
  expect(APP_URI).toBe("ui://scholar/app.html");
  expect(MCP_APP_MIME).toBe("text/html;profile=mcp-app");
  expect(viewMeta(APP_URI)).toEqual({
    ui: { resourceUri: APP_URI },
    "ui/resourceUri": APP_URI,
  });
});

// Task 8b: ui://scholar/pdf/<paper_id> URI scheme — per chore 9d78da3.
// scholar.pdf.open returns {success, viewUUID} (a thin proxy) — iframe-PDF
// bytes ride this resources/read channel, NOT scholar.pdf.open. The handler
// (1) returns contents[0].mimeType === "application/pdf"
// (2) returns a non-empty base64 string in contents[0].blob
// (3) the blob decodes back to the original fixture bytes.
test("ui://scholar/pdf/p1 URI resolves to base64-encoded PDF blob via mocked ctx.pdf", async () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerUiResource(server, mockCtxWithPdf());

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  const result = await client.readResource({ uri: "ui://scholar/pdf/p1" });
  expect(result.contents).toHaveLength(1);
  expect(result.contents[0]!.mimeType).toBe("application/pdf");

  const blob = (result.contents[0] as { blob?: string }).blob;
  expect(typeof blob).toBe("string");
  expect(blob!.length).toBeGreaterThan(0);

  // blob must round-trip back to the fixture bytes
  const decoded = Buffer.from(blob!, "base64");
  expect(Array.from(decoded)).toEqual(Array.from(FIXTURE_PDF_BYTES));

  await client.close();
  await server.close();
});

// Task 8b graceful-degrade: when ctx.pdf cannot open the paper (no openPdf or
// error), the handler returns a structured error contents rather than throwing
// an unhandled exception. Either a structured error in contents OR a JSON-RPC
// error response from the SDK is acceptable.
test("ui://scholar/pdf/<paper_id> degrades gracefully when ctx.pdf is unavailable", async () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerUiResource(server, mockCtxWithPdf(null)); // no openPdf method

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);

  try {
    const result = await client.readResource({ uri: "ui://scholar/pdf/p1" });
    // (a) — structured error path
    expect(result.contents).toBeDefined();
    if (result.contents.length > 0) {
      const c = result.contents[0] as {
        blob?: string;
        text?: string;
        mimeType?: string;
      };
      // A structured error contents has text (error message); no blob.
      expect(c.blob).toBeUndefined();
    }
  } catch (e) {
    // (b) — JSON-RPC error path (acceptable)
    expect(e).toBeInstanceOf(Error);
  } finally {
    await client.close();
    await server.close();
  }
});

// ── Real-artifact proof (2026-06-04) ──────────────────────────────────────────
//
// The defect this guards: resource.ts read a DEV-only path (build/ui/app.html,
// which resolves OUTSIDE the plugin root) while the shipped bundle staged Bun's
// multi-file loader (ui/index.html + chunk-*.js). Every shipped bundle served
// the "Scholar UI not built" placeholder — and even had it found the loader, the
// sandboxed MCP-App iframe (SEP-1865) can't fetch sibling chunks. The
// enumerable-and-readable test above stayed green because it only asserts the
// content is a string (the placeholder is also a string) and exercises the dev
// path — the verify-against-the-real-artifact trap, exactly.
//
// This block refuses that trap. It stages the UI through build-plugin's OWN
// buildUI (the exact code the shipped artifact runs) into a bundle-shaped temp
// dir, points CLAUDE_PLUGIN_ROOT at it, and drives a real SDK Client to
// readResource(ui://scholar/app.html). A sentinel injected into the STAGED file
// (absent from the dev build/ui/app.html) proves resolution went through the
// CLAUDE_PLUGIN_ROOT rung of resource.ts's ladder rather than the dev fallback.
//
// Residual leg (named, not run): the NO-env bundle fallback rung
// (`join(import.meta.dir, "..", "ui", "app.html")`) is correct only when
// import.meta.dir = <root>/dist in the real bundle; a source-run test has
// import.meta.dir = src/server/ui (absent), so it is proven by bundle-layout
// reasoning, not exercised here. The shipped manifest always sets
// CLAUDE_PLUGIN_ROOT, so the rung this test pins is the one production uses.
describe("ui://scholar/app.html — real-artifact resolution (CLAUDE_PLUGIN_ROOT ladder)", () => {
  // Injected into the staged ui/app.html ONLY — never present in the dev
  // build/ui/app.html. The discriminator that resolution went through the fixed
  // CLAUDE_PLUGIN_ROOT ladder rung, not the dev fallback.
  const SENTINEL = "<!--__SCHOLAR_STAGED_SENTINEL__-->";

  let stageRoot: string;
  let prevPluginRoot: string | undefined;
  let prevUiHtml: string | undefined;

  beforeAll(async () => {
    stageRoot = mkdtempSync(join(tmpdir(), "scholar-ui-resource-"));
    // Stage the UI exactly as the shipped bundle does — through build-plugin's
    // own buildUI — so this proves the build->serve WIRING, not the helper in
    // isolation (the trap lived precisely in that wiring gap).
    await buildUI(stageRoot); // writes <stageRoot>/ui/app.html (single-file inlined)
    const appHtml = join(stageRoot, "ui", "app.html");
    const staged = (await Bun.file(appHtml).text()) + "\n" + SENTINEL + "\n";
    await Bun.write(appHtml, staged);

    prevPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
    prevUiHtml = process.env.SCHOLAR_UI_HTML;
    delete process.env.SCHOLAR_UI_HTML; // ensure the override rung does not shortcut
    process.env.CLAUDE_PLUGIN_ROOT = stageRoot;
  });

  afterAll(() => {
    if (prevPluginRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = prevPluginRoot;
    if (prevUiHtml === undefined) delete process.env.SCHOLAR_UI_HTML;
    else process.env.SCHOLAR_UI_HTML = prevUiHtml;
    rmSync(stageRoot, { recursive: true, force: true });
  });

  test("readResource serves the staged single-file UI from <root>/ui/app.html (not the dev path, not the placeholder)", async () => {
    const server = new McpServer({ name: "scholar-ui-test", version: "0.0.0" });
    registerUiResource(server, mockCtxWithPdf());

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "ui-resource-test-client", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      const res = await client.readResource({ uri: APP_URI });
      const entry = res.contents[0] as { text?: string; mimeType?: string };
      expect(entry?.mimeType, "must be served with the MCP-App profile mime").toBe(MCP_APP_MIME);
      const html = String(entry?.text ?? "");

      // (a) Resolution went through CLAUDE_PLUGIN_ROOT (the fixed ladder) —
      //     proven by the sentinel only the staged file carries. The old code
      //     ignored CLAUDE_PLUGIN_ROOT and read the dev build/ui/app.html.
      expect(html, "served UI must come from <root>/ui/app.html").toContain(SENTINEL);
      // (b) The real UI, not the "Scholar UI not built" placeholder.
      expect(html).toContain("<title>Scholar</title>");
      expect(html).not.toContain("Scholar UI not built");
      // (c) Self-contained — the discriminator vs the multi-file loader (the
      //     actual defect). Strip inlined module bodies first so JS string
      //     literals like '<link href=' inside the bundle don't false-trigger
      //     the external-ref guards; the closing tags inside those bodies are
      //     escaped to `<\/script>`, so the non-greedy strip stops at the real one.
      const shell = html.replace(/<script type="module">[\s\S]*?<\/script>/g, "");
      expect(shell, "no external <script src> (sandboxed iframe can't fetch chunks)").not.toMatch(
        /<script[^>]*\bsrc=/,
      );
      expect(shell, "no external <link href> (sandboxed iframe can't fetch assets)").not.toMatch(
        /<link[^>]*\bhref=/i,
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});

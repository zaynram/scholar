// src/server/ui/resource.test.ts
// Cycle 6.9 tests for registerUiResource — fills the foundation no-op stub
// with: (a) ui://scholar/app.html serving the single-file React bundle,
// (b) ui://scholar/pdf/<paper_id> serving per-paper PDF bytes via resources/read
// (Task 8b + chore 9d78da3).
import { test, expect } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerUiResource } from "./resource.ts";
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
  expect(found?.mimeType).toBe("text/html");

  const result = await client.readResource({ uri: "ui://scholar/app.html" });
  expect(result.contents).toHaveLength(1);
  expect(typeof result.contents[0]!.text).toBe("string");

  await client.close();
  await server.close();
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

// src/server/ui/resource.ts — cycle 6.9 body fill (frontends plan)
//
// Registers TWO resources:
//   (1) ui://scholar/app.html — single-file React bundle from build/ui/app.html
//   (2) ui://scholar/pdf/{paper_id} — per-paper PDF bytes via ResourceTemplate
//       (chore 9d78da3 + plan-md Task 8b)
//
// LAZY LOAD: HTML is loaded inside the read callback, not at module-load time.
// Avoids module-load failure when build:ui hasn't run (ESM static imports throw
// if the file is absent; lazy Bun.file().text().catch() does not).
//
// scholar.pdf.open returns {success, viewUUID} — iframe-PDF bytes ride the
// resources/read channel here, NOT scholar.pdf.open (extraction-003 lines
// 39, 889-891).

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import type { ServerContext } from "../tools/registry.ts";

export const APP_URI = "ui://scholar/app.html";

// MCP Apps profile mime (SEP-1865). The host only renders a tool's UI iframe
// when the referenced resource is served with this mime — plain "text/html" is
// inert. Mirrors ext-apps' RESOURCE_MIME_TYPE; hardcoded locally so the server
// bundle (dist/server.js) does not pull in the client-side ext-apps package.
export const MCP_APP_MIME = "text/html;profile=mcp-app";

/**
 * Build the `_meta` block that links a view-opener tool to ui://scholar/app.html.
 *
 * Emits BOTH the modern nested key (`_meta.ui.resourceUri`) and the legacy flat
 * key (`_meta["ui/resourceUri"]`) — the MCP Apps spec says hosts must check both,
 * and ext-apps' `registerAppTool` normalizes the same way. Applied inside
 * scholar's own `register` chokepoint (§7.6 snapshot-at-entry wrapper) rather
 * than routing through `registerAppTool`, which would bypass that wrapper.
 */
export function viewMeta(uri: string): Record<string, unknown> {
  return { ui: { resourceUri: uri }, "ui/resourceUri": uri };
}

const PLACEHOLDER_HTML = `<!DOCTYPE html><html><body>
  <p>Scholar UI not built. Run: <code>bun run build:ui</code></p>
</body></html>`;

export function registerUiResource(server: McpServer, ctx: ServerContext): void {
  // ── (1) ui://scholar/app.html ─────────────────────────────────────────────
  server.registerResource(
    "scholar-ui",
    APP_URI,
    { title: "Scholar UI", mimeType: MCP_APP_MIME },
    async (uri) => {
      // Lazy load — no module-load coupling to build:ui artifact.
      const htmlPath = join(
        new URL("../../../build/ui/app.html", import.meta.url).pathname,
      );
      const html = await Bun.file(htmlPath)
        .text()
        .catch((e: NodeJS.ErrnoException) => {
          // Only swallow the "build:ui hasn't run yet" case. Permission errors,
          // IO errors, or anything else should surface — otherwise operators
          // see the placeholder UI and never diagnose the real fault.
          if (e.code === "ENOENT") return PLACEHOLDER_HTML;
          ctx.log?.error?.("scholar.ui.resource: failed to read UI bundle", {
            path: htmlPath,
            err: String(e),
          });
          throw e;
        });
      return {
        contents: [{ uri: uri.href, mimeType: MCP_APP_MIME, text: html }],
      };
    },
  );

  // ── (2) ui://scholar/pdf/{paper_id} ───────────────────────────────────────
  // Per chore 9d78da3 + plan-md Task 8b. ResourceTemplate gives URI-pattern
  // variable capture: the SDK passes `variables.paper_id` to the callback.
  server.registerResource(
    "scholar-pdf",
    new ResourceTemplate("ui://scholar/pdf/{paper_id}", { list: undefined }),
    {
      title: "Scholar paper PDF",
      mimeType: "application/pdf",
    },
    async (uri, variables) => {
      const paperId = String(variables.paper_id ?? "");
      try {
        // Foundation's PdfChild may expose openPdf for byte-read; if not
        // available (older foundation), surface a structured error contents
        // rather than throw — graceful-degrade discipline (Task 8b).
        const childPdf = ctx.pdf as unknown as {
          openPdf?: (paperId: string) => Promise<Uint8Array>;
        };
        if (typeof childPdf.openPdf !== "function") {
          return {
            contents: [
              {
                uri: uri.href,
                mimeType: "text/plain",
                text: `pdf child does not implement openPdf; cannot serve PDF for paper ${paperId}`,
              },
            ],
          };
        }
        const bytes = await childPdf.openPdf(paperId);
        const base64Pdf = Buffer.from(bytes).toString("base64");
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/pdf",
              blob: base64Pdf,
            },
          ],
        };
      } catch (e) {
        ctx.log?.warn?.("scholar.ui.pdf-resource: openPdf failed", {
          paperId,
          err: String(e),
        });
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `failed to open PDF for paper ${paperId}: ${String(e)}`,
            },
          ],
        };
      }
    },
  );
}

// src/server/ui/resource.ts — cycle 6.9 body fill (frontends plan)
//
// Registers TWO resources:
//   (1) ui://scholar/app.html — single-file React bundle, resolved across deploy
//       shapes by resolveUiHtmlPath() (shipped <root>/ui/app.html in a plugin;
//       <repo>/build/ui/app.html in dev)
//   (2) ui://scholar/pdf/{paper_id} — per-paper PDF bytes via ResourceTemplate
//       (chore 9d78da3 + plan-md Task 8b)
//
// LAZY LOAD: the path is resolved + read inside the read callback, not at
// module-load time. Avoids module-load failure when the bundle hasn't been built
// (ESM static imports throw if the file is absent; lazy resolve + Bun.file does
// not). The shipped artifact — not the dev build/ tree — is the truth source:
// see resolveUiHtmlPath()'s CLAUDE_PLUGIN_ROOT-anchored ladder (fixed 2026-06-04;
// the old code read a dev-only path that resolved outside the plugin root).
//
// scholar.pdf.open returns {success, viewUUID} — iframe-PDF bytes ride the
// resources/read channel here, NOT scholar.pdf.open (extraction-003 lines
// 39, 889-891).

import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { existsSync } from "node:fs";
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

/**
 * Resolve the single-file UI bundle (ui/app.html) across deploy shapes,
 * first-existing-wins. Mirrors the CLAUDE_PLUGIN_ROOT-anchored env ladder used
 * by sqlite-vec.ts and pdf/lifecycle.ts — the *shipped* artifact is the truth
 * source, not the dev build/ tree.
 *
 *   1. SCHOLAR_UI_HTML            explicit override (tests / non-standard layout)
 *   2. <CLAUDE_PLUGIN_ROOT>/ui/app.html   the shipped location (manifest always
 *                                 sets CLAUDE_PLUGIN_ROOT — Code plugin + .mcpb)
 *   3. <import.meta.dir>/../ui/app.html   no-env bundle fallback: in the bundle
 *                                 import.meta.dir = <root>/dist, so this is
 *                                 <root>/ui/app.html. Lets the UI load even if a
 *                                 host omits CLAUDE_PLUGIN_ROOT.
 *   4. <repo>/build/ui/app.html   dev fallback (measure-bundle / build:ui output)
 *
 * Returns null when none exist — the caller serves PLACEHOLDER_HTML so operators
 * see "UI not built" rather than a hard error. A path that EXISTS but fails to
 * read (permission/IO) is NOT masked: the caller lets that error surface.
 */
function resolveUiHtmlPath(): string | null {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  const candidates = [
    process.env.SCHOLAR_UI_HTML,
    root ? join(root, "ui", "app.html") : undefined,
    join(import.meta.dir, "..", "ui", "app.html"),
    join(import.meta.dir, "..", "..", "..", "build", "ui", "app.html"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function registerUiResource(server: McpServer, ctx: ServerContext): void {
  // ── (1) ui://scholar/app.html ─────────────────────────────────────────────
  server.registerResource(
    "scholar-ui",
    APP_URI,
    { title: "Scholar UI", mimeType: MCP_APP_MIME },
    async (uri) => {
      // Lazy resolve — no module-load coupling to the build:ui artifact.
      const htmlPath = resolveUiHtmlPath();
      if (htmlPath === null) {
        // Bundle absent on every candidate path → "UI not built" placeholder.
        ctx.log?.warn?.(
          "scholar.ui.resource: UI bundle not found on any candidate path; serving placeholder",
          { root: process.env.CLAUDE_PLUGIN_ROOT ?? null },
        );
        return {
          contents: [{ uri: uri.href, mimeType: MCP_APP_MIME, text: PLACEHOLDER_HTML }],
        };
      }
      const html = await Bun.file(htmlPath)
        .text()
        .catch((e: NodeJS.ErrnoException) => {
          // Found-but-unreadable (permission/IO) is a real fault — surface it
          // rather than masking it as the placeholder, so it gets diagnosed.
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

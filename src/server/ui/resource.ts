// src/server/ui/resource.ts — foundation cycle 6.1 (Task 1.10b scaffold)
//
// Foundation scaffold — body filled by frontends at cycle 6.9 per spec §5.20.
// The body will register `ui://scholar/app.html` and serve the single-file
// React bundle produced by `bun build src/ui/index.html --target=browser`.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../tools/registry.js";

export function registerUiResource(_server: McpServer, _ctx: ServerContext): void {
  // intentionally empty — foundation scaffold; frontends fills body at cycle 6.9
}

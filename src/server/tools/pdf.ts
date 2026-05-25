// src/server/tools/pdf.ts — foundation cycle 6.1 scaffold (Task 1.7)
// Body filled by corpus plan at cycle 6.3 (per splits.xml).
//
// Foundation-009 contract for downstream plans filling this body:
//   - Call `_register(name, def, handler)` (NOT `_server.registerTool(...)` directly)
//     for every tool you register from this module. The foundation-supplied helper
//     both wires the MCP-side stdio handler AND records the handler in the
//     ToolRegistry that scholar's `--call` CLI mode dispatches from.
//   - `handler` is `(args, ctx) => Promise<unknown>`. Throw to signal errors;
//     foundation's CLI dispatcher converts thrown errors with errorCode/message/
//     details shape into structured-error JSON on stderr.
//   - You MAY call `_server.registerResource(...)` directly for non-tool surfaces
//     (the ToolRegistry only tracks tool handlers).
import type { RegisterTools } from "./registry.ts";

export const registerTools: RegisterTools = (_server, _ctx, _register) => {
  // intentionally empty — foundation scaffold.
};

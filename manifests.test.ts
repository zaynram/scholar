// manifests.test.ts — foundation cycle 6.1 (Task 1.11)
//
// Pins plugin manifest + .mcp.json verbatim against spec §7.1.
import { test, expect } from "bun:test";
import pluginManifest from "./.claude-plugin/plugin.json";
import mcpManifest from "./.mcp.json";

test("plugin manifest matches spec §7.1", () => {
  expect(pluginManifest.name).toBe("scholar");
  expect(pluginManifest.license).toBe("MIT");
  expect(pluginManifest.keywords).toContain("literature-review");
});

test(".mcp.json points command at the compiled binary placeholder", () => {
  expect(mcpManifest.mcpServers.scholar.command).toBe("${CLAUDE_PLUGIN_ROOT}/build/scholar");
  expect(mcpManifest.mcpServers.scholar.env.SCHOLAR_OLLAMA_EMBED_MODEL).toBe("nomic-embed-text:v1.5");
  expect(mcpManifest.mcpServers.scholar.env.SCHOLAR_OLLAMA_CHAT_MODEL).toBe("qwen3:8b");
});

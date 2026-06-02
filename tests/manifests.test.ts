import pluginManifest from '^.claude-plugin/plugin.json'
// manifests.test.ts — foundation cycle 6.1 (Task 1.11), amended 2026-06-01.
//
// Pins the dev plugin manifest (`.claude-plugin/plugin.json`, the Linux base
// form). The slim-plugin pivot (docs/superpowers/specs/2026-06-01-slim-plugin-
// pivot.md) SUPERSEDES design-spec §7.1: the manifest no longer points `command`
// at a `bun build --compile` binary (`${CLAUDE_PLUGIN_ROOT}/build/scholar`).
// Launch is now M2 — an always-present shell runs the launcher, which provisions
// bun then execs `dist/server.js`. The `.mcp.json` pinned by the original §7.1
// was removed in 84a292c (mcpServers now live in plugin.json). The per-OS
// GENERATED manifest (cmd.exe on win32, hooks) is produced by
// scripts/build-plugin.ts — covered separately.
import { test, expect } from 'bun:test'

test('plugin manifest matches spec §7.1 (identity fields)', () => {
    expect(pluginManifest.name).toBe('scholar')
    expect(pluginManifest.license).toBe('MIT')
    expect(pluginManifest.keywords).toContain('literature-review')
})

test('mcpServers.scholar uses the M2 shell launcher (pivot supersedes §7.1 compiled-binary command)', () => {
    const scholar = pluginManifest.mcpServers.scholar
    // M2: shell launcher, not the dropped compiled binary.
    expect(scholar.command).toBe('/bin/sh')
    expect(scholar.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/bin/launch.sh'])
    // Ollama model defaults are unchanged by the pivot.
    expect(scholar.env.SCHOLAR_OLLAMA_EMBED_MODEL).toBe('nomic-embed-text:v1.5')
    expect(scholar.env.SCHOLAR_OLLAMA_CHAT_MODEL).toBe('qwen3:8b')
})

test('SessionStart hook pre-warms the bun provisioner (M2 latency optimization)', () => {
    // The hook is a pre-warm only — launch.sh is the correctness gate, because
    // SessionStart does not block MCP spawn. Pin that ensure-bun is invoked.
    const cmd = pluginManifest.hooks?.SessionStart?.[0]?.hooks?.[0]?.command
    expect(cmd).toContain('ensure-bun.sh')
})

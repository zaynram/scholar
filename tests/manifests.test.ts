import pluginManifest from '^.claude-plugin/plugin.json'
// manifests.test.ts — foundation cycle 6.1 (Task 1.11), amended 2026-06-01,
// repivoted 2026-06-05 for source-sync.
//
// Pins the COMMITTED plugin manifest (`.claude-plugin/plugin.json`). The
// source-sync pivot (cowork-marketplace distribution) SUPERSEDES the prior M2
// per-OS shell-launcher form for THIS file: the marketplace installs by
// copy-only and serves one committed manifest to every OS, so the committed
// manifest must use a single cross-OS command. That command is `node`, which
// runs `bin/launch.mjs` — the shim provisions the pinned bun then spawns the
// server from source (auto-installing the reached import graph). The per-OS
// GENERATED manifest used by the built `.plugin`/`.mcpb` bundles (cmd.exe |
// /bin/sh, launch.{cmd,sh}, SCHOLAR_RUNTIME_ROOT pinned per-OS) is produced by
// scripts/build-plugin.ts buildManifest() and covered separately in
// build-plugin.test.ts — changing this committed manifest does NOT affect those
// bundles, because buildManifest rebuilds mcpServers + hooks from scratch.
// (Earlier history: the slim-plugin pivot 2026-06-01 dropped the §7.1 `bun build
// --compile` binary; the §7.1 `.mcp.json` was removed in 84a292c.)
import { test, expect } from 'bun:test'

test('plugin manifest matches spec §7.1 (identity fields)', () => {
    expect(pluginManifest.name).toBe('scholar')
    expect(pluginManifest.license).toBe('MIT')
    expect(pluginManifest.keywords).toContain('literature-review')
})

test('mcpServers.scholar uses the cross-OS node launcher (source-sync supersedes the per-OS shell launcher)', () => {
    const scholar = pluginManifest.mcpServers.scholar
    // Source-sync: `node` is the one command present on every host; it runs the
    // launch.mjs shim (provision bun → spawn server from source).
    expect(scholar.command).toBe('node')
    expect(scholar.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/bin/launch.mjs'])
    // SCHOLAR_RUNTIME_ROOT is NOT pinned in the committed env: launch.mjs derives
    // it cross-OS from CLAUDE_PLUGIN_DATA (the POSIX-only ${HOME} default would
    // break on Windows). Its absence here is the contract, not an oversight.
    expect(scholar.env.SCHOLAR_RUNTIME_ROOT).toBeUndefined()
    // Ollama model defaults are unchanged by the pivot.
    expect(scholar.env.SCHOLAR_OLLAMA_EMBED_MODEL).toBe('nomic-embed-text:v1.5')
    expect(scholar.env.SCHOLAR_OLLAMA_CHAT_MODEL).toBe('qwen3:8b')
})

test('SessionStart hook pre-warms the bun provisioner via the cross-OS shim', () => {
    // The hook is a pre-warm only — launch.mjs (no flag) is the correctness gate,
    // because SessionStart does not block MCP spawn. Here it runs --provision-only
    // so the same shim resolves the sh-vs-powershell provisioner per-OS.
    const cmd = pluginManifest.hooks?.SessionStart?.[0]?.hooks?.[0]?.command
    expect(cmd).toContain('launch.mjs')
    expect(cmd).toContain('--provision-only')
})

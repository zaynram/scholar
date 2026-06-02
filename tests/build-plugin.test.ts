// tests/build-plugin.test.ts — slim-plugin pivot (2026-06-01).
//
// Pins the per-OS M2 manifest the build emits (scripts/build-plugin.ts
// buildManifest). The static dev manifest is pinned by manifests.test.ts; this
// covers the GENERATED output — the launch-model branch (cmd.exe vs /bin/sh),
// the platform runtime root, and the pre-warm hook — which was untested.
import { test, expect } from 'bun:test'
import { buildManifest } from '^scripts/build-plugin.ts'

// Minimal base carrying a leftover compiled-binary `bin` field to prove it is
// stripped, plus identity fields to prove base passthrough.
const base = {
    name: 'scholar',
    license: 'MIT',
    keywords: ['literature-review'],
    bin: { 'mcp-scholar': './bin/mcp-scholar' },
}

test('buildManifest(linux): /bin/sh launcher + HOME runtime root + sh pre-warm', () => {
    const m = buildManifest(base, false) as any
    expect(m.name).toBe('scholar') // base passthrough
    expect(m.bin).toBeUndefined() // compiled-binary leftover stripped
    const s = m.mcpServers.scholar
    expect(s.command).toBe('/bin/sh')
    expect(s.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/bin/launch.sh'])
    expect(s.env.SCHOLAR_RUNTIME_ROOT).toBe('${HOME}/mcp-data/scholar/runtime')
    expect(s.env.SCHOLAR_OLLAMA_EMBED_MODEL).toBe('nomic-embed-text:v1.5')
    expect(s.env.SCHOLAR_OLLAMA_CHAT_MODEL).toBe('qwen3:8b')
    const hook = m.hooks.SessionStart[0].hooks[0].command
    expect(hook).toContain('ensure-bun.sh')
    expect(hook.startsWith('sh ')).toBe(true)
})

test('buildManifest(win32): cmd.exe launcher + USERPROFILE root + PowerShell pre-warm', () => {
    const m = buildManifest(base, true) as any
    expect(m.bin).toBeUndefined()
    const s = m.mcpServers.scholar
    expect(s.command).toBe('cmd.exe')
    expect(s.args).toEqual(['/c', '${CLAUDE_PLUGIN_ROOT}\\bin\\launch.cmd'])
    expect(s.env.SCHOLAR_RUNTIME_ROOT).toBe(
        '${USERPROFILE}\\mcp-data\\scholar\\runtime',
    )
    // Ollama defaults are platform-independent.
    expect(s.env.SCHOLAR_OLLAMA_EMBED_MODEL).toBe('nomic-embed-text:v1.5')
    const hook = m.hooks.SessionStart[0].hooks[0].command
    expect(hook).toContain('ensure-bun.ps1')
    expect(hook).toContain('powershell')
})

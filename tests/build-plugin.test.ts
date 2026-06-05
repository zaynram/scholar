// tests/build-plugin.test.ts — slim-plugin pivot (2026-06-01).
//
// Pins the per-OS M2 manifest the build emits (scripts/build-plugin.ts
// buildManifest). The static dev manifest is pinned by manifests.test.ts; this
// covers the GENERATED output — the launch-model branch (cmd.exe vs /bin/sh),
// the platform runtime root, and the pre-warm hook — which was untested.
import { test, expect } from 'bun:test'
import { buildManifest, buildMcpbManifest } from '^scripts/build-plugin.ts'

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

// ── Claude Desktop .mcpb manifest ─────────────────────────────────────────────
// Unit-pins buildMcpbManifest. `mcpb validate` (run during SCHOLAR_PACKAGE=mcpb
// build) is the authoritative schema gate; this guards the load-bearing
// launcher-alias contract the validator can't see — that the env block aliases
// the two vars launch.cmd + ensure-bun.ps1 read (CLAUDE_PLUGIN_ROOT := ${__dirname},
// CLAUDE_PLUGIN_DATA := ${user_config.data_dir}) so the win32 launch chain runs
// byte-identical to the Claude Code plugin.
test('buildMcpbManifest: base metadata passthrough + version', () => {
    const m = buildMcpbManifest(base, '0.1.0') as any
    expect(m.manifest_version).toBe('0.2') // broadly-compatible mcpb default
    expect(m.name).toBe('scholar') // base passthrough
    expect(m.license).toBe('MIT')
    expect(m.keywords).toEqual(['literature-review'])
    expect(m.version).toBe('0.1.0')
    expect(m.bin).toBeUndefined() // base `bin` leftover not carried into mcpb shape
})

test('buildMcpbManifest: cmd.exe/launch.cmd entry under type:binary, no relaunch of /bin/sh', () => {
    const m = buildMcpbManifest(base, '0.1.0') as any
    expect(m.server.type).toBe('binary')
    expect(m.server.entry_point).toBe('bin/launch.cmd')
    expect(m.server.mcp_config.command).toBe('cmd.exe')
    expect(m.server.mcp_config.args).toEqual(['/c', '${__dirname}\\bin\\launch.cmd'])
    expect(m.compatibility.platforms).toEqual(['win32'])
})

test('buildMcpbManifest: env aliases the two vars the launcher reads (no launcher edit)', () => {
    const env = (buildMcpbManifest(base, '0.1.0') as any).server.mcp_config.env
    // launch.cmd reads %CLAUDE_PLUGIN_ROOT% + %CLAUDE_PLUGIN_DATA%; ensure-bun.ps1
    // reads $env:CLAUDE_PLUGIN_DATA. Aliasing both is what lets the launcher run
    // unmodified under Claude Desktop.
    expect(env.CLAUDE_PLUGIN_ROOT).toBe('${__dirname}')
    expect(env.CLAUDE_PLUGIN_DATA).toBe('${user_config.data_dir}')
    expect(env.SCHOLAR_RUNTIME_ROOT).toBe('${user_config.data_dir}\\runtime')
    expect(env.SCHOLAR_OLLAMA_EMBED_MODEL).toBe('${user_config.ollama_embed_model}')
    // escape hatches stay unset — their defaults derive from CLAUDE_PLUGIN_ROOT /
    // process.execPath, both correct in the bundle.
    expect(env.SCHOLAR_BUN_PATH).toBeUndefined()
    expect(env.SCHOLAR_VEC0_PATH).toBeUndefined()
    expect(env.SCHOLAR_PDF_ENTRYPOINT).toBeUndefined()
})

test('buildMcpbManifest: required user_config with directory data_dir', () => {
    const uc = (buildMcpbManifest(base, '0.1.0') as any).user_config
    expect(uc.data_dir.type).toBe('directory')
    expect(uc.data_dir.required).toBe(true)
    expect(uc.ollama_url.type).toBe('string')
    // every option carries a description (mcpb schema requires it)
    for (const key of Object.keys(uc)) expect(typeof uc[key].description).toBe('string')
})

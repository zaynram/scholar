import pluginManifest from '^.claude-plugin/plugin.json'
// manifests.test.ts — foundation cycle 6.1 (Task 1.11), amended 2026-06-01,
// repivoted 2026-06-05 for source-sync.
//
// Pins the COMMITTED plugin manifest (`.claude-plugin/plugin.json`). The
// source-sync pivot (cowork-marketplace distribution) SUPERSEDES the prior M2
// per-OS shell-launcher form for THIS file: the marketplace installs by
// copy-only and serves one committed manifest to every OS, so the committed
// manifest must use a single cross-OS command. That command is `bun` (the
// system-wide runtime these servers already depend on — and the replacement for
// the now-removed "use bundled node" Claude Desktop option), which runs
// `bin/launch.mjs`: the shim provisions the pinned bun then spawns the server
// from source (auto-installing the reached import graph). The per-OS GENERATED
// manifest used by the built `.plugin`/`.mcpb` bundles runs the SAME
// `bun bin/launch.mjs` launcher; it differs only in pinning SCHOLAR_RUNTIME_ROOT
// per-OS and shipping the matching ensure-bun provisioner. It is produced by
// scripts/build-plugin.ts buildManifest() and covered separately in
// build-plugin.test.ts — changing this committed manifest does NOT affect those
// bundles, because buildManifest rebuilds mcpServers + hooks from scratch.
// (Earlier history: the launcher was a per-OS shell pair (cmd.exe/launch.cmd |
// /bin/sh/launch.sh) until the 2026-06-05 bun-unification; the slim-plugin pivot
// 2026-06-01 dropped the §7.1 `bun build --compile` binary; the §7.1 `.mcp.json`
// was removed in 84a292c.)
import { test, expect } from 'bun:test'

test('plugin manifest matches spec §7.1 (identity fields)', () => {
    expect(pluginManifest.name).toBe('scholar')
    expect(pluginManifest.license).toBe('MIT')
    expect(pluginManifest.keywords).toContain('literature-review')
})

test('mcpServers.scholar uses the cross-OS bun launcher (source-sync supersedes the per-OS shell launcher)', () => {
    const scholar = pluginManifest.mcpServers.scholar
    // Source-sync: `bun` is the one command present on every host (the systemwide
    // bun install these servers already depend on); it runs the launch.mjs shim
    // (provision pinned bun → spawn server from source).
    expect(scholar.command).toBe('bun')
    expect(scholar.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/bin/launch.mjs'])
    // SCHOLAR_RUNTIME_ROOT is NOT pinned in the committed env: launch.mjs derives
    // it cross-OS from CLAUDE_PLUGIN_DATA (the POSIX-only ${HOME} default would
    // break on Windows). Its absence here is the contract, not an oversight.
    // Key-dynamic access: TS infers the committed env type WITHOUT this key, so a
    // direct `.SCHOLAR_RUNTIME_ROOT` is a compile error — which is itself the proof
    // it's absent. Cast to a record to assert that absence at runtime too.
    expect((scholar.env as Record<string, string | undefined>).SCHOLAR_RUNTIME_ROOT).toBeUndefined()
    // Ollama model defaults are unchanged by the pivot.
    expect(scholar.env.SCHOLAR_OLLAMA_EMBED_MODEL).toBe('nomic-embed-text:v1.5')
    expect(scholar.env.SCHOLAR_OLLAMA_CHAT_MODEL).toBe('qwen3:8b')
})

test('SessionStart pre-warm is scoped to the startup matcher (not Setup, not every trigger)', () => {
    // The hook is a pre-warm only — launch.mjs (no flag) is the correctness gate,
    // because SessionStart does not block MCP spawn. Here it runs --provision-only
    // so the same shim resolves the sh-vs-powershell provisioner per-OS.
    //
    // Scoped to `startup`: provisioning the pinned bun into CLAUDE_PLUGIN_DATA is a
    // first-session concern, so it must NOT re-fire on resume/clear/compact (the
    // bun already exists by then). The docs prescribe the SessionStart-into-
    // CLAUDE_PLUGIN_DATA *mechanism* ("install a dependency once, reuse across
    // sessions and updates") but their example is UNSCOPED, guarding idempotency
    // with an in-hook `diff`. The `startup` narrowing is scholar's OWN call, not a
    // doc prescription: ensure-bun is already idempotent + flock-guarded and
    // launch.mjs (no flag) is the real correctness gate, so re-firing on
    // resume/clear/compact buys nothing. The `Setup` event is deliberately NOT
    // used: it fires only on explicit `claude --init-only` / `-p --init|--maintenance`
    // ("for one-time preparation in CI or scripts"), never on install or normal
    // startup — so it would skip the pre-warm for normal users entirely.
    const group = pluginManifest.hooks?.SessionStart?.[0]
    expect(group?.matcher).toBe('startup')
    const cmd = group?.hooks?.[0]?.command
    expect(cmd).toContain('launch.mjs')
    expect(cmd).toContain('--provision-only')
})

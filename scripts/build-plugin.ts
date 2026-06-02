// scripts/build-plugin.ts
//
// Slim-plugin build orchestrator. See docs/superpowers/specs/2026-06-01-slim-
// plugin-pivot.md. Produces a per-OS scholar.plugin archive that ships only:
//   - dist/server.js                  scholar server, `bun build --target=bun` (no --compile)
//   - dist/pdf-server/{index.js,mcp-app.html}   pdf-server@1.7.2 rebundled standalone
//   - build/vendor/sqlite-vec/vec0.<ext>        platform vec0 (so | dll)
//   - ui/index.html                   single-file UI bundle
//   - nu/scholar.nu                   nu CLI module
//   - bin/<launcher set>              M2 launcher + ensure-bun provisioner
//   - .claude-plugin/plugin.json      GENERATED per-OS (M2 command/args + hooks)
//   - skills/**
// The bun runtime is NOT shipped — it is provisioned into ${CLAUDE_PLUGIN_DATA}
// by ensure-bun at first launch. No compiled binary, no bundled runtime.
//
// Run:        bun scripts/build-plugin.ts            (Windows target, default)
// Linux pkg:  SCHOLAR_BUILD_WIN=0 bun scripts/build-plugin.ts

import util, { OUTPUT } from './util'
import { zipSync } from 'fflate'
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    copyFileSync,
    rmSync,
} from 'node:fs'
import { join, relative } from 'node:path'

const WIN = process.env.SCHOLAR_BUILD_WIN !== '0'
const NAME = WIN ? 'win32' : 'linux'
const VEC0_EXT = WIN ? 'dll' : 'so'
const DIR = util.subpath('build', NAME) // staging tree — an exact mirror of the package

// ── Version invariant ─────────────────────────────────────────────────────────
// bundledBunVersion (the bun release ensure-bun provisions) and bunSqliteVersion
// (the SQLite the vec0 ABI targets) must both be populated. Different facts about
// the same release; both load-bearing for the pinned-runtime / vec0 ABI contract.
function readPkg(): {
    scholar?: { bundledBunVersion?: string; bunSqliteVersion?: string }
} {
    return JSON.parse(readFileSync(util.subpath('package.json'), 'utf8'))
}
function assertVersionInvariant(): void {
    const s = readPkg().scholar ?? {}
    if (!s.bundledBunVersion?.trim() || !s.bunSqliteVersion?.trim())
        util.abort(
            'SCHOLAR_BUILD_MISMATCH',
            'package.json missing scholar.bundledBunVersion or scholar.bunSqliteVersion ' +
                `(got ${JSON.stringify(s)}).`
        )
}

// ── Bundle scholar server (platform-neutral) ──────────────────────────────────
async function buildServer(): Promise<void> {
    await util.sh`tsc --noEmit`
    await util.sh`bun build src/server/index.ts --target=bun --outfile ${join(DIR, 'dist', 'server.js')}`
}

// ── Rebundle pdf-server standalone (pdfjs inlined) + its mcp-app.html ──────────
async function buildPdf(): Promise<void> {
    const out = join(DIR, 'dist', 'pdf-server', 'index.js')
    await util.sh`bun build src/vendor/pdf-server/dist/index.js --target=bun --outfile ${out}`
    copyFileSync(
        util.subpath('src', 'vendor', 'pdf-server', 'dist', 'mcp-app.html'),
        join(DIR, 'dist', 'pdf-server', 'mcp-app.html')
    )
}

// ── UI single-file bundle ─────────────────────────────────────────────────────
async function buildUI(): Promise<void> {
    process.env.UI_OUTDIR = join(DIR, 'ui')
    mkdirSync(process.env.UI_OUTDIR, { recursive: true })
    await util.sh`bun run build:ui`.env(process.env)
}

// ── vec0 shared library (per-OS) ──────────────────────────────────────────────
// Linux dev: copy the prebuilt from the installed sqlite-vec-linux-x64 package.
// Windows target: fetch the prebuilt vec0.dll from the sqlite-vec-windows-x64 npm
//   tarball at the SAME version (no mingw cross-compile). The dll cannot be
//   ABI-probed on Linux — the pinned-bun load gate runs on the target.
async function stageVec0(): Promise<void> {
    const dest = join(DIR, 'build', 'vendor', 'sqlite-vec', `vec0.${VEC0_EXT}`)
    mkdirSync(join(DIR, 'build', 'vendor', 'sqlite-vec'), { recursive: true })
    const ver = JSON.parse(
        readFileSync(util.subpath('node_modules', 'sqlite-vec-linux-x64', 'package.json'), 'utf8')
    ).version as string

    if (!WIN) {
        const src = util.subpath('node_modules', 'sqlite-vec-linux-x64', 'vec0.so')
        if (!existsSync(src))
            util.abort('SCHOLAR_BUILD_VEC_MISSING', `linux vec0 prebuilt absent: ${src}`)
        copyFileSync(src, dest)
        // ABI probe is cheap on the dev host — fail fast on a bad pin.
        const { probeVec0Abi } = await import('./build-vec0')
        if (!probeVec0Abi(dest))
            util.abort(
                'SCHOLAR_BUILD_VEC_ABI',
                `vec0.so failed ABI probe under bun ${Bun.version} (SQLite mismatch).`
            )
        return
    }

    const cache = util.subpath('build', '.cache', `sqlite-vec-windows-x64-${ver}`)
    const dll = join(cache, 'package', 'vec0.dll')
    if (!existsSync(dll)) {
        mkdirSync(cache, { recursive: true })
        const url = `https://registry.npmjs.org/sqlite-vec-windows-x64/-/sqlite-vec-windows-x64-${ver}.tgz`
        const res = await fetch(url)
        if (!res.ok)
            util.abort('SCHOLAR_BUILD_VEC_FETCH', `fetch ${url} -> HTTP ${res.status}`)
        const tgz = join(cache, 'pkg.tgz')
        await Bun.write(tgz, await res.arrayBuffer())
        await util.sh`tar xzf ${tgz} -C ${cache}`
    }
    if (!existsSync(dll))
        util.abort('SCHOLAR_BUILD_VEC_MISSING', `windows vec0.dll not extracted at ${dll}`)
    copyFileSync(dll, dest)
}

// ── nu module + per-OS launcher set ───────────────────────────────────────────
function stageBin(): void {
    mkdirSync(join(DIR, 'bin'), { recursive: true })
    mkdirSync(join(DIR, 'nu'), { recursive: true })
    const nu = existsSync(util.subpath('nu', 'scholar.nu'))
        ? util.subpath('nu', 'scholar.nu')
        : util.subpath('bin', 'scholar.nu')
    copyFileSync(nu, join(DIR, 'nu', 'scholar.nu'))
    const launchers = WIN
        ? ['launch.cmd', 'ensure-bun.ps1']
        : ['launch.sh', 'ensure-bun.sh']
    for (const f of launchers)
        copyFileSync(util.subpath('bin', f), join(DIR, 'bin', f))
}

// ── Generate the per-OS plugin.json (M2 launch + pre-warm hook) ────────────────
// Pure construction (exported for build-plugin.test.ts): given the base dev
// manifest, produce the per-OS M2 manifest. win=true → cmd.exe/launch.cmd +
// PowerShell pre-warm; win=false → /bin/sh/launch.sh + sh pre-warm. The `bin`
// field (compiled-binary leftover) is stripped. No I/O — generateManifest wraps
// this with the read/write so the launch-model logic is unit-testable.
export function buildManifest(
    base: Record<string, unknown>,
    win: boolean,
): Record<string, unknown> {
    const ROOT = '${CLAUDE_PLUGIN_ROOT}'
    const runtimeRoot = win
        ? '${USERPROFILE}\\mcp-data\\scholar\\runtime'
        : '${HOME}/mcp-data/scholar/runtime'
    const command = win ? 'cmd.exe' : '/bin/sh'
    const args = win ? ['/c', `${ROOT}\\bin\\launch.cmd`] : [`${ROOT}/bin/launch.sh`]

    const manifest = {
        ...base,
        mcpServers: {
            scholar: {
                command,
                args,
                env: {
                    SCHOLAR_RUNTIME_ROOT: runtimeRoot,
                    SCHOLAR_OLLAMA_URL: 'http://127.0.0.1:11434',
                    SCHOLAR_OLLAMA_EMBED_MODEL: 'nomic-embed-text:v1.5',
                    SCHOLAR_OLLAMA_CHAT_MODEL: 'qwen3:8b',
                },
            },
        },
        // Pre-warm: start provisioning early. SessionStart does NOT block MCP
        // spawn, so this is a latency optimization only — launch.{sh,cmd} is the
        // correctness gate. ensure-bun is idempotent + lock-guarded.
        hooks: {
            SessionStart: [
                {
                    hooks: [
                        {
                            type: 'command',
                            command: win
                                ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${ROOT}\\bin\\ensure-bun.ps1"`
                                : `sh "${ROOT}/bin/ensure-bun.sh"`,
                        },
                    ],
                },
            ],
        },
    }
    delete (manifest as { bin?: unknown }).bin
    return manifest
}

function generateManifest(): void {
    const base = JSON.parse(readFileSync(util.subpath('.claude-plugin', 'plugin.json'), 'utf8'))
    const manifest = buildManifest(base, WIN)
    mkdirSync(join(DIR, '.claude-plugin'), { recursive: true })
    Bun.write(join(DIR, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2))
}

// ── Skills ────────────────────────────────────────────────────────────────────
function stageSkills(): void {
    const src = util.subpath('skills')
    if (!existsSync(src)) return
    cpDir(src, join(DIR, 'skills'))
}
function cpDir(from: string, to: string): void {
    mkdirSync(to, { recursive: true })
    for (const e of readdirSync(from, { withFileTypes: true })) {
        const s = join(from, e.name)
        const d = join(to, e.name)
        if (e.isDirectory()) cpDir(s, d)
        else copyFileSync(s, d)
    }
}

// ── Assemble + zip the staging tree ───────────────────────────────────────────
function collectFiles(base: string, acc: string[] = []): string[] {
    for (const e of readdirSync(base, { withFileTypes: true })) {
        const p = join(base, e.name)
        if (e.isDirectory()) collectFiles(p, acc)
        else acc.push(p)
    }
    return acc
}
async function assemble(): Promise<void> {
    const files = collectFiles(DIR)
    const fileMap: Record<string, Uint8Array> = {}
    for (const abs of files)
        fileMap[relative(DIR, abs).split('\\').join('/')] = new Uint8Array(readFileSync(abs))

    const required = [
        '.claude-plugin/plugin.json',
        'dist/server.js',
        'dist/pdf-server/index.js',
        'dist/pdf-server/mcp-app.html',
        `build/vendor/sqlite-vec/vec0.${VEC0_EXT}`,
        WIN ? 'bin/launch.cmd' : 'bin/launch.sh',
    ]
    const missing = required.filter(r => !(r in fileMap))
    if (missing.length)
        util.abort('SCHOLAR_BUILD_MISSING_ARTIFACT', `missing: ${missing.join(', ')}`)

    const zipped = zipSync(fileMap, { level: 6 })
    mkdirSync(OUTPUT, { recursive: true })
    const out = join(OUTPUT, 'scholar.plugin')
    await Bun.write(out, zipped)
    const mb = (zipped.length / 1024 / 1024).toFixed(1)
    process.stdout.write(`scholar.plugin (${NAME}, ${mb} MB, ${files.length} files) -> ${out}\n`)

    const staging = process.env.COWORK_PLUGINS_DIR
    if (staging) {
        try {
            mkdirSync(staging, { recursive: true })
            await Bun.write(join(staging, 'scholar.plugin'), zipped)
            process.stdout.write(`also copied to staging: ${staging}\n`)
        } catch (e) {
            process.stderr.write(`warn: COWORK_PLUGINS_DIR copy failed: ${(e as Error).message}\n`)
        }
    }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    process.stdout.write(`[scholar] slim plugin build (${NAME})\n`)
    rmSync(DIR, { recursive: true, force: true })
    mkdirSync(DIR, { recursive: true })
    assertVersionInvariant()
    await buildServer()
    await buildPdf()
    await buildUI()
    await stageVec0()
    stageBin()
    generateManifest()
    stageSkills()
    await assemble()
    process.stdout.write(`[scholar] build complete\n`)
}

if (import.meta.main)
    main().catch(async e => {
        process.stderr.write(`unhandled build error: ${String(e)}\n`)
        process.exit(1)
    })

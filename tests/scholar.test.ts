import util, { ROOT } from '^scripts/util'
import env from '^scripts/util/env'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// nu/scholar.test.ts
// Red/Green tests for cycle 6.10 — nu module behavior + structural anchors.
//
// Tests split into two groups:
//   1. nu-spawn tests (skip if nu not on PATH) — exercise the actual module
//   2. grep tests (always run) — pin tool-name references in source
//
// Grep tests fail at Red phase (file not yet created). nu-spawn tests skip
// or fail with "Cannot find module" at Red phase.
import { test, expect } from 'bun:test'

const SCRIPT_PATH = util.subpath('bin', 'scholar.nu')
const SCRIPT_FILE = Bun.file(SCRIPT_PATH)
const SCRIPT_TEXT = await SCRIPT_FILE.text()

const ESEP = env.dynamic({ win32: ';', default: ':' })
const PATH = [util.subpath('bin'), ...(process.env.PATH ?? '').split(ESEP)].join(ESEP)

if (!Bun.which('nu')) {
    await Bun.stderr.write('WARNING: nu not on PATH — running minimal grep suite')
    test('scholar.nu references scholar.papers.search', async () => {
        expect(SCRIPT_TEXT).toContain('scholar.papers.search')
    })
    test('scholar.nu references scholar.corpus.status', async () => {
        expect(SCRIPT_TEXT).toContain('scholar.corpus.status')
    })
    test('scholar.nu references scholar.ingest', async () => {
        expect(SCRIPT_TEXT).toContain('scholar.ingest')
    })
    test('scholar.nu references scholar.digest.generate', async () => {
        expect(SCRIPT_TEXT).toContain('scholar.digest.generate')
    })
    process.exit(0)
}

interface ScriptOptions {
    pipe?: object | 'null'
    path?: string[]
    vars?: Record<string, string>
    args?: string[]
}

function runScript(
    { pipe = 'null', path = [], vars = {}, args = [] }: ScriptOptions = {},
    ...lines: string[]
): Bun.$.ShellPromise {
    const script: string[] = [
        JSON.stringify(pipe),
        `| to json --raw`,
        `| ^bin/scholar.nu ${args.join(' ')}`,
        ...lines,
    ]
    return Bun.$`nu --commands ${script.join('\n')};`
        .cwd(ROOT)
        .env({ ...process.env, PATH: [...path, PATH].join(ESEP), ...vars })
        .quiet()
}

test('module parses without errors', async () =>
    await runScript({}, 'echo ok').then(output =>
        expect(output.text().trim()).toBe('ok')
    ))

test('scholar subcommands are all defined', async () =>
    await Promise.all(
        ['list', 'status', 'ingest', 'query', 'digest'].map(
            async subcommand =>
                await runScript({ args: [subcommand, '--help'] })
                    .text()
                    .then(text => expect(text).not.toMatch(/Error:/))
        )
    ))

// Transport argv-shape test (M2): the slim pivot dropped the compiled
// `mcp-scholar` binary, so the nu wrapper now invokes the server via the
// SCHOLAR_SERVER_CMD seam. Foundation-007 contract is unchanged: the server
// receives `--call <tool> <json>`. The stub RECORDS argv to a file the test
// reads back — asserting inside the stub is ineffective because nu's `complete`
// swallows the stub's exit code, so a bad invocation would not fail the test.
test('scholar transport invokes the server with --call <tool> <json> (M2)', async () => {
    const stubDir = '/tmp/scholar-nu-transport'
    await Bun.$`mkdir -p ${stubDir}`.quiet()
    const stub = `${stubDir}/stub-server.ts`
    const argvFile = `${stubDir}/argv.json`
    await Bun.write(
        stub,
        [
            `import { writeFileSync } from 'node:fs'`,
            `writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)))`,
        ].join('\n')
    )
    try {
        await runScript({
            pipe: { slug: 'test' },
            args: ['corpus.activate'],
            vars: { SCHOLAR_SERVER_CMD: `bun ${stub}` },
        })
        const argv = JSON.parse(await Bun.file(argvFile).text())
        expect(argv).toEqual([
            '--call',
            'corpus.activate',
            JSON.stringify({ slug: 'test' }),
        ])
    } finally {
        await Bun.$`rm -rf ${stubDir}`.quiet().catch(() => {})
    }
})

// Production-resolution test (M2): with NO SCHOLAR_SERVER_CMD override and NO
// CLAUDE_PLUGIN_DATA, `server-cmd` must resolve the server bundle from the
// module's own location — `path self → dirname → dirname` = plugin root, then
// `dist/server.js` — and fall back to a PATH `bun`. The override-driven test
// above never exercises this branch; this one lays the real <root>/nu +
// <root>/dist layout in a temp dir and confirms the SELF-relative resolution
// reaches the bundle. (Verified by execution, not construction — see the
// repeated override-only blind spot the slim pivot repoint nearly repeated.)
test('server-cmd resolves dist/server.js relative to the module (M2 production path, no override)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'scholar-nu-prod-'))
    try {
        mkdirSync(join(tmp, 'nu'))
        mkdirSync(join(tmp, 'dist'))
        await Bun.write(join(tmp, 'nu', 'scholar.nu'), SCRIPT_TEXT)
        const argvFile = join(tmp, 'argv.json')
        // argv-echo stub at the SELF-relative dist/server.js the module computes.
        await Bun.write(
            join(tmp, 'dist', 'server.js'),
            [
                `import { writeFileSync } from 'node:fs'`,
                `writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)))`,
            ].join('\n')
        )
        // Strip both seams so the production branch + PATH-bun fallback run.
        const cleanEnv: Record<string, string | undefined> = { ...process.env, PATH }
        delete cleanEnv.SCHOLAR_SERVER_CMD
        delete cleanEnv.CLAUDE_PLUGIN_DATA
        await Bun.$`nu ${join(tmp, 'nu', 'scholar.nu')} corpus.activate --json ${JSON.stringify({ slug: 'test' })}`
            .env(cleanEnv)
            .quiet()
            .nothrow()
        const argv = JSON.parse(await Bun.file(argvFile).text())
        expect(argv).toEqual([
            '--call',
            'corpus.activate',
            JSON.stringify({ slug: 'test' }),
        ])
    } finally {
        rmSync(tmp, { recursive: true, force: true })
    }
})

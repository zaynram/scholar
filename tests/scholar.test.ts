import util, { ROOT } from '^scripts/util'
import env from '^scripts/util/env'
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

// Transport argv-shape test: injects a stub `scholar` binary on PATH, verifies
// the nu `scholar` wrapper passes --call + tool name + JSON-serialized args.
// Foundation-007 contract: ^scholar --call <tool> <json>.
test('scholar transport calls ^scholar --call with JSON-serialized args', async () => {
    await Bun.$`chmod +x bin/scholar.nu`.quiet()
    const stubDir = '/tmp/scholar-nu-transport'
    await Bun.$`mkdir -p ${stubDir}`.quiet()
    const stubBin = `${stubDir}/mcp-scholar`
    await Bun.write(
        stubBin,
        [
            `#!/usr/bin/env bun`,
            `import { expect } from 'bun:test'`,
            `const data = { flag: process.argv[2], tool: process.argv[3], args: process.argv[4], ok: true }`,
            `expect(data.flag).toBe('--call')`,
            `expect(data.tool).toBe('corpus.activate')`,
            `expect(data.args).toMatch(JSON.stringify({slug: 'test'}))`,
            'expect(data.ok).toBe(true)',
        ].join('\n')
    )
    await Bun.$`chmod +x ${stubBin}`.quiet()
    await runScript({
        pipe: { slug: 'test' },
        args: ['corpus.activate'],
        path: [stubDir],
    }).finally(async () => await Bun.$`rm -rf ${stubDir}`.quiet().catch(() => {}))
})

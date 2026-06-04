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

// Parse-health: `--help` forces nu to parse the module and resolve `main`
// without running a tool, and exits 0. (The old form ran the module with no
// args, which is now a runtime error since `tool` is a required positional —
// that asserts no-arg behavior, not that the module parses.)
test('module parses without errors', async () =>
    await runScript({ args: ['--help'] })
        .text()
        .then(text => expect(text).not.toMatch(/Error:/)))

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
        // `resolve bun` reads <root>/package.json for the pinned bundledBunVersion.
        // Mirror the production layout (package.json beside dist/) and pin to the
        // running bun so resolution uses PATH bun directly — exercising the real
        // self-relative resolve js/bun branch without a bunx fetch.
        await Bun.write(
            join(tmp, 'package.json'),
            JSON.stringify({ scholar: { bundledBunVersion: Bun.version } })
        )
        // Strip both seams so the production branch + PATH-bun fallback run.
        const cleanEnv: Record<string, string | undefined> = { ...process.env, PATH }
        delete cleanEnv.SCHOLAR_SERVER_CMD
        delete cleanEnv.CLAUDE_PLUGIN_DATA
        // json is a positional arg now (the `--json` flag was dropped in the refactor).
        await Bun.$`nu ${join(tmp, 'nu', 'scholar.nu')} corpus.activate ${JSON.stringify({ slug: 'test' })}`
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

// Regression (stream isolation): the server writes its JSON result to stdout and
// structured logs to stderr. `main` must parse stdout alone — an earlier refactor
// used `out+err>| complete`, which merged a stderr log line into the parsed value
// and threw json_decode_error on any call where the server logged (e.g. the
// pdf-stub warn on a fresh corpus.activate). A stub that logs to stderr AND emits
// a JSON result on stdout reproduces it: pre-fix this errors, post-fix it parses.
test('main parses stdout JSON even when the server logs to stderr (no out+err merge)', async () => {
    const stubDir = mkdtempSync(join(tmpdir(), 'scholar-nu-stderr-'))
    try {
        // Stub server: a log line on stderr (like ctx.log.*) + the JSON result on
        // stdout. Markers let us assert across the external (table-rendering)
        // boundary: the stdout payload must flow through; the stderr line must not.
        const stub = join(stubDir, 'log-server.ts')
        await Bun.write(
            stub,
            [
                `process.stderr.write('SCHOLAR_STDERR_LOG_LINE\\n')`,
                `process.stdout.write(JSON.stringify({ ok: true, marker: 'SCHOLAR_STDOUT_MARKER' }) + '\\n')`,
            ].join('\n')
        )
        // Pre-fix (`out+err>| complete`) the stderr line merged into stdout and
        // `from json` threw json_decode_error → non-zero exit → `.text()` rejects.
        const out = await runScript({
            pipe: { slug: 'x' },
            args: ['scholar.papers.search'],
            vars: { SCHOLAR_SERVER_CMD: `bun ${stub}` },
        }).text()
        expect(out).toContain('SCHOLAR_STDOUT_MARKER') // stdout JSON parsed + returned
        expect(out).not.toContain('SCHOLAR_STDERR_LOG_LINE') // stderr stayed isolated
    } finally {
        rmSync(stubDir, { recursive: true, force: true })
    }
})

// Regression (stdout preamble): the production path resolves the pinned bun via
// `bunx bun@<pin>`, which on a cold cache can prepend a provisioning line
// ("Saved lockfile") to the child's STDOUT, ahead of the server's JSON result.
// `main` takes the LAST non-empty line of stdout, so the preamble is stripped
// regardless of which stream it lands on — the original failure mode (a non-JSON
// line reaching `from json`) cannot recur. This is the bunx arm the override-
// driven tests never exercise; assert via markers across the table boundary.
test('main parses stdout JSON even when a bunx preamble precedes it (no contamination)', async () => {
    const stubDir = mkdtempSync(join(tmpdir(), 'scholar-nu-preamble-'))
    try {
        const stub = join(stubDir, 'preamble-server.ts')
        await Bun.write(
            stub,
            [
                `process.stdout.write('Saved lockfile\\n')`, // bunx provisioning chatter on stdout
                `process.stdout.write(JSON.stringify({ ok: true, marker: 'SCHOLAR_PREAMBLE_MARKER' }) + '\\n')`,
            ].join('\n')
        )
        const out = await runScript({
            pipe: { slug: 'x' },
            args: ['scholar.papers.search'],
            vars: { SCHOLAR_SERVER_CMD: `bun ${stub}` },
        }).text()
        expect(out).toContain('SCHOLAR_PREAMBLE_MARKER') // JSON result parsed despite the preamble
        expect(out).not.toContain('Saved lockfile') // preamble line stripped, not merged in
    } finally {
        rmSync(stubDir, { recursive: true, force: true })
    }
})

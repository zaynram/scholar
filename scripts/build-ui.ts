// scripts/build-ui.ts
//
// Production UI bundle build via Bun's HTML bundler. Multi-file output:
// HTML entrypoint + JS chunks + assets emitted to outdir.
// Replaces the broken `bun build ... --outfile` invocation that the
// foundation package.json `build:ui` script previously declared.
//
// Closes chore foundation-fix-build-ui-script-for-multi-file-output.
//
// NOTE on sourcemap default: production builds ship `sourcemap: "none"` so
// that the packaged plugin does not embed source map trailers into the inlined
// bundle. The measure-bundle.ts budget measurement likewise passes no
// sourcemap option (Bun default is "none"), so this helper matches exactly.
//
// SINGLE-FILE inlining (buildInlinedUI): Bun's HTML bundler emits a loader
// `index.html` plus sibling JS chunks. The MCP-App iframe (SEP-1865) runs
// sandboxed and CANNOT fetch sibling assets, so the *shipped* UI must be one
// self-contained file. `buildInlinedUI` builds into a scratch chunk dir, inlines
// every `<script src>` (and any `<link rel=stylesheet href>`) into the HTML, and
// returns the single-file string. It is the SINGLE source of inlining truth:
// both measure-bundle.ts (budget) and build-plugin.ts (the shipped ui/app.html)
// call it, so the measured artifact and the shipped artifact can never drift.

import { mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'

export interface BuildUIOptions {
    outdir: string // e.g., "build/ui"
    minify?: boolean // default true (prod); pass false for dev
    sourcemap?: 'none' | 'linked' | 'external' | 'inline' // default "none"
}

export async function buildUI(opts: BuildUIOptions): Promise<void> {
    const result = await Bun.build({
        entrypoints: ['src/ui/index.html'],
        target: 'browser',
        outdir: opts.outdir,
        minify: opts.minify ?? true,
        sourcemap: opts.sourcemap ?? 'none',
    })
    if (!result.success) {
        const messages = result.logs.map(l => l.message ?? String(l)).join('\n')
        throw new Error(`build-ui failed:\n${messages}`)
    }
}

// Inline every external ref matched by `re` (capture group 1 = relative path
// under chunkDir) into the HTML via `wrap`. Two-pass (collect → replace) because
// String.replace cannot take an async replacer. A referenced-but-missing chunk
// is fatal: leaving the ref in place would ship an HTML that 404s in the iframe.
async function inlineRefs(
    html: string,
    chunkDir: string,
    re: RegExp,
    wrap: (contents: string) => string,
): Promise<string> {
    const refs: Array<{ match: string; path: string }> = []
    for (const m of html.matchAll(re)) refs.push({ match: m[0], path: `${chunkDir}/${m[1]}` })
    for (const { match, path } of refs) {
        if (!existsSync(path))
            throw new Error(`SCHOLAR_BUILD_CHUNK_MISSING: chunk referenced by HTML not found: ${path}`)
        const contents = await Bun.file(path).text()
        // Function replacer: avoids `$`-pattern interpretation in `contents`, and
        // replaces only the first occurrence of this unique match string.
        html = html.replace(match, () => wrap(contents))
    }
    return html
}

/**
 * Build the UI as a single-file inlined HTML string (see header note).
 *
 * Builds into `chunkDir` (created fresh, removed on the way out), inlines all
 * `<script src=*.js>` and `<link rel=stylesheet href=*.css>` refs, and returns
 * the self-contained HTML. The `</script>`→`<\/script>` escape is LOAD-BEARING:
 * it prevents premature script-tag termination at runtime AND lets the
 * single-file strip regex in src/server/ui/resource.test.ts cleanly excise
 * inlined module bodies before the external-ref guards run.
 */
export async function buildInlinedUI(opts: {
    chunkDir: string
    minify?: boolean
}): Promise<string> {
    const { chunkDir, minify = true } = opts
    if (existsSync(chunkDir)) await rm(chunkDir, { recursive: true, force: true })
    await mkdir(chunkDir, { recursive: true })
    await buildUI({ outdir: chunkDir, minify })

    const chunkFiles = await readdir(chunkDir)
    const htmlChunk = chunkFiles.find(f => f.endsWith('.html'))
    if (!htmlChunk)
        throw new Error(
            `Expected an .html file in ${chunkDir}; found: ${chunkFiles.join(', ')}`,
        )
    let html = await Bun.file(`${chunkDir}/${htmlChunk}`).text()

    html = await inlineRefs(
        html,
        chunkDir,
        /<script[^>]*\bsrc=["']\.?\/?([^"']+\.js)["'][^>]*>\s*<\/script>/g,
        js => `<script type="module">${js.replace(/<\/script>/gi, '<\\/script>')}</script>`,
    )
    html = await inlineRefs(
        html,
        chunkDir,
        /<link[^>]*\bhref=["']\.?\/?([^"']+\.css)["'][^>]*>/g,
        css => `<style>${css}</style>`,
    )

    await rm(chunkDir, { recursive: true, force: true })
    return html
}

if (import.meta.main) {
    const outdir = process.env.UI_OUTDIR ?? `build/${process.platform}/ui`
    const minify = process.env.UI_MINIFY !== 'false'
    await buildUI({ outdir, minify })
}

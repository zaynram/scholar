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

if (import.meta.main) {
    const outdir = process.env.UI_OUTDIR ?? `build/${process.platform}/ui`
    const minify = process.env.UI_MINIFY !== 'false'
    await buildUI({ outdir, minify })
}

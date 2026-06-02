// src/server/db/sqlite-vec.ts — foundation cycle 6.1 (Task 1.3)
//
// Returns the absolute path to the bundled vec0 shared library. Loading is the
// caller's responsibility — see loadVecAndProbeDim in src/server/ingest/primitives.ts.
import { join } from 'path'

export function getVec0Extension() {
    switch (process.platform) {
        case 'win32':
            return 'dll'
        case 'darwin':
            return 'dylib'
        default:
            return 'so'
    }
}

/**
 * Resolution order:
 *   1. SCHOLAR_VEC0_PATH env override (test/CI/operator escape hatch)
 *   2. ${CLAUDE_PLUGIN_ROOT}/build/vendor/sqlite-vec/vec0.{dll,dylib,so}  (packaged)
 *   3. <repo>/build/vendor/sqlite-vec/vec0.{dll,dylib,so}                  (dev)
 *
 * Audit H4: dev mode anchors to `import.meta.dir` (src/server/db/) so the
 * path doesn't depend on where the process was launched from. CLAUDE_PLUGIN_ROOT
 * is the production fallback the packaged binary sets; keep that branch.
 */
export const resolveVec0Path = (): string =>
    process.env.SCHOLAR_VEC0_PATH ??
    join(
        process.env.CLAUDE_PLUGIN_ROOT ?? join(import.meta.dir, '..', '..', '..'),
        'build',
        'vendor',
        'sqlite-vec',
        `vec0.${getVec0Extension()}`
    )

/**
 * Normalize a Float32Array for safe bun:sqlite blob binding to vec0.
 *
 * Audit M3: bun:sqlite serializes the underlying ArrayBuffer for typed-array
 * blob parameters. For a sliced Float32Array (`new Float32Array(buf, offset, n)`)
 * the buffer includes bytes outside the view, silently corrupting the bound
 * vector. The defensive contract is "always pass a tightly-packed view";
 * this helper enforces it at the bind site without an unconditional copy.
 *
 * Fast path: byteLength matches the buffer's byteLength → no copy.
 * Slow path: any view-over-larger-buffer → `Float32Array.from(...)` copies.
 */
export function toTightFloat32(arr: Float32Array): Float32Array {
    return arr.buffer.byteLength === arr.byteLength ? arr : Float32Array.from(arr)
}

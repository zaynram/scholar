// Type surface for bin/launch.mjs (a hand-written .mjs launcher that must stay
// runnable as `bun bin/launch.mjs`). Only the pure, exported resolveEntry is
// consumed by TS (tests/launch.test.ts, Guard 3b); the rest of launch.mjs is the
// side-effectful launch sequence gated by import.meta.main. Under
// moduleResolution:"bundler", an import of "../bin/launch.mjs" resolves this
// `.d.mts` for types while bun loads the real `.mjs` at runtime.

/**
 * Resolve the server entrypoint for a plugin install rooted at `root`. Prefers
 * the built bundle `dist/server.js` if present; otherwise falls through to the
 * source-sync TS entrypoint `src/server/index.ts`.
 */
export function resolveEntry(root: string): string;

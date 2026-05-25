# Vendoring @modelcontextprotocol/server-pdf

This document is the re-vendor procedure for the unmodified upstream PDF MCP
server bundled under `src/vendor/pdf-server/`. The current pin is **1.7.2**
(verify via `cat src/vendor/pdf-server/package.json | jq .version`).

The vendored dist is shipped unmodified — there is no source patch to re-apply
across bumps, so divergence surfaces purely as protocol-shape changes. See
spec §7.2 for the design rationale and §16 for the upstream-bump risk row.

## When to re-vendor

Absorb upstream **patch and minor bumps** that carry bug fixes scholar wants
(e.g., a `roots/list` protocol fix, a security advisory). **Major bumps**
additionally require a spec §7.2 review — the design rationale for the
protocol-based root-injection approach must still hold under any new MCP
protocol generation before scholar's lifecycle code can absorb the change.

Do not re-vendor speculatively. The vendored copy is intentionally stable
between explicit bump decisions.

## Procedure

### 1. Update the pin

Edit `scripts/vendor-pdf-server.ts` line 14 — change `const VERSION = "1.7.2"`
to the new version string.

### 2. Run the helper

```
bun scripts/vendor-pdf-server.ts
```

The helper (`scripts/vendor-pdf-server.ts`) does the following in order:

- Creates a throwaway staging dir at `build/_vendor-stage/`.
- Seeds a minimal `package.json` in the staging dir so `bun add` has something to write to.
- Runs `bun add @modelcontextprotocol/server-pdf@<VERSION>` inside the staging dir.
- Cleans `src/vendor/pdf-server/dist/` and `src/vendor/pdf-server/package.json` — **only these two artifacts** are overwritten.
- **Preserves `src/vendor/pdf-server/UPSTREAM-LICENSE`** (created by the license-audit-vendored-pdf-server chore at commit 340ceb1). The helper does not touch this file.
- Copies the staged `dist/` tree and `package.json` into `src/vendor/pdf-server/`.

### 3. Run the drift gates

Both gates must pass before committing. Any failure means the re-vendored
upstream introduces a behavior change that scholar's PDF lifecycle code may
not handle correctly — see step 4 for the failure path.

**Gate A — vendor.test.ts** (anchor-string canary):

```
bun test src/vendor/pdf-server/vendor.test.ts
```

Pins the upstream version and the two §7.2 anchor strings. Runs in seconds
with no side effects; always run this gate first.

**Gate B — lifecycle.test.ts** (integration suite):

```
bun test src/server/pdf/lifecycle.test.ts
```

Exercises the roots/list responder, list_changed round-trip, and viewUUID
survival across a root mutation (the §16 risk row). Protocol-shape fixtures
(fixtures 1–3) always run; the heavy E2E fixtures (4 and 6) require
`SCHOLAR_PDF_E2E=1` and a live pdf-child process — run them when you have
reason to believe protocol behaviour has shifted:

```
SCHOLAR_PDF_E2E=1 bun test src/server/pdf/lifecycle.test.ts
```

### 4. If drift gates fail

Do **not** amend the gates or lower their assertions. The anchor strings and
version pin are the contract.

Choose one of these paths:

**Path A — shim in lifecycle.ts (preferred for small intentional changes).**
Add a versioned shim in `src/server/pdf/lifecycle.ts` that adapts the new
upstream behavior back to scholar's expected interface. Document the shim
with a comment referencing the upstream version and the changed symbol. Then
update the anchor strings in `src/vendor/pdf-server/vendor.test.ts` to
reflect the new symbol names — the canary should pin the *new* behavior once
the shim absorbs the divergence.

**Path B — revert and file a tracking issue (preferred for fundamental changes).**
Revert the `VERSION` pin in `scripts/vendor-pdf-server.ts` and file a
tracking issue documenting which gate failed, what changed upstream, and why
the bump cannot be absorbed in v1. The chore `upstream-pdf-server-revendor-process`
remains open until the issue is resolved.

### 5. Verify the license is unchanged

```
git diff src/vendor/pdf-server/UPSTREAM-LICENSE
```

The diff should be empty — the helper preserves `UPSTREAM-LICENSE` across
re-vendor passes. If the upstream license itself has changed (rare for
MIT-licensed projects), re-run the `license-audit-vendored-pdf-server` chore
procedure before committing: fetch the new version's published `package.json`
via `bun pm view @modelcontextprotocol/server-pdf@<new-version>`, confirm
the `license` field, update `UPSTREAM-LICENSE` with the new version number
and confirmed date, and record the outcome in a commit message note.

### 6. Commit

Single commit, message:

```
chore(vendor): re-vendor @modelcontextprotocol/server-pdf@<NEW-VERSION>

Bumped pin in scripts/vendor-pdf-server.ts and re-ran the helper.
Drift gates clean (vendor.test.ts + lifecycle.test.ts).

[Optional: link to upstream changelog or PR.]
```

## Anchor strings (drift canaries)

The following strings are pinned by `src/vendor/pdf-server/vendor.test.ts`
and serve as mechanical drift detectors for the §7.2 protocol contract.
Both must be present in `dist/index.js` or `dist/server.js` (the test checks
both files, since upstream bundling may move code between them across releases).

**`useClientRoots`** — pins the §7.2 invariant that the upstream PDF server's
`createServer` call is wired with the client-roots responder hook. Scholar's
`src/server/pdf/lifecycle.ts` drives the child via the MCP `roots/list` +
`notifications/roots/list_changed` protocol; the upstream honors this
protocol only when `useClientRoots: true` is active. Scholar passes
`--use-client-roots` on the spawn command line (see §7.2), which sets this
flag without relying on env-var propagation. If a future upstream release
renames or removes this symbol, the canary fires — scholar's spawn command
and the lifecycle responder contract must be re-verified against the new
entry point before re-vendoring can proceed.

**`allowedLocalDirs`** — pins the §7.2 invariant that `refreshRoots` clears
the upstream's `allowedLocalDirs` array and refills it from scholar's
`ListRootsRequestSchema` reply. This clear-and-refill is what ensures root
mutations issued via `notifications/roots/list_changed` take effect without
a child process respawn. If a future upstream release renames this data
structure or changes the clear-before-refill semantics, the canary fires —
the root-mutation flow and the viewUUID-survival guarantee (§16) must be
re-verified before re-vendoring can proceed.

If a future upstream release rewrites either symbol (rename / inlining /
removal), the correct response is to verify the equivalent behavior exists
under a new name before updating the anchor strings in `vendor.test.ts`. The
anchor strings are a behavioral contract, not an arbitrary text search — they
may need updating only after a careful review of the new `dist/index.js` and
`dist/server.js` confirms that the roots-protocol behavior is intact.

## Why not a Git submodule or workspace dep?

Scholar ships as a `bun build --compile` single-file executable for
air-gapped Cowork hosts (spec §7.2, §17). A Git submodule would require an
upstream network fetch at install time; a workspace dep would require the
user to have `bun` on PATH and pull from npm at every install. Both break the
offline-distribution guarantee. Vendoring the unmodified `dist/` under
`src/vendor/pdf-server/` gives the build pipeline a stable, deterministic,
offline-available input that the §14.1 packaging step can copy without any
additional network or toolchain requirement. License attribution is preserved
under our own audit (`UPSTREAM-LICENSE`) rather than delegated to upstream's
npm publication.

## Spec cross-references

- **§7.2** "The vendored pdf MCP (unmodified upstream + protocol-based roots)" —
  design rationale for the unmodified-vendor posture, the protocol-based
  root-injection approach, and the spawn command. Re-vendor procedure lives here.
- **§16** upstream-bump risk row — the cycle-6.2 fixture suite (this document's
  gate A + gate B) is the named mitigation for upstream protocol-shape drift.
  The risk row notes that re-vendoring on a minor bump is `bun pm pack` + unpack +
  run the fixture suite; a major bump is additionally gated on a §7.2 review.

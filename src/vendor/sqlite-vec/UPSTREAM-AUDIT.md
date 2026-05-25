# Upstream audit — sqlite-vec v0.1.9

## Source

- **Upstream repository:** https://github.com/asg017/sqlite-vec
- **Pinned version:** v0.1.9 (matches the `sqlite-vec@0.1.9` npm package recorded in `bun.lock`)
- **Amalgamation tarball:** https://github.com/asg017/sqlite-vec/releases/download/v0.1.9/sqlite-vec-0.1.9-amalgamation.tar.gz

Note: `sqlite-vec.c` and `sqlite-vec.h` are sourced from the release amalgamation tarball
(`sqlite-vec-0.1.9-amalgamation.tar.gz`), not from the raw tree. The raw tree carries
`sqlite-vec.h.tmpl` (a template, not the final header); the header is only materialised in
the amalgamation build artifact. `LICENSE` and `UPSTREAM-README.md` are sourced from the raw
tree at `https://raw.githubusercontent.com/asg017/sqlite-vec/v0.1.9/`.

## Source URLs

| File | Source URL |
|---|---|
| `sqlite-vec.c` | `https://github.com/asg017/sqlite-vec/releases/download/v0.1.9/sqlite-vec-0.1.9-amalgamation.tar.gz` → `sqlite-vec.c` |
| `sqlite-vec.h` | `https://github.com/asg017/sqlite-vec/releases/download/v0.1.9/sqlite-vec-0.1.9-amalgamation.tar.gz` → `sqlite-vec.h` |
| `LICENSE` | `https://raw.githubusercontent.com/asg017/sqlite-vec/v0.1.9/LICENSE-MIT` |
| `UPSTREAM-README.md` | `https://raw.githubusercontent.com/asg017/sqlite-vec/v0.1.9/README.md` |

## SHA-256 hashes (vendor-integrity audit)

```
ba081a47fa02eadc3cf6b16c314b695b84081269349aac722b4efa338fe8fd85  sqlite-vec.c
8e4d7bfcd779c89bd19a6b2959fce24ee391b2eaf79a85a979377a36627cb060  sqlite-vec.h
6ce72bbe12d975bd5286e5ab0a064c069693300c47bccbc57bec18485f1621ea  LICENSE
9116ef6e0b78eb0caf5c6bb6419ccf4f8c6523967eef2045928c33dc66053d64  UPSTREAM-README.md
```

## License

sqlite-vec is **dual-licensed Apache-2.0 / MIT** (author: Alex Garcia, Copyright © 2024).
The upstream repository ships both `LICENSE-APACHE` and `LICENSE-MIT` at the root. This
vendor includes the MIT text as `LICENSE`.

**Verified MIT / Apache-2.0 dual-license on 2026-05-25 — compatible with scholar's MIT
distribution** because MIT and Apache-2.0 are both permissive licenses that permit vendoring
and redistribution in a downstream MIT-licensed project, subject to preservation of the
upstream copyright notice. The `LICENSE` file in this directory carries the required notice.

## Re-vendor procedure

To refresh this vendor to a newer upstream release: (1) bump the version pin — update
`"sqlite-vec"` in `package.json` to the desired version and run `bun install` to update
`bun.lock`; (2) download the new amalgamation tarball from
`https://github.com/asg017/sqlite-vec/releases/download/v<new>/sqlite-vec-<new>-amalgamation.tar.gz`,
extract `sqlite-vec.c` and `sqlite-vec.h`, and overwrite the files here; (3) fetch the new
`LICENSE-MIT` (or `LICENSE-APACHE`) and `README.md` from the raw tree at the new tag; (4)
re-compute SHA-256 sums for all four files (`sha256sum sqlite-vec.c sqlite-vec.h LICENSE
UPSTREAM-README.md`) and update the hashes table above; (5) update the version references
and date in this file; (6) re-run the vec0 smoke test (cycle 6.5, `src/server/db/raw-ddl.test.ts`
or equivalent) against the newly compiled or prebuilt `vec0` binary to verify ABI compatibility
with the active Bun release. A forward-ref: a more structured re-vendor runbook (mirroring
the `upstream-pdf-server-revendor-process` chore for the pdf-server vendor) is a v1.1 candidate
chore (`upstream-sqlite-vec-revendor-process`) — the orchestrator will decide post-v1.

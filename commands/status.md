---
name: scholar:status
description: Show paper counts by status, stale papers, and last-opened timestamp for a corpus.
---

# /scholar:status

## Usage

```
/scholar:status
/scholar:status --corpus daisy
```

## Arguments

| Argument | Type | Default | Description |
|---|---|---|---|
| `--corpus` | string | active | Corpus slug to inspect |

## Behavior

Calls `scholar.corpus.status` and renders the returned record. Output includes:
- Per-status counts (`pending`, `reading`, `reviewed`, `skip`)
- `last_opened_at` ISO timestamp
- Stale-paper summary (papers whose `last_read_at` predates the most recent corpus change)

Backed by the `scholar status` subcommand in `nu/scholar.nu`.

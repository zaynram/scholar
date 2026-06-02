---
name: status
description: Show paper counts by status, stale papers, and last-opened timestamp for a corpus.
arguments: [corpus]
argument-hint: [<corpus?>]
user-invocable: true
---

# Status

## Arguments

The corpus to target is: `$corpus`

- If no corpus was provided by the user, use the `active` corpus.
If there is no `active` corpus, request one to be specified by the user and return.

## Behavior

Call the `scholar.corpus.status` with `{"corpus_id": "$corpus"}`.
(or the active corpus if none was provided)

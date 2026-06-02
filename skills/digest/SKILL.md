---
name: digest
description: Generate a synthesis digest for the active corpus scope (Ollama default; --claude opt-in).
user-invocable: true
arguments: [scope corpus claude]
argument-hint:
  - all|stale|section:<?>|selection:<?>
  - "[--corpus=<corpus>]"
  - "[--claude]"
---

# Digest

## Arguments

| Argument | Type | Default | Description | User-Provided Value |
|---|---|---|---|---|
| `--scope` | string | `all` | One of `all`, `stale`, `section:<label>`, `selection:<hash>` | `$scope` |
| `--corpus` | string | active | Corpus slug | `$corpus` |
| `--claude` | flag | `False` | Opt in to Claude (cowork.askClaude) for this single request | `$claude` |

## Behavior

Call the `scholar.digest.generate` tool with `{scope_key: $scope, use_claude: $claude}`.
Default LLM is local Ollama (`qwen3:8b` by default).

When the server returns a `structuredContent.askClaude` sentinel
(typically: Ollama unavailable + askClaude opt-in not set),
the CLI prints the opt-in hint rather than the digest body.

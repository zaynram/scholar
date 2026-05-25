---
name: scholar:digest
description: Generate a synthesis digest for the active corpus scope (Ollama default; --claude opt-in).
---

# /scholar:digest

## Usage

```
/scholar:digest
/scholar:digest --scope section:methods
/scholar:digest --scope stale
/scholar:digest --claude
```

## Arguments

| Argument | Type | Default | Description |
|---|---|---|---|
| `--scope` | string | `all` | One of `all`, `stale`, `section:<label>`, `selection:<hash>` (SA3 enum — spec §9.3, §8.2) |
| `--corpus` | string | active | Corpus slug |
| `--claude` | flag | false | Opt in to Claude (cowork.askClaude) for this single request (spec §11) |

## Behavior

Calls `scholar.digest.generate` with `{scope_key, use_claude}`. Default LLM is local Ollama (`qwen3:8b` by default). **SA4 invariant (CLAUDE.md):** mechanical LLM work routes through Ollama; `--claude` is per-request opt-in only — never the default path.

Result field is `body_md` (extraction-003 §6.8 contract). When the server returns a `structuredContent.askClaude` sentinel (typically: Ollama unavailable + askClaude opt-in not set), the CLI prints the opt-in hint rather than the digest body.

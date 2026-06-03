---
name: workflow
description: Guides usage of scholar plugin surfaces for literature review sessions — UI views, CLI subcommands, and slash commands.
---

# Scholar Workflow Skill

Scholar exposes three concentric surface layers — all backed by the same `scholar.*` MCP tools.

## Surface map

| Task | UI view | CLI / slash |
|---|---|---|
| Browse papers | `scholar.dashboard` → CorpusDashboard | `scholar list` |
| Read paper | `scholar.paper.show` → PaperDetail | — (open via UI) |
| Synthesis digest | `scholar.digest.show` → DigestPanel | `scholar digest` / `/scholar:digest` |
| Reading prompts | `scholar.prompts.show` → ReadingPromptsPane | — (open via UI) |
| Reading progress | `scholar.progress.show` → ReaderProgress | — (open via UI) |
| Ingest | — | `scholar ingest` / `/scholar:ingest` |
| Status | — | `scholar status` / `/scholar:status` |

## Load-bearing conventions

- **Tool namespace.** Every server-side tool is `scholar.*`. The vendored pdf MCP child surfaces as `scholar.pdf.*` proxies — never invoke raw `pdf.*` from a host.
- **"Use Claude instead" toggle.** SA2 (spec §11): only rendered in hosts where `window.cowork.askClaude` is a function. In hosts without it, a static "Claude fallback unavailable in this host." note appears in its place and the toggle is hidden.
- **Ollama by default.** SA4 (CLAUDE.md): digest + reading-prompts default to local Ollama. `--claude` (CLI) and "Use Claude instead" (UI) are explicit per-request opt-ins — never the default path.
- **Per-corpus DB snapshot.** Tool handlers snapshot `ctx.db` at entry (§7.6); a `corpus.activate` mid-session swaps the active corpus for the next call, not the current one.

## Where to look next

- Spec: `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` (§9 view contracts, §11 askClaude sentinel, §13 annotation reconciler)
- nu module: `bin/scholar.nu` (transport + exported subcommands)
- User-invocable skills: `skills/{ingest,digest,status}/SKILL.md` (the `/scholar:*` slash surfaces)

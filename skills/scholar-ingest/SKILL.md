---
name: scholar-ingest
description: Guides paper ingestion from BibTeX, RIS, CrossRef DOI, and arXiv sources via the scholar plugin.
---

# Scholar Ingest Skill

Four ingestion paths land papers in the active corpus DB, all going through §12.0 primitives for sanitization at the boundary.

## Sources

| Source | Tool | CLI flag | Slash flag |
|---|---|---|---|
| BibTeX file | `scholar.ingest.bibtex` | `scholar ingest --bibtex <path>` | `/scholar:ingest --bibtex <path>` |
| RIS file | `scholar.ingest.ris` | `scholar ingest --ris <path>` | `/scholar:ingest --ris <path>` |
| CrossRef DOI | `scholar.ingest.doi` | `scholar ingest --doi <doi>` | `/scholar:ingest --doi <doi>` |
| arXiv ID/URL | `scholar.ingest.arxiv` | `scholar ingest --arxiv <id>` | `/scholar:ingest --arxiv <id>` |

## Examples

```
/scholar:ingest --bibtex /path/to/refs.bib
/scholar:ingest --doi 10.1038/s41586-021-03819-2
/scholar:ingest --arxiv 2401.00001
```

## Discipline

- **Sanitization at the boundary.** All metadata routes through `sanitizeText` + `wrapUntrusted` + `encodeDoi` + `validateArxivId` (§12.0 primitives — invariant in CLAUDE.md). Untrusted strings are NEVER concatenated into prompts/paths/URLs.
- **Idempotent UPSERTs.** Duplicate DOI / arXiv ID re-ingestions UPDATE the existing row; they do not insert a duplicate.
- **Citations.** CrossRef ingestion follows `references-doi` links to build the citation graph; arXiv's metadata fills in where CrossRef doesn't.
- **PDF extraction is a follow-on step.** After ingestion, run `scholar.pdf.refresh-extraction` to chunk + embed (semantic-search readiness; `still_indexing` pill on the dashboard until done).

## Where to look next

- Spec: `docs/superpowers/specs/2026-05-22-scholar-plugin-design.md` §6.4 (ingest contracts), §12.0 (primitives), §12.1 (allow-list legs).
- Tool code: `src/server/tools/ingest.ts` + `src/server/ingest/{bibtex,ris,doi,arxiv,primitives}.ts`.

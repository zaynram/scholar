---
name: scholar:ingest
description: Ingest a paper into the active scholar corpus from a DOI, arXiv ID, BibTeX file, or RIS file.
---

# /scholar:ingest

## Usage

```
/scholar:ingest --doi 10.1234/example
/scholar:ingest --arxiv 2401.00001
/scholar:ingest --bibtex /path/to/refs.bib
/scholar:ingest --ris /path/to/refs.ris
```

## Arguments

| Argument | Type | Description |
|---|---|---|
| `--doi` | string | CrossRef DOI (e.g. `10.1038/s41586-021-03819-2`) |
| `--arxiv` | string | arXiv ID or URL (e.g. `2401.00001` or `arxiv:cs.AI/2401.00001`) |
| `--bibtex` | path | `.bib` file path |
| `--ris` | path | `.ris` file path |
| `--corpus` | string | Target corpus slug (active corpus used if omitted) |

## Behavior

Routes to one of `scholar.ingest.doi`, `scholar.ingest.arxiv`, `scholar.ingest.bibtex`, or `scholar.ingest.ris` based on the supplied flag. All metadata is sanitized at the ingestion boundary via §12.0 primitives (`sanitizeText`, `wrapUntrusted`, `encodeDoi`, `validateArxivId`). Duplicate DOI / arXiv entries UPSERT (not re-insert).

Backed by the `scholar` nu module wrapper at `nu/scholar.nu` — invoke directly with `scholar ingest --doi …` after `use nu/scholar.nu *`.

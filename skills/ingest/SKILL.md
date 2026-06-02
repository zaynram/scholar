---
name: ingest
description: Ingest a paper into the active scholar corpus from a DOI, arXiv ID, BibTeX file, or RIS file.
user-invocable: true
arguments: [flag value]
argument-hint:
  - [--doi|--arxiv|--bibtext|--ris]
  - <value>
---

# Ingest

## Arguments

| Argument | Type | Description |
|---|---|---|
| `--doi` | string | CrossRef DOI (e.g. `10.1038/s41586-021-03819-2`) |
| `--arxiv` | string | arXiv ID or URL (e.g. `2401.00001` or `arxiv:cs.AI/2401.00001`) |
| `--bibtex` | path | `.bib` file path |
| `--ris` | path | `.ris` file path |
| `--corpus` | string | Target corpus slug (active corpus used if omitted) |

Resolve the `flag` (`$flag`) provided by the user to the table,
then apply the `value` (`$value`) appropriately as described below.

## Behavior

Routes to one of
`scholar.ingest.doi`, `scholar.ingest.arxiv`, `scholar.ingest.bibtex`, or `scholar.ingest.ris`
based on the supplied flag.

All metadata is sanitized at the ingestion boundary
(`sanitizeText`, `wrapUntrusted`, `encodeDoi`, `validateArxivId`).
Duplicate DOI / arXiv entries UPSERT (not re-insert).

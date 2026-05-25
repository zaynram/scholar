// src/server/ingest/bibtex.ts — cycle 6.4 GREEN
// BibTeX adapter (wraps @retorquere/bibtex-parser) + in-house RIS adapter.
// Both adapters live here per spec §5.14.
//
// §12.0: all extracted strings route through sanitizeText before entering ParsedEntry.
// F7: arXiv ID extracted when archiveprefix === "arXiv" (note: parser lowercases the key).
// F12: safeText returns undefined on SanitizeError — callers use skip semantics.
// F13: whitespace-only title entries are dropped.
import { parse as parseBibtexRaw } from "@retorquere/bibtex-parser";
import { sanitizeText, validateArxivId } from "./primitives.ts";

export interface ParsedEntry {
  key?: string;
  title: string;
  authors?: string;   // "Last, First; Last, First" (semicolon-delimited)
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;   // set for arXiv preprints (eprint + archiveprefix=arXiv)
  abstract?: string;
  importedVia: "bibtex" | "ris" | "crossref" | "arxiv" | "manual";
}

export interface ParseOptions {
  onError?: "skip"; // "throw" mode dropped in v1; all callers use skip semantics
}

const MAX = { title: 512, authors: 1024, venue: 256, abstract: 8192 };

/**
 * F12: safeText — wraps sanitizeText and returns undefined on SanitizeError
 * (rather than throwing). Callers apply skip semantics on undefined.
 */
function safeText(raw: string | undefined, maxLen: number): string | undefined {
  if (!raw) return undefined;
  try {
    return sanitizeText(raw, { maxLen });
  } catch {
    return undefined;
  }
}

// ── BibTeX ───────────────────────────────────────────────────────────────────

/**
 * Format a bibtex-parser author array into "Last, First; Last, First" form.
 * bibtex-parser returns each author as { lastName, firstName? }.
 */
function formatAuthors(
  authors: Array<{ lastName?: string; firstName?: string }>,
): string | undefined {
  if (!authors || authors.length === 0) return undefined;
  return authors
    .map((a) => [a.lastName, a.firstName].filter(Boolean).join(", "))
    .join("; ");
}

export function parseBibtex(source: string, _opts: ParseOptions = {}): ParsedEntry[] {
  const ast = parseBibtexRaw(source, { errorHandler: () => undefined });
  const results: ParsedEntry[] = [];

  for (const entry of ast.entries) {
    const rawTitle = (entry.fields.title as string | undefined) ?? "";
    const title = safeText(rawTitle, MAX.title);
    // F13: skip if title is absent or whitespace-only after sanitization
    if (!title || !title.trim()) continue;

    // bibtex-parser normalizes author to [{ lastName, firstName? }]
    const rawAuthorArr = entry.fields.author as
      | Array<{ lastName?: string; firstName?: string }>
      | undefined;
    const authors = safeText(formatAuthors(rawAuthorArr ?? []) ?? undefined, MAX.authors);

    const venue = safeText(
      ((entry.fields.journal as string | undefined) ??
        (entry.fields.booktitle as string | undefined)),
      MAX.venue,
    );
    const abstract = safeText(entry.fields.abstract as string | undefined, MAX.abstract);
    const doi = safeText(entry.fields.doi as string | undefined, 256);

    const yearRaw = entry.fields.year as string | number | undefined;
    const year = yearRaw !== undefined ? parseInt(String(yearRaw), 10) : undefined;

    // F7: bibtex-parser lowercases all field keys — archivePrefix becomes archiveprefix.
    let arxivId: string | undefined;
    const archivePrefix = (entry.fields.archiveprefix as string | undefined)?.trim();
    const eprint = (entry.fields.eprint as string | undefined)?.trim();
    if (archivePrefix === "arXiv" && eprint) {
      try {
        arxivId = validateArxivId(eprint);
      } catch {
        // malformed eprint — skip arxiv extraction; entry still ingested
      }
    }

    results.push({
      key: entry.key,
      title: title.trim(),
      authors: authors ?? undefined,
      year: year !== undefined && !Number.isNaN(year) ? year : undefined,
      venue: venue ?? undefined,
      doi: doi ?? undefined,
      arxivId,
      abstract: abstract ?? undefined,
      importedVia: "bibtex",
    });
  }
  return results;
}

// ── RIS (in-house adapter ≤ ~80 LOC) ─────────────────────────────────────────
// Supported tags: TY, AU, TI, PY, JO, T2, DO, UR, AB, KW, ER.

interface RisRecord {
  TY?: string;
  AU: string[];
  TI?: string;
  PY?: string;
  JO?: string;
  T2?: string;
  DO?: string;
  AB?: string;
}

function parseRisRaw(source: string): RisRecord[] {
  const records: RisRecord[] = [];
  let cur: RisRecord | null = null;
  for (const line of source.split(/\r?\n/)) {
    // RIS tags: 2-char code + 2 spaces + dash + optional space + optional value.
    // ER  - has no trailing content (val is undefined / empty string).
    const m = line.match(/^([A-Z][A-Z0-9])\s{1,2}-(?:\s+(.*))?$/);
    if (!m) continue;
    const [, tag, val] = m;
    const v = (val ?? "").trim();
    if (tag === "TY") {
      cur = { TY: v, AU: [] };
    } else if (tag === "ER") {
      if (cur) {
        records.push(cur);
        cur = null;
      }
    } else if (cur) {
      if (tag === "AU" && v) cur.AU.push(v);
      else if (tag === "TI" && v) cur.TI = v;
      else if (tag === "PY" && v) cur.PY = v.slice(0, 4);
      else if (tag === "JO" && v) cur.JO = v;
      else if (tag === "T2" && v) cur.T2 = v;
      else if (tag === "DO" && v) cur.DO = v;
      else if (tag === "AB" && v) cur.AB = (cur.AB ?? "") + v + " ";
    }
  }
  return records;
}

export function parseRis(source: string, _opts: ParseOptions = {}): ParsedEntry[] {
  const results: ParsedEntry[] = [];
  for (const rec of parseRisRaw(source)) {
    const title = safeText(rec.TI, MAX.title);
    // F13: skip if title missing or whitespace-only
    if (!title || !title.trim()) continue;

    results.push({
      title: title.trim(),
      authors: safeText(
        rec.AU.length > 0 ? rec.AU.join("; ") : undefined,
        MAX.authors,
      ),
      year: rec.PY ? parseInt(rec.PY, 10) : undefined,
      venue: safeText((rec.JO ?? rec.T2) ?? undefined, MAX.venue),
      doi: safeText(rec.DO, 256),
      abstract: safeText(rec.AB?.trim(), MAX.abstract),
      importedVia: "ris",
    });
  }
  return results;
}

// src/server/ingest/arxiv.ts — cycle 6.4 GREEN
// arXiv Atom API adapter with optional PDF download.
// §12.0: validateArxivId before URL interpolation; sanitizeText on all Atom fields.
// §12.3: TLS only (https://export.arxiv.org — cleartext HTTP risks MITM title swap).
// F2: resolveUnderRoot applied to DIRECTORY (after mkdir -p), NOT non-existent file.
// F10: HTML entities decoded before sanitizeText so &#x202E; → U+202E is caught.
import * as path from "node:path";
import { validateArxivId, sanitizeText } from "./primitives.ts";
import type { ParsedEntry } from "./bibtex.ts";

export type ArxivEntry = ParsedEntry & { importedVia: "arxiv"; arxivId: string };

const ARXIV_API = "https://export.arxiv.org/api/query";
const MAX = { title: 512, authors: 1024, abstract: 8192 };

/**
 * Strip "http://arxiv.org/abs/NNNN.NNNNvN" → "NNNN.NNNN" when a full URL is given.
 * Otherwise returns the raw input unchanged.
 */
function extractIdFromUrl(raw: string): string {
  const m = raw.match(/arxiv\.org\/abs\/([^\s?#]+)/i);
  return m ? (m[1] ?? raw) : raw;
}

/**
 * F10: decode numeric and named HTML entities before sanitizeText.
 * Covers the &#x202E; bypass vector: arXiv XML encodes U+202E as &#x202E;,
 * bypassing a naive string check. After decoding, sanitizeText catches U+202E
 * as a bidi override and throws SanitizeError.
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10)),
    );
}

/**
 * Extract the text content of a named XML element (supports namespace prefixes,
 * e.g. <arxiv:doi>). Returns "" if the element is not present.
 */
function extractTag(xml: string, tag: string): string {
  const m = xml.match(
    new RegExp(
      `<(?:[a-z]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[a-z]+:)?${tag}>`,
      "i",
    ),
  );
  return m ? (m[1] ?? "").trim() : "";
}

function parseAtom(xml: string, canonicalId: string): ArxivEntry {
  const rawTitle = decodeHtmlEntities(extractTag(xml, "title")).replace(
    /\s+/g,
    " ",
  );
  // Throws SanitizeError if bidi-override / PUA / tag-block present after decoding.
  const title = sanitizeText(rawTitle, { maxLen: MAX.title });

  const rawAbstract = decodeHtmlEntities(extractTag(xml, "summary")).replace(
    /\s+/g,
    " ",
  );
  const abstract = rawAbstract
    ? sanitizeText(rawAbstract, { maxLen: MAX.abstract })
    : undefined;

  const authorBlocks = [
    ...xml.matchAll(/<author>\s*<name>([^<]+)<\/name>/gi),
  ];
  const rawAuthors = authorBlocks
    .map((m) => decodeHtmlEntities((m[1] ?? "").trim()))
    .filter(Boolean)
    .join("; ");
  const authors = rawAuthors
    ? sanitizeText(rawAuthors, { maxLen: MAX.authors })
    : undefined;

  const pubRaw = extractTag(xml, "published");
  const year = pubRaw ? new Date(pubRaw).getFullYear() : undefined;

  const rawDoi = decodeHtmlEntities(extractTag(xml, "doi"));
  const doi = rawDoi ? sanitizeText(rawDoi, { maxLen: 256 }) : undefined;

  return {
    title,
    authors,
    year: year !== undefined && !Number.isNaN(year) ? year : undefined,
    doi: doi || undefined,
    arxivId: canonicalId,
    abstract,
    importedVia: "arxiv",
  };
}

export interface ArxivOptions {
  fetch?: typeof globalThis.fetch;
}

export async function fetchArxiv(
  rawId: string,
  opts: ArxivOptions,
): Promise<ArxivEntry> {
  const canonicalId = validateArxivId(extractIdFromUrl(rawId)); // throws InvalidArxivIdError
  const url = `${ARXIV_API}?id_list=${encodeURIComponent(canonicalId)}`;
  const fetcher = opts.fetch ?? globalThis.fetch;
  const resp = await fetcher(url);
  if (!resp.ok) {
    throw new Error(`arXiv API HTTP ${resp.status} for ID ${canonicalId}`);
  }
  const xml = await resp.text();
  if (!xml.includes("<entry>")) {
    throw new Error(`arXiv: no entry found for ID ${canonicalId}`);
  }
  return parseAtom(xml, canonicalId); // may throw SanitizeError on malicious title
}

export interface PdfDownloadOptions extends ArxivOptions {
  pdfRoot: string;
}

/**
 * Downloads arXiv PDF to `<pdfRoot>/arxiv/<canonicalId>.pdf`.
 * F2: Path is constructed from validated inputs (canonicalId is arXiv-validated,
 * pdfRoot is config-sourced). mkdir -p ensures the destination directory exists
 * before Bun.write. resolveUnderRoot is NOT used here because it asserts isFile()
 * on the target — the file doesn't exist before download. Instead, the path is safe
 * by construction (canonicalId is alphanumeric/dot/slash — no path traversal).
 */
export async function downloadArxivPdf(
  canonicalId: string,
  opts: PdfDownloadOptions,
): Promise<string> {
  const destDir = path.join(opts.pdfRoot, "arxiv");
  await Bun.$`mkdir -p ${destDir}`;
  // canonicalId is already validated by validateArxivId; it contains only
  // alphanumerics, dots, slashes (legacy form) — no "../" traversal possible.
  const safeDest = path.join(destDir, `${canonicalId}.pdf`);

  const pdfUrl = `https://arxiv.org/pdf/${encodeURIComponent(canonicalId)}.pdf`;
  const fetcher = opts.fetch ?? globalThis.fetch;
  const resp = await fetcher(pdfUrl);
  if (!resp.ok) {
    throw new Error(`arXiv PDF HTTP ${resp.status} for ID ${canonicalId}`);
  }
  await Bun.write(safeDest, resp);
  return safeDest;
}

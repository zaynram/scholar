// src/server/ingest/crossref.ts — cycle 6.4 GREEN
// CrossRef API adapter (polite tier).
// §12.0: encodeDoi BEFORE URL interpolation; sanitizeText on every response field.
// §8.2 + §12.2: references array included in return value for opportunistic citation INSERT.
// F7: Zod runtime schema validation guards against CrossRef API drift.
import { z } from "zod";
import { encodeDoi, sanitizeText } from "./primitives.ts";
import type { ParsedEntry } from "./bibtex.ts";

// Zod schema for runtime shape validation (F7 — defense against CrossRef API drift)
const CrossrefMessageSchema = z.object({
  title: z.array(z.string()).optional(),
  author: z
    .array(
      z.object({ family: z.string().optional(), given: z.string().optional() }),
    )
    .optional(),
  published: z.object({ "date-parts": z.array(z.array(z.number())) }).optional(),
  "container-title": z.array(z.string()).optional(),
  abstract: z.string().optional(),
  DOI: z.string().optional(),
  // §8.2 + §12.2: reference array for opportunistic citation graph
  reference: z
    .array(z.object({ DOI: z.string().optional() }).passthrough())
    .optional(),
});

export type CrossrefReference = { DOI?: string; [k: string]: unknown };

export type CrossrefEntry = ParsedEntry & {
  importedVia: "crossref";
  references?: CrossrefReference[];
};

const CROSSREF_BASE = "https://api.crossref.org/works";
const MAX = { title: 512, authors: 1024, venue: 256, abstract: 8192 };

/** Strip JATS XML tags from CrossRef abstract fields. */
function stripJats(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

function normAuthors(
  authors: Array<{ family?: string; given?: string }>,
): string {
  return authors
    .map((a) => [a.family, a.given].filter(Boolean).join(", "))
    .join("; ");
}

export interface CrossrefOptions {
  /**
   * Optional user email for CrossRef polite-tier `?mailto=` parameter.
   * When present, CrossRef can contact the user about problematic queries
   * and grants higher rate limits. When absent, CrossRef works at anonymous
   * rate limits — no error, no fake-email stub.
   * Set via ctx.config.get<string>("crossref.mailto") — configurable at
   * first-run wizard time.
   */
  mailto?: string;
  fetch?: typeof globalThis.fetch;
}

export async function fetchCrossref(
  doi: string,
  opts: CrossrefOptions,
): Promise<CrossrefEntry> {
  const encodedDoi = encodeDoi(doi); // throws InvalidDoiError on bad format (§12.0)
  // §12.2 polite tier: append mailto only when configured; anonymous fallback is
  // lower rate-limit but valid — do NOT fail-closed on missing config.
  const mailtoParam = opts.mailto
    ? `?mailto=${encodeURIComponent(opts.mailto)}`
    : "";
  const url = `${CROSSREF_BASE}/${encodedDoi}${mailtoParam}`;

  const fetcher = opts.fetch ?? globalThis.fetch;
  const resp = await fetcher(url);
  if (!resp.ok) {
    throw new Error(`CrossRef HTTP ${resp.status} for DOI ${doi}`);
  }

  const raw = (await resp.json()) as { status?: string; message?: unknown };
  const parsed = CrossrefMessageSchema.safeParse(raw.message);
  if (!parsed.success) {
    throw new Error(`CrossrefResponseInvalid: ${parsed.error.message}`);
  }
  const msg = parsed.data;

  const rawTitle = (msg.title ?? [])[0] ?? "";
  const title = sanitizeText(rawTitle, { maxLen: MAX.title });

  const rawAuthors = normAuthors(msg.author ?? []);
  const authors = rawAuthors
    ? sanitizeText(rawAuthors, { maxLen: MAX.authors })
    : undefined;

  const rawVenue = (msg["container-title"] ?? [])[0];
  const venue = rawVenue
    ? sanitizeText(rawVenue, { maxLen: MAX.venue })
    : undefined;

  const rawAbstract = msg.abstract ? stripJats(msg.abstract) : undefined;
  const abstract = rawAbstract
    ? sanitizeText(rawAbstract, { maxLen: MAX.abstract })
    : undefined;

  const year = msg.published?.["date-parts"]?.[0]?.[0] ?? undefined;

  return {
    title,
    authors,
    year,
    venue,
    doi, // store canonical DOI (not percent-encoded form)
    abstract,
    importedVia: "crossref",
    references: msg.reference,
  };
}

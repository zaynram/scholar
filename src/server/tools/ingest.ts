// src/server/tools/ingest.ts — cycle 6.4 GREEN (fills foundation 6.1 stub)
//
// Registers scholar.ingest.{bibtex,doi,arxiv,manual} tools.
// §7.6: exports registerTools(server, ctx, register): void matching RegisterTools.
// §7.6: every handler snapshots ctx.db into a local on its first line.
// §12.0: all untrusted input routes through foundation primitives.
// §12.1: three-leg duplicate detection (DOI → arXiv ID → title/year/author).
// §8.2: opportunistic citation INSERT OR IGNORE for CrossRef references.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { RegisterTools, RegisterHelper, ServerContext } from "./registry.ts";
import { papers, citations } from "../db/schema.ts";
import { eq } from "drizzle-orm";
import { nowIso, ulid } from "../db/nowIso.ts";
import { allPdfRoots, defaultPdfRoot } from "../db/default-pdf-root.ts";
import { parseBibtex, parseRis, type ParsedEntry } from "../ingest/bibtex.ts";
import { fetchCrossref, type CrossrefReference } from "../ingest/crossref.ts";
import { fetchArxiv, downloadArxivPdf } from "../ingest/arxiv.ts";
import {
  sanitizeText,
  resolveUnderRoot,
  encodeDoi,
  validateArxivId,
  InvalidDoiError,
  InvalidArxivIdError,
} from "../ingest/primitives.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** All configured PDF roots for a corpus (configDb pdf_roots + importDirs config key). */
function getPdfRoots(
  configDb: BunSQLiteDatabase,
  corpusId: string,
  importDirs: string[],
): string[] {
  return [...allPdfRoots(configDb, corpusId), ...importDirs].filter(Boolean);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract first author's last name from a "Last, First; Last, First" string. */
function firstAuthorLast(authors: string): string {
  return (authors.split(";")[0] ?? "").split(",")[0] ?? "";
}

// ── Duplicate detection (§12.1 three-leg order) ──────────────────────────────

function findDuplicate(
  db: BunSQLiteDatabase,
  entry: {
    doi?: string;
    arxivId?: string;
    title?: string;
    year?: number;
    authors?: string;
  },
): string | undefined {
  // Leg 1: DOI (partial-unique index handles null DOIs safely)
  if (entry.doi) {
    const row = db.select({ id: papers.id }).from(papers).where(eq(papers.doi, entry.doi)).get();
    if (row) return row.id;
  }
  // Leg 2: arXiv ID (partial-unique index)
  if (entry.arxivId) {
    const row = db
      .select({ id: papers.id })
      .from(papers)
      .where(eq(papers.arxiv_id, entry.arxivId))
      .get();
    if (row) return row.id;
  }
  // Leg 3: (title, year, first-author-last-name)
  if (entry.title && entry.year && entry.authors) {
    const entryFirstLast = firstAuthorLast(entry.authors).trim().toLowerCase();
    const titleNorm = entry.title.toLowerCase().trim();
    const candidates = db
      .select({ id: papers.id, title: papers.title, year: papers.year, authors: papers.authors })
      .from(papers)
      .where(eq(papers.year, entry.year))
      .all();
    for (const r of candidates) {
      if (
        r.title?.toLowerCase().trim() === titleNorm &&
        r.authors != null &&
        firstAuthorLast(r.authors).trim().toLowerCase() === entryFirstLast
      ) {
        return r.id;
      }
    }
  }
  return undefined;
}

type InsertResult =
  | { id: string; key: string; duplicate: false }
  | { duplicate: true; existingId: string };

/**
 * F3: synchronous insert for use inside db.transaction() — no await, no Promise.all.
 * F4: collision-safe key using 6-char ulid suffix.
 */
function insertPaper(
  tx: BunSQLiteDatabase,
  entry: ParsedEntry & { arxivId?: string; pdfPath?: string },
): InsertResult {
  const existing = findDuplicate(tx, {
    doi: entry.doi,
    arxivId: entry.arxivId,
    title: entry.title,
    year: entry.year,
    authors: entry.authors,
  });
  if (existing) return { duplicate: true, existingId: existing };

  const id = ulid();
  // F4: collision-safe key — 6-char ulid suffix prevents UNIQUE crash on same base.
  const lastNamePart =
    (entry.authors != null ? firstAuthorLast(entry.authors).trim() : "unknown")
      .toLowerCase()
      .replace(/[^a-z]/g, "") || "unknown";
  const titleWord =
    (entry.title.split(" ")[0] ?? "").toLowerCase().replace(/[^a-z]/g, "") || "x";
  const base = `${lastNamePart}${entry.year ?? "xxxx"}${titleWord}`;
  const key = `${base}-${id.slice(-6).toLowerCase()}`;

  tx.insert(papers)
    .values({
      id,
      key,
      title: entry.title,
      authors: entry.authors ?? null,
      year: entry.year ?? null,
      venue: entry.venue ?? null,
      doi: entry.doi ?? null,
      arxiv_id: entry.arxivId ?? null,
      pdf_path: entry.pdfPath ?? null,
      abstract: entry.abstract ?? null,
      imported_via: entry.importedVia,
      imported_at: nowIso(),
      status: "pending",
      priority: 0,
    })
    .run();

  return { id, key, duplicate: false };
}

/**
 * F5: opportunistic citation INSERT OR IGNORE — §8.2 "never blocked on".
 * Inserts a citations row for each reference whose DOI already exists in the corpus.
 */
function insertCitations(
  tx: BunSQLiteDatabase,
  citingId: string,
  references: CrossrefReference[],
): void {
  for (const ref of references) {
    if (!ref.DOI) continue;
    const cited = tx.select({ id: papers.id }).from(papers).where(eq(papers.doi, ref.DOI)).get();
    if (cited) {
      tx.insert(citations)
        .values({ citing_id: citingId, cited_id: cited.id })
        .onConflictDoNothing()
        .run();
    }
  }
}

// ── Response helpers ──────────────────────────────────────────────────────────

function errResp(error: string, message?: string): { error: string; message?: string } {
  return message !== undefined ? { error, message } : { error };
}

// ── Tool registration ─────────────────────────────────────────────────────────

export const registerTools: RegisterTools = (
  _server: McpServer,
  ctx: ServerContext,
  register: RegisterHelper,
) => {
  // ── scholar.ingest.bibtex ─────────────────────────────────────────────────
  register(
    "scholar.ingest.bibtex",
    {
      description:
        "Ingest papers from BibTeX or RIS. Supply `content` (paste) or `filePath` (absolute path). Returns { inserted, duplicates }.",
      inputSchema: z.object({
        content:  z.string().optional(),
        filePath: z.string().optional(),
        format:   z.enum(["bibtex", "ris", "auto"]).default("auto"),
      }),
    },
    async (args: unknown): Promise<unknown> => {
      const db = ctx.db; // §7.6 snapshot-at-entry
      if (!db) return errResp("SCHOLAR_NO_ACTIVE_CORPUS", "Activate a corpus first.");
      const { content, filePath, format = "auto" } = args as {
        content?: string;
        filePath?: string;
        format?: string;
      };
      if (!content && !filePath) return errResp("INGEST_NO_CONTENT", "Supply either content or filePath.");

      const corpusId   = ctx.config.activeCorpusId()!;
      const importDirs = ctx.config.get<string[]>("importDirs") ?? [];
      const roots      = getPdfRoots(ctx.configDb, corpusId, importDirs);

      let source = content ?? "";
      if (!source && filePath) {
        let resolved: string | null = null;
        for (const root of roots) {
          try { resolved = resolveUnderRoot(filePath, root); break; } catch { /* try next root */ }
        }
        if (!resolved) return errResp("PathEscapeError", "File path is outside all allowed import directories.");
        source = await Bun.file(resolved).text();
      }

      const fmt = format === "auto"
        ? source.trimStart().startsWith("TY  -") ? "ris" : "bibtex"
        : format;
      const entries = fmt === "ris" ? parseRis(source) : parseBibtex(source);

      // F3: serialize in single transaction — no Promise.all over inserts.
      const results: InsertResult[] = [];
      db.transaction((tx) => {
        for (const e of entries) results.push(insertPaper(tx, e));
      });

      const inserted = results.filter((r) => !r.duplicate).length;
      const dupes    = results.filter((r) => r.duplicate).length;
      return { inserted, duplicates: dupes };
    },
  );

  // ── scholar.ingest.doi ────────────────────────────────────────────────────
  register(
    "scholar.ingest.doi",
    {
      description: "Ingest a paper via CrossRef DOI lookup (polite tier). Returns insert result.",
      inputSchema: z.object({ doi: z.string() }),
    },
    async (args: unknown): Promise<unknown> => {
      const db = ctx.db; // §7.6
      if (!db) return errResp("SCHOLAR_NO_ACTIVE_CORPUS");

      const { doi } = args as { doi: string };

      // crossref.mailto is optional — omitting gives anonymous rate limits, not an error.
      const mailto = ctx.config.get<string>("crossref.mailto");
      let entry;
      try {
        entry = await fetchCrossref(doi, { mailto });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = err instanceof InvalidDoiError               ? "InvalidDoiError"
                   : msg.startsWith("CrossrefResponseInvalid")    ? "CrossrefResponseInvalid"
                   : "CrossrefFetchError";
        return errResp(code, msg);
      }

      let result!: InsertResult;
      db.transaction((tx) => {
        result = insertPaper(tx, entry);
        // F5: opportunistic citations for any reference whose DOI is already in corpus.
        if (!result.duplicate && entry.references?.length) {
          insertCitations(tx, result.id, entry.references);
        }
      });
      return result;
    },
  );

  // ── scholar.ingest.arxiv ──────────────────────────────────────────────────
  register(
    "scholar.ingest.arxiv",
    {
      description: "Ingest a paper from the arXiv Atom API. Optionally download the PDF.",
      inputSchema: z.object({
        id:          z.string(),
        downloadPdf: z.boolean().default(false),
      }),
    },
    async (args: unknown): Promise<unknown> => {
      const db = ctx.db; // §7.6
      if (!db) return errResp("SCHOLAR_NO_ACTIVE_CORPUS");

      const { id, downloadPdf = false } = args as { id: string; downloadPdf?: boolean };

      let entry;
      try {
        entry = await fetchArxiv(id, {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = msg.startsWith("InvalidArxivIdError") ? "InvalidArxivIdError"
                   : msg.startsWith("SanitizeError")       ? "SanitizeError"
                   : "ArxivFetchError";
        return errResp(code, msg);
      }

      let pdfPath: string | undefined;
      if (downloadPdf) {
        const corpusId = ctx.config.activeCorpusId()!;
        let pdfRoot: string | undefined;
        try {
          pdfRoot = defaultPdfRoot(ctx.configDb, corpusId);
        } catch {
          // ConfigurationIncompleteError — no default root configured; skip download
          ctx.log.warn("scholar.ingest.arxiv: no default PDF root; skipping download", {
            id: entry.arxivId,
          });
        }
        if (pdfRoot) {
          try {
            pdfPath = await downloadArxivPdf(entry.arxivId, { pdfRoot });
          } catch (err) {
            ctx.log.warn("arXiv PDF download failed", {
              id: entry.arxivId,
              err: String(err),
            });
          }
        }
      }

      let result!: InsertResult;
      db.transaction((tx) => {
        result = insertPaper(tx, { ...entry, pdfPath });
      });
      return result;
    },
  );

  // ── scholar.ingest.manual ─────────────────────────────────────────────────
  register(
    "scholar.ingest.manual",
    {
      description: "Add a paper with manually supplied metadata. No API lookup.",
      inputSchema: z.object({
        title:    z.string(),
        authors:  z.string().optional(),
        year:     z.number().int().optional(),
        venue:    z.string().optional(),
        doi:      z.string().optional(),
        arxivId:  z.string().optional(),
        abstract: z.string().optional(),
        pdfPath:  z.string().optional(),
      }),
    },
    async (args: unknown): Promise<unknown> => {
      const db = ctx.db; // §7.6
      if (!db) return errResp("SCHOLAR_NO_ACTIVE_CORPUS");

      const { title, authors, year, venue, doi, arxivId, abstract, pdfPath } = args as {
        title: string;
        authors?: string;
        year?: number;
        venue?: string;
        doi?: string;
        arxivId?: string;
        abstract?: string;
        pdfPath?: string;
      };

      let safeTitle: string;
      try {
        safeTitle = sanitizeText(title, { maxLen: 512 });
      } catch (err) {
        return errResp("SanitizeError", String(err));
      }
      if (!safeTitle.trim()) return errResp("SanitizeError", "Title is empty after sanitization.");

      let safeAuthors: string | undefined;
      try {
        safeAuthors = authors ? sanitizeText(authors, { maxLen: 1024 }) : undefined;
      } catch { /* sanitizeText errors on authors are non-fatal — drop the field */ }

      let safeVenue: string | undefined;
      try {
        safeVenue = venue ? sanitizeText(venue, { maxLen: 256 }) : undefined;
      } catch { /* non-fatal */ }

      let safeAbstract: string | undefined;
      try {
        safeAbstract = abstract ? sanitizeText(abstract, { maxLen: 8192 }) : undefined;
      } catch { /* non-fatal */ }

      // F6: validate DOI shape — encodeDoi throws InvalidDoiError on malformed input.
      let safeDoi: string | undefined;
      if (doi) {
        try {
          encodeDoi(doi); // throws InvalidDoiError if malformed
          safeDoi = sanitizeText(doi, { maxLen: 256 });
        } catch (err) {
          if (err instanceof InvalidDoiError) return errResp("InvalidDoiError", String(err));
          return errResp("SanitizeError", String(err));
        }
      }

      // F5: validate arXiv ID — validateArxivId throws InvalidArxivIdError if malformed.
      let safeArxivId: string | undefined;
      if (arxivId) {
        try {
          safeArxivId = validateArxivId(sanitizeText(arxivId, { maxLen: 64 }));
        } catch (err) {
          if (err instanceof InvalidArxivIdError) return errResp("InvalidArxivIdError", String(err));
          return errResp("SanitizeError", String(err));
        }
      }

      // §12.4: confine pdfPath against each active PDF root.
      let safePdfPath: string | undefined;
      if (pdfPath) {
        const corpusId = ctx.config.activeCorpusId()!;
        const roots    = getPdfRoots(ctx.configDb, corpusId, []);
        let resolved: string | null = null;
        for (const root of roots) {
          try { resolved = resolveUnderRoot(pdfPath, root); break; } catch { /* try next */ }
        }
        if (!resolved) return errResp("PathEscapeError", "pdfPath escapes every active PDF root.");
        safePdfPath = resolved;
      }

      const entry: ParsedEntry & { arxivId?: string; pdfPath?: string } = {
        title: safeTitle,
        authors: safeAuthors,
        year,
        venue: safeVenue,
        doi: safeDoi,
        arxivId: safeArxivId,
        abstract: safeAbstract,
        importedVia: "manual",
        pdfPath: safePdfPath,
      };

      let result!: InsertResult;
      db.transaction((tx) => {
        result = insertPaper(tx, entry);
      });
      return result;
    },
  );
};

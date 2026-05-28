// src/server/tools/ingest.test.ts — cycle 6.4 Task 4 RED
//
// Uses buildServer + dispatch pattern (established in corpus.test.ts).
// Mocks allPdfRoots/defaultPdfRoot so tests don't need real pdf_roots config rows.
// ctx.db is set directly after buildServer() to inject an in-memory corpus DB.
import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import Database from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, type BuiltServer } from "../index.ts";
import { openWithPragmas, applyMigrations } from "../db/migrations.ts";
import type { PdfChild } from "./registry.ts";
import { papers, citations } from "../db/schema.ts";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

// F1 test-isolation: mock the foundation helper so tests never hit the config DB pdf_roots table.
// Use /tmp as the test root — it always exists, so realpathSync inside resolveUnderRoot won't throw ENOENT.
mock.module("../db/default-pdf-root.ts", () => ({
  allPdfRoots: (_tx: unknown, _corpusId: string) => ["/tmp"],
  defaultPdfRoot: (_tx: unknown, _corpusId: string) => "/tmp",
  ConfigurationIncompleteError: class extends Error { override name = "ConfigurationIncompleteError"; },
}));

const mockPdf: PdfChild = {
  interact: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
  getText: async () => { throw new Error("PDF_CHILD_UNAVAILABLE"); },
  currentRoots: () => [],
  setRoots: async () => {},
  displayPdf: async () => ({ viewUUID: "stub-view-uuid" }),
  isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
};

function buildInMemoryCorpusDb(): BunSQLiteDatabase {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const db = drizzle(sqlite);
  // F4: migrations MUST run — papers and citations tables don't exist otherwise.
  // Use applyMigrations which resolves migrations relative to migrations.ts's import.meta.dir.
  applyMigrations(db);
  return db;
}

let dir: string;
let built: BuiltServer;
const origRuntimeRoot = process.env.SCHOLAR_RUNTIME_ROOT;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scholar-ingest-test-"));
  mkdirSync(join(dir, "dbs"), { recursive: true });
  process.env.SCHOLAR_RUNTIME_ROOT = dir;

  const configDb = openWithPragmas(join(dir, "dbs", "scholar-config.db"));
  applyMigrations(configDb);
  // Seed active corpus ID so ctx.config.activeCorpusId() returns "test-corpus"
  configDb.run(
    `INSERT INTO settings (key, value) VALUES ('activeCorpusId', '"test-corpus"') ON CONFLICT(key) DO NOTHING`,
  );

  built = buildServer({
    runtimeRoot: dir,
    openConfigDb: () => configDb,
    spawnPdfChild: () => mockPdf,
  });

  // Inject an in-memory corpus DB so ctx.db is defined
  built.ctx.db = buildInMemoryCorpusDb();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (origRuntimeRoot === undefined) delete process.env.SCHOLAR_RUNTIME_ROOT;
  else process.env.SCHOLAR_RUNTIME_ROOT = origRuntimeRoot;
});

const d = (tool: string, args: unknown) => built.dispatch(tool, args);

// ─── papers table sanity (F4) ─────────────────────────────────────────────────

describe("papers table exists after migrate (F4 sanity)", () => {
  test("buildInMemoryCorpusDb() produces a papers table", () => {
    const db = buildInMemoryCorpusDb();
    const rows = db.select().from(papers).all();
    expect(Array.isArray(rows)).toBe(true);
  });
});

// ─── Posture B regression: no sqlite3-mcp calls (M6 guard) ───────────────────

describe("Posture B: sqlite3-mcp never called", () => {
  test("ctx has no sqlite3 field", () => {
    expect((built.ctx as unknown as Record<string, unknown>).sqlite3).toBeUndefined();
  });
});

// ─── scholar.ingest.bibtex ────────────────────────────────────────────────────

describe("scholar.ingest.bibtex", () => {
  test("rejects when no corpus active (SCHOLAR_NO_ACTIVE_CORPUS)", async () => {
    // Override ctx.db to undefined for this test only
    built.ctx.db = undefined;
    const result = await d("scholar.ingest.bibtex", {
      content: "@article{t,title={X},author={A},year={2020}}",
    }) as { error: string };
    expect(result.error).toBe("SCHOLAR_NO_ACTIVE_CORPUS");
  });

  test("returns INGEST_NO_CONTENT when both content and filePath absent", async () => {
    const result = await d("scholar.ingest.bibtex", {}) as { error: string };
    expect(result.error).toBe("INGEST_NO_CONTENT");
  });

  test("inserts a paper row from valid BibTeX", async () => {
    await d("scholar.ingest.bibtex", {
      content: `@article{s,title={A Paper},author={Smith, John},year={2024},doi={10.1000/t}}`,
    });
    const rows = built.ctx.db!.select().from(papers).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.imported_via).toBe("bibtex");
  });

  test("DOI-duplicate: second insert returns duplicate signal, row count stays 1", async () => {
    const btx = `@article{t1,title={P},author={A, B},year={2020},doi={10.1000/dup}}`;
    await d("scholar.ingest.bibtex", { content: btx });
    const r = await d("scholar.ingest.bibtex", { content: btx }) as { duplicates: number };
    expect(built.ctx.db!.select().from(papers).all()).toHaveLength(1);
    expect(r.duplicates).toBe(1);
  });

  test("F4: two papers with same author+year get distinct keys (no UNIQUE crash)", async () => {
    await d("scholar.ingest.bibtex", {
      content: `@article{s1,title={Test method paper},author={Smith, J},year={2024}}`,
    });
    await d("scholar.ingest.bibtex", {
      content: `@article{s2,title={Test results paper},author={Smith, K},year={2024}}`,
    });
    const rows = built.ctx.db!.select().from(papers).all();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.key).not.toBe(rows[1]!.key);
  });
});

// ─── scholar.ingest.manual ───────────────────────────────────────────────────

describe("scholar.ingest.manual", () => {
  test("inserts paper with correct importedVia", async () => {
    await d("scholar.ingest.manual", { title: "Manual Paper", year: 2023 });
    expect(built.ctx.db!.select().from(papers).all()[0]!.imported_via).toBe("manual");
  });

  test("rejects pdfPath outside every PDF root (PathEscapeError)", async () => {
    const result = await d("scholar.ingest.manual", {
      title: "T",
      pdfPath: "/etc/passwd",
    }) as { error: string };
    expect(result.error).toBe("PathEscapeError");
  });

  test("rejects invalid DOI (InvalidDoiError)", async () => {
    const result = await d("scholar.ingest.manual", {
      title: "T",
      doi: "not-a-doi",
    }) as { error: string };
    expect(result.error).toBe("InvalidDoiError");
  });

  test("rejects invalid arXiv ID (InvalidArxivIdError)", async () => {
    const result = await d("scholar.ingest.manual", {
      title: "T",
      arxivId: "not-an-id",
    }) as { error: string };
    expect(result.error).toBe("InvalidArxivIdError");
  });
});

// ─── scholar.ingest.doi (citations) ──────────────────────────────────────────

describe("scholar.ingest.doi (citations)", () => {
  test("CrossRef references → citations row inserted when cited DOI already in corpus", async () => {
    const db = built.ctx.db!;

    // Insert cited paper with a known DOI.
    await d("scholar.ingest.manual", { title: "Cited Paper", doi: "10.9999/cited" });
    expect(db.select().from(papers).all()).toHaveLength(1);

    // Mock CrossRef API response
    const mockCrossref = {
      status: "ok",
      message: {
        title: ["Citing Paper"],
        author: [{ family: "Author", given: "A" }],
        published: { "date-parts": [[2024]] },
        DOI: "10.1000/citing",
        reference: [{ DOI: "10.9999/cited" }],
      },
    };

    const origFetch = globalThis.fetch;
    globalThis.fetch = mock((_url: string) =>
      Promise.resolve(new Response(JSON.stringify(mockCrossref), { status: 200 })),
    ) as unknown as typeof fetch;
    try {
      await d("scholar.ingest.doi", { doi: "10.1000/citing" });
    } finally {
      globalThis.fetch = origFetch;
    }

    expect(db.select().from(papers).all()).toHaveLength(2);
    // citations table must contain exactly one row: citing → cited
    const citationRows = db.select().from(citations).all();
    expect(citationRows).toHaveLength(1);
    expect(citationRows[0]!.cited_id).toBeDefined();
  });
});

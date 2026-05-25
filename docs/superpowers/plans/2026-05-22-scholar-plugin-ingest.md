# Scholar Plugin — Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan-id:** `2026-05-22-scholar-plugin-ingest`
**Plan-group:** `2026-05-22-scholar-plugin`
**Cycles:** `[6.4]`
**Depends-on:** `corpus`
**Blast-radius:** `src/server/ingest/` (excluding `src/server/ingest/primitives.ts`) `src/server/tools/ingest.ts`
**Worktree:** `not-required`
**Tier:** `sonnet` — 1 cycle (6.4); four well-scoped adapters (BibTeX/RIS, CrossRef DOI, arXiv, manual). Cross-spec reasoning is limited to routing untrusted input through the §12.0 primitives (imported, not designed here).

---

**Goal:** Implement the four metadata ingestion adapters and wire up the `scholar.ingest.*` MCP tools so papers can be added to an active corpus from BibTeX/RIS files, CrossRef DOI lookups, arXiv metadata fetches, and manual entry.

**Architecture:** Three adapter modules (`src/server/ingest/bibtex.ts`, `src/server/ingest/crossref.ts`, `src/server/ingest/arxiv.ts`) plus the tool-registration fill in `src/server/tools/ingest.ts`. Every untrusted-input boundary routes through the §12.0 primitives (`sanitizeText`, `resolveUnderRoot`, `encodeDoi`, `validateArxivId`) from foundation-owned `src/server/ingest/primitives.ts` — **do not create or edit that file**. Duplicate detection: DOI-first → arXiv ID → (title, year, first-author-last-name). `papers.key` is collision-safe via 6-char ulid suffix. Citations are populated opportunistically from CrossRef `references` data per §8.2.

**Tech Stack:** Bun, `bun:sqlite`, `drizzle-orm/bun-sqlite`, `@retorquere/bibtex-parser`, `zod`, `ulidx` (all pre-declared by foundation — no `bun add`), native `fetch`.

---

## Spec anchors

Verbatim quotes for drift detection at execution time. Any diff against the live spec-md signals a spec amendment — surface before proceeding.

> **§12.0 invariant (7 primitives):** "Every later subsection of §12 and every ingest adapter in §5.14–§5.16 MUST route untrusted input through these primitives. Bare string concatenation into prompts, paths, or HTTP requests is forbidden."

> **§12.1 three-leg dedupe:** "Duplicate detection is by `doi`, then `(title, year, first-author-last-name)`."

> **§12.3 TLS posture:** "Metadata is fetched over TLS from `https://export.arxiv.org/api/query?id_list=<id>` (cleartext HTTP would expose the in-flight metadata to a network attacker who could swap title/authors/abstract before sanitization)."

> **§12.4 root containment:** "The `pdf_path` field — the only filesystem input on this path — passes through `resolveUnderRoot(pdf_path, root)` from §12.0 against each of the active corpus's PDF roots; acceptance requires at least one root to contain it. A path that escapes every root is rejected before any row is written."

> **§7.6 ctx.db snapshot-at-entry:** "Every tool handler MUST snapshot `ctx.db` into a local at the very first line and read from that local for the rest of the call — re-reading `ctx.db` mid-call after an `await` would silently write to a different corpus."

> **§8.2 citation table behavior:** "Populated opportunistically from CrossRef `references` data when available; never blocked on. The v1 UI does not visualize the citation graph, but the data is captured so v2 can."

---

## Out of scope (handed to sibling plans)

| Sibling suffix | Cycles | Scope excluded from this plan |
|---|---|---|
| `foundation` | 6.1, 6.2 | `src/server/ingest/primitives.ts` (foundation-owned, do NOT edit); all nine tool module stubs; `src/server/db/schema.ts` + migrations; `allPdfRoots`/`defaultPdfRoot` helpers; `nowIso`/`ulid` re-exports; dependency pre-declaration |
| `corpus` | 6.3, 6.11, 6.12 | Corpus CRUD tools, roots tools, first-run wizard, `ctx.db` corpus-open/activate flow, `scholar.snapshot.take`, sqlite3-mcp registration. **A corpus must be active before any ingest tool can write.** |
| `extraction` | 6.5, 6.6, 6.8 | **Text extraction from PDFs is extraction's domain.** This plan ingests metadata only (title, authors, year, venue, DOI, arXiv ID, abstract, pdf_path). Chunking, embedding, `chunk_vec`, `reading_queue`, digest/prompts — all extraction. |
| `annotations` | 6.7 | Annotation CRUD and bidirectional pdf-MCP reconciliation. |
| `frontends` | 6.9, 6.10 | UI views, nu module, slash commands, skills. |
| `packaging` | 6.13 | `scripts/build-plugin.ts` plugin archive assembly. |

---

## Prerequisites

All of the following must be true before the executor starts:

- `src/server/ingest/primitives.ts` exists and exports all seven §12.0 helpers.
- `src/server/tools/ingest.ts` exists as a no-op stub exporting `registerTools(server, ctx): void`.
- `src/server/db/schema.ts` exports `papers` and `citations` Drizzle tables per §8.2.
- `src/server/db/migrations.ts` exists; Drizzle migrations folder is at `./drizzle/`.
- Foundation exports `allPdfRoots(corpusId: string, configDb: BunSQLiteDatabase): string[]` and `defaultPdfRoot(corpusId: string, configDb: BunSQLiteDatabase): string | undefined` — verify exact import path from foundation's plan-md (likely `src/server/db/index.ts`).
- Foundation exports `nowIso` and `ulid` from `src/server/db/nowIso.ts` (re-export from `ulidx`).
- `@retorquere/bibtex-parser`, `zod`, `ulidx` all present in `node_modules` (pre-declared by foundation; do **not** run `bun add`).
- **`crossref.mailto` ConfigAccessor key:** proposed to foundation via peer-DM. If accepted, use `ctx.config.get<string>("crossref.mailto") ?? "scholar-plugin@localhost"`. If declined, use the hardcoded fallback `"scholar-plugin@localhost"` documented as the intended v1 posture.
- `bun test` runs (even with zero passing tests).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/server/ingest/bibtex.ts` | **Create** | BibTeX adapter (`@retorquere/bibtex-parser`) + in-house RIS adapter (~80 LOC) per §5.14 |
| `src/server/ingest/bibtex.test.ts` | **Create** | BibTeX + RIS tests |
| `src/server/ingest/crossref.ts` | **Create** | CrossRef DOI adapter (polite tier, zod-validated response) |
| `src/server/ingest/crossref.test.ts` | **Create** | CrossRef tests |
| `src/server/ingest/arxiv.ts` | **Create** | arXiv Atom adapter with HTML entity decoding + optional PDF download |
| `src/server/ingest/arxiv.test.ts` | **Create** | arXiv tests including `downloadArxivPdf` |
| `src/server/tools/ingest.ts` | **Fill body** | `registerTools` — serialized bulk insert in `db.transaction`, opportunistic citations, all four `scholar.ingest.*` tools |
| `src/server/tools/ingest.test.ts` | **Create** | Integration tests via MCP Client + InMemoryTransport |

**Do not touch:** `src/server/ingest/primitives.ts`, `src/server/db/schema.ts`, `src/server/db/migrations.ts`, `src/server/tools/registry.ts`, `package.json`, `bun.lock`.

---

## Shared conventions (read once; apply everywhere)

**`ctx.db` snapshot-at-entry (§7.6):**
```typescript
const db = ctx.db;
if (!db) return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "SCHOLAR_NO_ACTIVE_CORPUS" }) }] };
const corpusId = ctx.config.activeCorpusId()!;
```

**No LLM-prompt building in ingest.** `wrapUntrusted` is extraction/digest domain. Not called here.

**Import sources (foundation-009 canonical):**
```typescript
import { nowIso, ulid } from "../db/nowIso.js";           // ulidx re-export
import { allPdfRoots, defaultPdfRoot } from "../db/index.js"; // verify path against foundation plan-md
import { sanitizeText, resolveUnderRoot, encodeDoi, validateArxivId } from "../ingest/primitives.js";
import type { SanitizeError, InvalidDoiError, InvalidArxivIdError, PathEscapeError } from "../ingest/primitives.js";
```

**InMemoryTransport — verified import (probed against `@modelcontextprotocol/sdk@1.29.0`):**
```typescript
// Probe result: wildcard export './*' → './dist/esm/*'; file confirmed at dist/esm/inMemory.js
// createLinkedPair() static method confirmed present.
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
```

**`papers.key` collision-safe derivation:**
```typescript
const base = `${lastNamePart}${entry.year ?? "xxxx"}${titleWord}`;
const key  = `${base}-${id.slice(-6).toLowerCase()}`;
```

**Duplicate detection order (§12.1):**
1. `doi` match — partial-unique index; null DOIs don't collide.
2. `arxiv_id` match — partial-unique index.
3. `(title, year, first-author-last-name)` match.

Return `{ duplicate: true, existingId }` rather than throwing.

**Synchronous DB helpers.** `bun:sqlite` + Drizzle `bun-sqlite` are synchronous. All DB calls use `.get()` / `.all()` / `.run()` (no `await`). The bulk-ingest handler wraps the serialized insert loop in `db.transaction(tx => { ... })` for atomicity and race-safety (no `Promise.all` over inserts).

---

## ConfigAccessor keys consumed (cycle 6.4)

`ConfigAccessor.get<T>(key: string)` accepts any string key per foundation-006 item-8 generic-typing pattern — the canonical-keys list is documentation, not a runtime gate. This table records which keys ingest reads and their pending canonicalization status.

| Key | Type | Semantics | Foundation canonical-list status |
|---|---|---|---|
| `crossref.mailto` | `string` (optional) | User email for CrossRef polite-tier `?mailto=` parameter. When present, CrossRef can contact the user about problematic queries and grants higher rate limits. When absent, CrossRef works at anonymous rate limits — no error, no fake-email stub. Configurable via corpus tools at first-run wizard time. | **Pending lead-owned chore `add-config-keys-from-cross-plan-coordination`** — proposed via cross-plan DM 2026-05-24, routed to lead by foundation. Mechanically usable now; canonical-list documentation lands post-atomic-commit. No ingest revision required. |
| `importDirs` | `string[]` | §12.1 third allow-list leg for ingest file scan paths (BibTeX/RIS `filePath` arg). | **Canonical** (foundation-006 item-8). |

---

## Task 1: BibTeX adapter + RIS adapter (`src/server/ingest/bibtex.ts`)

### 1-A: Red

- [ ] **Step 1: Write failing tests**

```typescript
// src/server/ingest/bibtex.test.ts
import { expect, test, describe } from "bun:test";
import { parseBibtex, parseRis } from "./bibtex.js";

const MINIMAL_BIBTEX = `@article{smith2024test,
  title  = {Test Paper},
  author = {Smith, John and Doe, Jane},
  year   = {2024},
  doi    = {10.1000/xyz123},
}`;

const INJECTION_BIBTEX = `@article{evil,
  title  = {Bad ‮ Title},
  author = {Attacker},
  year   = {2024},
}`;

const ARXIV_BIBTEX = `@misc{vaswani2017,
  title        = {Attention Is All You Need},
  author       = {Vaswani, Ashish},
  year         = {2017},
  eprint       = {1706.03762},
  archivePrefix = {arXiv},
}`;

const NON_ARXIV_EPRINT = `@misc{hal2017,
  title        = {A HAL Paper},
  author       = {Dupont, Jean},
  year         = {2017},
  eprint       = {hal-01234567},
  archivePrefix = {HAL},
}`;

const WHITESPACE_TITLE = `@article{blank,
  title  = {   },
  author = {Author},
  year   = {2020},
}`;

const MINIMAL_RIS = `TY  - JOUR
AU  - Smith, John
TI  - RIS Paper
PY  - 2023
DO  - 10.9999/ris-test
ER  -
`;

describe("parseBibtex", () => {
  test("parses minimal BibTeX entry", () => {
    const entries = parseBibtex(MINIMAL_BIBTEX);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Test Paper");
    expect(entries[0].year).toBe(2024);
    expect(entries[0].doi).toBe("10.1000/xyz123");
    expect(entries[0].importedVia).toBe("bibtex");
  });

  test("authors are semicolon-delimited 'Last, First' strings", () => {
    const entries = parseBibtex(MINIMAL_BIBTEX);
    expect(entries[0].authors).toBe("Smith, John; Doe, Jane");
  });

  test("skips entry with bidi-override title (onError=skip)", () => {
    expect(parseBibtex(INJECTION_BIBTEX, { onError: "skip" })).toHaveLength(0);
  });

  test("skips entry with whitespace-only title (F13)", () => {
    expect(parseBibtex(WHITESPACE_TITLE, { onError: "skip" })).toHaveLength(0);
  });

  test("extracts arxivId from eprint when archivePrefix is arXiv (F7)", () => {
    const entries = parseBibtex(ARXIV_BIBTEX);
    expect(entries[0].arxivId).toBe("1706.03762");
  });

  test("does NOT set arxivId when archivePrefix is not arXiv", () => {
    const entries = parseBibtex(NON_ARXIV_EPRINT);
    expect(entries[0].arxivId).toBeUndefined();
  });
});

describe("parseRis", () => {
  test("parses minimal RIS entry", () => {
    const entries = parseRis(MINIMAL_RIS);
    expect(entries[0].title).toBe("RIS Paper");
    expect(entries[0].year).toBe(2023);
    expect(entries[0].doi).toBe("10.9999/ris-test");
    expect(entries[0].importedVia).toBe("ris");
  });

  test("skips entry with no TI field", () => {
    const noTitle = `TY  - JOUR\nAU  - Author\nPY  - 2020\nER  -\n`;
    expect(parseRis(noTitle, { onError: "skip" })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect `Cannot find module './bibtex.js'`**

```bash
cd /home/ramda/code/scholar && bun test src/server/ingest/bibtex.test.ts
```

### 1-B: Green

- [ ] **Step 3: Implement `src/server/ingest/bibtex.ts`**

```typescript
// src/server/ingest/bibtex.ts
// BibTeX adapter (wraps @retorquere/bibtex-parser) + in-house RIS adapter.
// Both in one file per spec §5.14. No path-confinement here — that lives in tools/ingest.ts.
import { parse as parseBibtexRaw } from "@retorquere/bibtex-parser";
import { sanitizeText, validateArxivId } from "./primitives.js";

export interface ParsedEntry {
  key?: string;
  title: string;
  authors?: string;   // "Last, First; Last, First"
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;   // set for arXiv preprints (eprint + archivePrefix=arXiv)
  abstract?: string;
  importedVia: "bibtex" | "ris";
}

export interface ParseOptions {
  onError?: "skip"; // "throw" mode dropped in v1; all callers use "skip"
}

const MAX = { title: 512, authors: 1024, venue: 256, abstract: 8192 };

function safeText(raw: string | undefined, maxLen: number): string | undefined {
  if (!raw) return undefined;
  try { return sanitizeText(raw, { maxLen }); } catch { return undefined; }
}

// ── BibTeX ───────────────────────────────────────────────────────────────────

function normAuthors(raw: string | string[] | undefined): string | undefined {
  if (!raw) return undefined;
  return (Array.isArray(raw) ? raw : [raw]).join("; ");
}

export function parseBibtex(source: string, _opts: ParseOptions = {}): ParsedEntry[] {
  const ast = parseBibtexRaw(source, { errorHandler: () => undefined });
  const results: ParsedEntry[] = [];

  for (const entry of ast.entries) {
    const rawTitle = (entry.fields.title as string | undefined) ?? "";
    const title = safeText(rawTitle, MAX.title);
    // F13: skip whitespace-only titles
    if (!title || !title.trim()) continue;

    const authors = safeText(normAuthors(entry.fields.author as string | string[] | undefined), MAX.authors);
    const venue = safeText(
      (entry.fields.journal as string | undefined) ?? (entry.fields.booktitle as string | undefined),
      MAX.venue,
    );
    const abstract = safeText(entry.fields.abstract as string | undefined, MAX.abstract);
    const doi = safeText(entry.fields.doi as string | undefined, 256);

    const yearRaw = entry.fields.year as string | number | undefined;
    const year = yearRaw !== undefined ? parseInt(String(yearRaw), 10) : undefined;

    // F7: extract arXiv ID when archivePrefix === "arXiv"
    let arxivId: string | undefined;
    const archivePrefix = (entry.fields.archivePrefix as string | undefined)?.trim();
    const eprint = (entry.fields.eprint as string | undefined)?.trim();
    if (archivePrefix === "arXiv" && eprint) {
      try { arxivId = validateArxivId(eprint); } catch { /* malformed eprint — skip */ }
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

interface RisRecord { TY?: string; AU: string[]; TI?: string; PY?: string; JO?: string; T2?: string; DO?: string; AB?: string; }

function parseRisRaw(source: string): RisRecord[] {
  const records: RisRecord[] = [];
  let cur: RisRecord | null = null;
  for (const line of source.split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9])\s{1,2}-\s{1,2}(.*)$/);
    if (!m) continue;
    const [, tag, val] = m;
    if (tag === "TY") { cur = { TY: val.trim(), AU: [] }; }
    else if (tag === "ER") { if (cur) { records.push(cur); cur = null; } }
    else if (cur) {
      if (tag === "AU") cur.AU.push(val.trim());
      else if (tag === "TI") cur.TI = val.trim();
      else if (tag === "PY") cur.PY = val.trim().slice(0, 4);
      else if (tag === "JO") cur.JO = val.trim();
      else if (tag === "T2") cur.T2 = val.trim();
      else if (tag === "DO") cur.DO = val.trim();
      else if (tag === "AB") cur.AB = (cur.AB ?? "") + val.trim() + " ";
    }
  }
  return records;
}

export function parseRis(source: string, _opts: ParseOptions = {}): ParsedEntry[] {
  const results: ParsedEntry[] = [];
  for (const rec of parseRisRaw(source)) {
    const title = safeText(rec.TI, MAX.title);
    if (!title || !title.trim()) continue;  // F13

    results.push({
      title: title.trim(),
      authors: safeText(rec.AU.length > 0 ? rec.AU.join("; ") : undefined, MAX.authors),
      year: rec.PY ? parseInt(rec.PY, 10) : undefined,
      venue: safeText(rec.JO ?? rec.T2, MAX.venue),
      doi: safeText(rec.DO, 256),
      abstract: safeText(rec.AB?.trim(), MAX.abstract),
      importedVia: "ris",
    });
  }
  return results;
}
```

- [ ] **Step 4: `bun test src/server/ingest/bibtex.test.ts` — all pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/ingest/bibtex.ts src/server/ingest/bibtex.test.ts
git commit -m "feat(ingest): BibTeX + RIS adapters — sanitizeText, arXiv eprint extraction, whitespace guard"
```

---

## Task 2: CrossRef adapter (`src/server/ingest/crossref.ts`)

**CrossRef `reference` array:** Per §8.2 ("Populated opportunistically from CrossRef `references` data") and §12.2 ("Mapped fields: … references (citation graph candidates)"), this plan DOES map `references`. `fetchCrossref` returns the raw `references` array; `insertPaper` in `tools/ingest.ts` performs the opportunistic `INSERT OR IGNORE` into the `citations` table for any reference whose `DOI` matches an already-ingested paper. See Task 4.

### 2-A: Red

- [ ] **Step 1: Write failing tests**

```typescript
// src/server/ingest/crossref.test.ts
import { expect, test, describe, mock } from "bun:test";
import { fetchCrossref } from "./crossref.js";

const MOCK_CROSSREF = {
  status: "ok",
  message: {
    title: ["Test Article"],
    author: [{ family: "Smith", given: "John" }, { family: "Doe", given: "Jane" }],
    published: { "date-parts": [[2022]] },
    "container-title": ["Journal of Testing"],
    abstract: "<jats:p>An abstract.</jats:p>",
    DOI: "10.1000/xyz123",
    reference: [{ DOI: "10.9999/cited" }],
  },
};

describe("fetchCrossref", () => {
  test("parses a valid DOI response", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify(MOCK_CROSSREF), { status: 200 })));
    const entry = await fetchCrossref("10.1000/xyz123", {
      mailto: "test@example.com",
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(entry.title).toBe("Test Article");
    expect(entry.doi).toBe("10.1000/xyz123");
    expect(entry.year).toBe(2022);
    expect(entry.authors).toBe("Smith, John; Doe, Jane");
    expect(entry.importedVia).toBe("crossref");
    expect(entry.references).toEqual([{ DOI: "10.9999/cited" }]);
  });

  test("throws InvalidDoiError for malformed DOI", async () => {
    await expect(fetchCrossref("not-a-doi", { mailto: "t@t.com" })).rejects.toThrow();
  });

  test("URL contains encodeDoi-escaped DOI and mailto", async () => {
    let capturedUrl = "";
    const mockFetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify(MOCK_CROSSREF), { status: 200 }));
    });
    await fetchCrossref("10.1000/xyz123", { mailto: "test@example.com", fetch: mockFetch as unknown as typeof fetch });
    expect(capturedUrl).toContain("10.1000%2Fxyz123");
    expect(capturedUrl).toContain("mailto=test%40example.com");
  });

  test("omitting mailto omits ?mailto= from URL (no fake-email stub)", async () => {
    let capturedUrl = "";
    const mockFetch = mock((url: string) => { capturedUrl = url; return Promise.resolve(new Response(JSON.stringify(MOCK_CROSSREF), { status: 200 })); });
    await fetchCrossref("10.1000/xyz123", { fetch: mockFetch as unknown as typeof fetch }); // no mailto
    expect(capturedUrl).not.toContain("mailto");
  });

  test("throws on non-200 response", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response("Not Found", { status: 404 })));
    await expect(
      fetchCrossref("10.1000/xyz123", { mailto: "t@t.com", fetch: mockFetch as unknown as typeof fetch }),
    ).rejects.toThrow();
  });

  test("throws CrossrefResponseInvalid on malformed response shape (F7)", async () => {
    // published.date-parts as string instead of number[][] — zod rejects it
    const bad = { status: "ok", message: { title: ["T"], published: { "date-parts": "2024" } } };
    const mockFetch = mock(() => Promise.resolve(new Response(JSON.stringify(bad), { status: 200 })));
    await expect(
      fetchCrossref("10.1000/xyz123", { mailto: "t@t.com", fetch: mockFetch as unknown as typeof fetch }),
    ).rejects.toThrow(/CrossrefResponseInvalid/);
  });
});
```

- [ ] **Step 2: `bun test src/server/ingest/crossref.test.ts` — expect module not found**

### 2-B: Green

- [ ] **Step 3: Implement `src/server/ingest/crossref.ts`**

```typescript
// src/server/ingest/crossref.ts
// CrossRef API adapter (polite tier).
// §12.0: encodeDoi BEFORE URL interpolation; sanitizeText on every response field.
// §8.2 + §12.2: references array included in return value for opportunistic citation INSERT.
import { z } from "zod";
import { encodeDoi, sanitizeText } from "./primitives.js";
import type { ParsedEntry } from "./bibtex.js";

// Zod schema for runtime shape validation (F7 — defense against CrossRef API drift)
const CrossrefMessageSchema = z.object({
  title:             z.array(z.string()).optional(),
  author:            z.array(z.object({ family: z.string().optional(), given: z.string().optional() })).optional(),
  published:         z.object({ "date-parts": z.array(z.array(z.number())) }).optional(),
  "container-title": z.array(z.string()).optional(),
  abstract:          z.string().optional(),
  DOI:               z.string().optional(),
  // §8.2 + §12.2: reference array for opportunistic citation graph
  reference:         z.array(z.object({ DOI: z.string().optional() }).passthrough()).optional(),
});

export type CrossrefReference = { DOI?: string; [k: string]: unknown };

export type CrossrefEntry = ParsedEntry & {
  importedVia: "crossref";
  references?: CrossrefReference[];
};

const CROSSREF_BASE = "https://api.crossref.org/works";
const MAX = { title: 512, authors: 1024, venue: 256, abstract: 8192 };

function stripJats(s: string): string { return s.replace(/<[^>]+>/g, "").trim(); }

function normAuthors(authors: Array<{ family?: string; given?: string }>): string {
  return authors.map((a) => [a.family, a.given].filter(Boolean).join(", ")).join("; ");
}

export interface CrossrefOptions {
  // Optional: omitting means CrossRef works but at anonymous rate limits.
  // When present, CrossRef can contact the user about problematic queries (polite tier).
  // Set via ctx.config.get<string>("crossref.mailto") — configurable at first-run wizard.
  mailto?: string;
  fetch?: typeof globalThis.fetch;
}

export async function fetchCrossref(doi: string, opts: CrossrefOptions): Promise<CrossrefEntry> {
  const encodedDoi = encodeDoi(doi); // throws InvalidDoiError on bad format (§12.0)
  // §12.2 polite tier: append mailto only when configured; anonymous fallback is lower rate-limit but valid.
  const mailtoParam = opts.mailto ? `?mailto=${encodeURIComponent(opts.mailto)}` : "";
  const url = `${CROSSREF_BASE}/${encodedDoi}${mailtoParam}`;

  const fetcher = opts.fetch ?? globalThis.fetch;
  const resp = await fetcher(url);
  if (!resp.ok) throw new Error(`CrossRef HTTP ${resp.status} for DOI ${doi}`);

  const raw = (await resp.json()) as { status?: string; message?: unknown };
  const parsed = CrossrefMessageSchema.safeParse(raw.message);
  if (!parsed.success) {
    throw new Error(`CrossrefResponseInvalid: ${parsed.error.message}`);
  }
  const msg = parsed.data;

  const rawTitle = (msg.title ?? [])[0] ?? "";
  const title = sanitizeText(rawTitle, { maxLen: MAX.title });

  const rawAuthors = normAuthors(msg.author ?? []);
  const authors = rawAuthors ? sanitizeText(rawAuthors, { maxLen: MAX.authors }) : undefined;

  const rawVenue = (msg["container-title"] ?? [])[0];
  const venue = rawVenue ? sanitizeText(rawVenue, { maxLen: MAX.venue }) : undefined;

  const rawAbstract = msg.abstract ? stripJats(msg.abstract) : undefined;
  const abstract = rawAbstract ? sanitizeText(rawAbstract, { maxLen: MAX.abstract }) : undefined;

  const year = msg.published?.["date-parts"]?.[0]?.[0] ?? undefined;

  return {
    title,
    authors,
    year,
    venue,
    doi, // store canonical DOI, not percent-encoded form
    abstract,
    importedVia: "crossref",
    references: msg.reference,
  };
}
```

- [ ] **Step 4: `bun test src/server/ingest/crossref.test.ts` — all pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/ingest/crossref.ts src/server/ingest/crossref.test.ts
git commit -m "feat(ingest): CrossRef adapter — zod response validation, §8.2 references mapping"
```

---

## Task 3: arXiv adapter (`src/server/ingest/arxiv.ts`)

### 3-A: Red

- [ ] **Step 1: Write failing tests**

```typescript
// src/server/ingest/arxiv.test.ts
import { expect, test, describe, mock } from "bun:test";
import { fetchArxiv, downloadArxivPdf } from "./arxiv.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <title>Attention Is All You Need (Test)</title>
    <summary>A seminal paper on transformers.</summary>
    <published>2024-01-01T00:00:00Z</published>
    <author><name>Vaswani, Ashish</name></author>
    <author><name>Shazeer, Noam</name></author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1000/attention</arxiv:doi>
  </entry>
</feed>`;

// F10: entity-encoded bidi override — HTML entity must be decoded before sanitizeText
const ENTITY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00002v1</id>
    <title>Bad &#x202E; Title</title>
    <summary>Abstract.</summary>
    <published>2024-01-01T00:00:00Z</published>
    <author><name>Attacker</name></author>
  </entry>
</feed>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"></feed>`;

const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF magic

describe("fetchArxiv", () => {
  test("parses a valid modern arXiv ID", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(ATOM_FEED, { status: 200 })));
    const entry = await fetchArxiv("2401.00001", { fetch: mockFetch as unknown as typeof fetch });
    expect(entry.arxivId).toBe("2401.00001");
    expect(entry.title).toBe("Attention Is All You Need (Test)");
    expect(entry.abstract).toBe("A seminal paper on transformers.");
    expect(entry.year).toBe(2024);
    expect(entry.authors).toBe("Vaswani, Ashish; Shazeer, Noam");
    expect(entry.importedVia).toBe("arxiv");
  });

  test("accepts full arXiv URL", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(ATOM_FEED, { status: 200 })));
    const entry = await fetchArxiv("https://arxiv.org/abs/2401.00001", { fetch: mockFetch as unknown as typeof fetch });
    expect(entry.arxivId).toBe("2401.00001");
  });

  test("throws for garbage ID", async () => {
    await expect(fetchArxiv("not-an-id", {})).rejects.toThrow();
  });

  test("accepts legacy archive/YYMMNNN form", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(ATOM_FEED, { status: 200 })));
    await expect(fetchArxiv("cs.AI/0001001", { fetch: mockFetch as unknown as typeof fetch })).resolves.toBeDefined();
  });

  test("throws on empty feed", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response(EMPTY_FEED, { status: 200 })));
    await expect(fetchArxiv("2401.00001", { fetch: mockFetch as unknown as typeof fetch })).rejects.toThrow();
  });

  test("URL uses TLS (https://export.arxiv.org)", async () => {
    let capturedUrl = "";
    const mockFetch = mock((url: string) => { capturedUrl = url; return Promise.resolve(new Response(ATOM_FEED, { status: 200 })); });
    await fetchArxiv("2401.00001", { fetch: mockFetch as unknown as typeof fetch });
    expect(capturedUrl).toMatch(/^https:\/\/export\.arxiv\.org/);
  });

  test("HTML entity-encoded bidi override is rejected by sanitizeText (F10)", async () => {
    // decodeHtmlEntities converts &#x202E; → U+202E before sanitizeText sees it.
    // sanitizeText then rejects U+202E (bidi-override category). Entry should be dropped
    // (safeText returns undefined → title guard skips it) OR throw SanitizeError.
    const mockFetch = mock(() => Promise.resolve(new Response(ENTITY_FEED, { status: 200 })));
    // Either the entry is rejected (throws) or the title is sanitized to the non-bidi portion.
    // The key invariant: the raw &#x202E; codepoint must NOT reach the DB undetected.
    await expect(
      fetchArxiv("2401.00002", { fetch: mockFetch as unknown as typeof fetch }),
    ).rejects.toThrow(); // SanitizeError — title-less entry cannot be persisted
  });
});

// F14: downloadArxivPdf test coverage
describe("downloadArxivPdf", () => {
  test("writes PDF bytes to <pdfRoot>/arxiv/<id>.pdf and returns the path", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scholar-test-"));
    try {
      const mockFetch = mock(() =>
        Promise.resolve(new Response(FAKE_PDF, { status: 200, headers: { "content-type": "application/pdf" } })),
      );
      const result = await downloadArxivPdf("2401.00001", { pdfRoot: tmpRoot, fetch: mockFetch as unknown as typeof fetch });
      expect(result).toBe(path.join(tmpRoot, "arxiv", "2401.00001.pdf"));
      expect(fs.existsSync(result)).toBe(true);
      expect(fs.readFileSync(result)[0]).toBe(0x25); // %PDF magic
    } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
  });

  test("throws on non-200 PDF response", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scholar-test-"));
    try {
      const mockFetch = mock(() => Promise.resolve(new Response("Forbidden", { status: 403 })));
      await expect(
        downloadArxivPdf("2401.00001", { pdfRoot: tmpRoot, fetch: mockFetch as unknown as typeof fetch }),
      ).rejects.toThrow();
    } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
  });

  test("download to non-existent destination succeeds (F2 resolveUnderRoot dir pattern)", async () => {
    // This test validates that downloadArxivPdf uses resolveUnderRoot on the DIRECTORY,
    // not the non-existent file, so a fresh download target does not trigger ENOENT.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scholar-test-"));
    try {
      const mockFetch = mock(() =>
        Promise.resolve(new Response(FAKE_PDF, { status: 200 })),
      );
      // arxiv/ subdir does not exist yet — mkdir -p creates it
      await expect(
        downloadArxivPdf("2401.00001", { pdfRoot: tmpRoot, fetch: mockFetch as unknown as typeof fetch }),
      ).resolves.toBeDefined();
    } finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: `bun test src/server/ingest/arxiv.test.ts` — expect module not found**

### 3-B: Green

- [ ] **Step 3: Implement `src/server/ingest/arxiv.ts`**

```typescript
// src/server/ingest/arxiv.ts
// arXiv Atom API adapter with optional PDF download.
// §12.0: validateArxivId before URL interpolation; sanitizeText on all Atom fields.
// §12.3: TLS only (https://export.arxiv.org).
// F2: resolveUnderRoot applied to DIRECTORY (not non-existent file) for write targets.
// F10: HTML entities decoded before sanitizeText so &#x202E; → U+202E is caught.
import * as path from "node:path";
import { validateArxivId, sanitizeText, resolveUnderRoot } from "./primitives.js";
import type { ParsedEntry } from "./bibtex.js";

export type ArxivEntry = ParsedEntry & { importedVia: "arxiv"; arxivId: string };

const ARXIV_API = "https://export.arxiv.org/api/query";
const MAX = { title: 512, authors: 1024, abstract: 8192 };

function extractIdFromUrl(raw: string): string {
  const m = raw.match(/arxiv\.org\/abs\/([^\s?#]+)/i);
  return m ? m[1] : raw;
}

// F10: decode numeric and named HTML entities before sanitizeText.
// Covers the &#x202E; bypass vector; sanitizeText then catches U+202E as a bidi override.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g,            (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function extractTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<(?:[a-z]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[a-z]+:)?${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function parseAtom(xml: string, canonicalId: string): ArxivEntry {
  const rawTitle = decodeHtmlEntities(extractTag(xml, "title")).replace(/\s+/g, " ");
  const title = sanitizeText(rawTitle, { maxLen: MAX.title }); // throws SanitizeError if bidi/PUA present

  const rawAbstract = decodeHtmlEntities(extractTag(xml, "summary")).replace(/\s+/g, " ");
  const abstract = sanitizeText(rawAbstract, { maxLen: MAX.abstract });

  const authorBlocks = [...xml.matchAll(/<author>\s*<name>([^<]+)<\/name>/gi)];
  const rawAuthors = authorBlocks.map((m) => decodeHtmlEntities(m[1].trim())).join("; ");
  const authors = rawAuthors ? sanitizeText(rawAuthors, { maxLen: MAX.authors }) : undefined;

  const pubRaw = extractTag(xml, "published");
  const year = pubRaw ? new Date(pubRaw).getFullYear() : undefined;

  const rawDoi = decodeHtmlEntities(extractTag(xml, "doi"));
  const doi = rawDoi ? sanitizeText(rawDoi, { maxLen: 256 }) : undefined;

  return {
    title,
    authors,
    year: Number.isNaN(year) ? undefined : year,
    doi: doi || undefined,
    arxivId: canonicalId,
    abstract,
    importedVia: "arxiv",
  };
}

export interface ArxivOptions { fetch?: typeof globalThis.fetch; }

export async function fetchArxiv(rawId: string, opts: ArxivOptions): Promise<ArxivEntry> {
  const canonicalId = validateArxivId(extractIdFromUrl(rawId)); // throws InvalidArxivIdError
  const url = `${ARXIV_API}?id_list=${encodeURIComponent(canonicalId)}`;
  const fetcher = opts.fetch ?? globalThis.fetch;
  const resp = await fetcher(url);
  if (!resp.ok) throw new Error(`arXiv API HTTP ${resp.status} for ID ${canonicalId}`);
  const xml = await resp.text();
  if (!xml.includes("<entry>")) throw new Error(`arXiv: no entry found for ID ${canonicalId}`);
  return parseAtom(xml, canonicalId); // may throw SanitizeError on malicious title
}

export interface PdfDownloadOptions extends ArxivOptions { pdfRoot: string; }

/**
 * Downloads arXiv PDF to `<pdfRoot>/arxiv/<canonicalId>.pdf`.
 * F2: resolveUnderRoot is applied to the DIRECTORY (which exists after mkdir -p),
 * not the non-existent file target — avoiding the lstatSync ENOENT on write paths.
 */
export async function downloadArxivPdf(canonicalId: string, opts: PdfDownloadOptions): Promise<string> {
  const destDir = path.join(opts.pdfRoot, "arxiv");
  await Bun.$`mkdir -p ${destDir}`;
  // Confine the directory — resolveUnderRoot requires the target to exist (lstatSync), which it now does.
  const safeDir = resolveUnderRoot(destDir, opts.pdfRoot);
  const safeDest = path.join(safeDir, `${canonicalId}.pdf`);

  const pdfUrl = `https://arxiv.org/pdf/${encodeURIComponent(canonicalId)}.pdf`;
  const fetcher = opts.fetch ?? globalThis.fetch;
  const resp = await fetcher(pdfUrl);
  if (!resp.ok) throw new Error(`arXiv PDF HTTP ${resp.status} for ID ${canonicalId}`);
  await Bun.write(safeDest, resp);
  return safeDest;
}
```

- [ ] **Step 4: `bun test src/server/ingest/arxiv.test.ts` — all pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/ingest/arxiv.ts src/server/ingest/arxiv.test.ts
git commit -m "feat(ingest): arXiv adapter — HTML entity decode (F10), resolveUnderRoot dir pattern (F2), downloadArxivPdf tests"
```

---

## Task 4: Tool registration fill — `src/server/tools/ingest.ts`

Key behaviors:
- `ctx.db` snapshot + `corpusId` from `ctx.config.activeCorpusId()` at entry.
- PDF roots via `allPdfRoots(corpusId, ctx.configDb)` + `importDirs` from config.
- Bulk BibTeX/RIS ingest serialized inside a single `db.transaction()` — no `Promise.all` over inserts (F3).
- `insertPaperSync(tx, entry)` is synchronous; called from within the transaction.
- CrossRef handler performs opportunistic citation INSERTs after `insertPaperSync`.
- `papers.key` uses `${base}-${id.slice(-6).toLowerCase()}` for collision safety.

### 4-A: Red

- [ ] **Step 1: Write failing integration tests**

```typescript
// src/server/tools/ingest.test.ts
import { expect, test, describe, mock } from "bun:test";
import Database from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { papers, citations } from "../db/schema.js";
import { registerTools } from "./ingest.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// Probe result: @modelcontextprotocol/sdk@1.29.0 wildcard export './*' → './dist/esm/*'
// Confirmed: dist/esm/inMemory.js exports class InMemoryTransport { static createLinkedPair() }
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ServerContext } from "./registry.js";

// F1 test-isolation: mock the foundation helper so tests never hit the config DB.
// tools/ingest.ts has no test-only exports — allPdfRoots is injected via Bun module mock.
mock.module("../db/index.js", () => ({
  allPdfRoots:    (_corpusId: string, _configDb: unknown) => ["/tmp/test-root"],
  defaultPdfRoot: (_corpusId: string, _configDb: unknown) => "/tmp/test-root",
}));

function buildDb(): BunSQLiteDatabase {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite);
  // F4: migrations MUST run — papers (and citations) table does not exist without this.
  migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

function buildTestCtx(opts: { noCorpus?: boolean } = {}): ServerContext {
  const db = opts.noCorpus ? undefined : buildDb();
  return {
    db,
    configDb: buildDb(), // config DB also needs migrations if any config tables used
    pdf: null as any,
    config: {
      get: (key: string) => {
        if (key === "importDirs")       return [] as string[];
        if (key === "crossref.mailto")  return "test@example.com";
        return undefined;
      },
      set: () => {},
      corpora: () => [],
      activeCorpusId: () => "test-corpus",
    } as any,
    // F8: withCorpus must be present — §7.6 recommends new handlers prefer it.
    withCorpus: async <T>(fn: (d: BunSQLiteDatabase) => Promise<T> | T) =>
      opts.noCorpus
        ? Promise.reject(new Error("SCHOLAR_NO_ACTIVE_CORPUS"))
        : fn(db!),
    log: { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as ServerContext;
}

async function buildClient(ctx: ServerContext) {
  const server = new McpServer({ name: "test", version: "0" });
  registerTools(server, ctx);
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test-client", version: "0" }, { capabilities: {} });
  await client.connect(ct);
  return { client, db: ctx.db };
}

describe("papers table exists after migrate (F4 sanity)", () => {
  test("buildDb() produces a papers table", () => {
    const db = buildDb();
    const rows = db.select().from(papers).all();
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe("scholar.ingest.bibtex", () => {

  test("rejects when no corpus active (SCHOLAR_NO_ACTIVE_CORPUS)", async () => {
    const ctx = buildTestCtx({ noCorpus: true });
    const { client } = await buildClient(ctx);
    const result = await client.callTool({ name: "scholar.ingest.bibtex", arguments: { content: "@article{t,title={X},author={A},year={2020}}" } });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("SCHOLAR_NO_ACTIVE_CORPUS");
  });

  test("returns INGEST_NO_CONTENT when both content and filePath absent", async () => {
    const { client } = await buildClient(buildTestCtx());
    const result = await client.callTool({ name: "scholar.ingest.bibtex", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("INGEST_NO_CONTENT");
  });

  test("inserts a paper row from valid BibTeX", async () => {
    const ctx = buildTestCtx();
    const { client, db } = await buildClient(ctx);
    await client.callTool({ name: "scholar.ingest.bibtex", arguments: { content: `@article{s,title={A Paper},author={Smith, John},year={2024},doi={10.1000/t}}` } });
    const rows = db!.select().from(papers).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].imported_via).toBe("bibtex");
  });

  test("DOI-duplicate: second insert returns duplicate signal, row count stays 1", async () => {
    const ctx = buildTestCtx();
    const { client, db } = await buildClient(ctx);
    const btx = `@article{t1,title={P},author={A, B},year={2020},doi={10.1000/dup}}`;
    await client.callTool({ name: "scholar.ingest.bibtex", arguments: { content: btx } });
    const r = await client.callTool({ name: "scholar.ingest.bibtex", arguments: { content: btx } });
    expect(db!.select().from(papers).all()).toHaveLength(1);
    expect(JSON.parse((r.content[0] as { text: string }).text).duplicates).toBe(1);
  });

  test("F4: two papers with same author+year+titleWord get distinct keys (no UNIQUE crash)", async () => {
    const ctx = buildTestCtx();
    const { client, db } = await buildClient(ctx);
    await client.callTool({ name: "scholar.ingest.bibtex", arguments: { content: `@article{s1,title={Test method paper},author={Smith, J},year={2024}}` } });
    await client.callTool({ name: "scholar.ingest.bibtex", arguments: { content: `@article{s2,title={Test results paper},author={Smith, K},year={2024}}` } });
    const rows = db!.select().from(papers).all();
    expect(rows).toHaveLength(2);
    expect(rows[0].key).not.toBe(rows[1].key);
  });
});

describe("scholar.ingest.manual", () => {
  test("inserts paper with correct importedVia", async () => {
    const ctx = buildTestCtx();
    const { client, db } = await buildClient(ctx);
    await client.callTool({ name: "scholar.ingest.manual", arguments: { title: "Manual Paper", year: 2023 } });
    expect(db!.select().from(papers).all()[0].imported_via).toBe("manual");
  });

  test("rejects pdfPath outside every PDF root (PathEscapeError)", async () => {
    const { client } = await buildClient(buildTestCtx());
    const result = await client.callTool({ name: "scholar.ingest.manual", arguments: { title: "T", pdfPath: "/etc/passwd" } });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("PathEscapeError");
  });

  test("rejects invalid DOI (InvalidDoiError)", async () => {
    const { client } = await buildClient(buildTestCtx());
    const result = await client.callTool({ name: "scholar.ingest.manual", arguments: { title: "T", doi: "not-a-doi" } });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("InvalidDoiError");
  });

  test("rejects invalid arXiv ID (InvalidArxivIdError)", async () => {
    const { client } = await buildClient(buildTestCtx());
    const result = await client.callTool({ name: "scholar.ingest.manual", arguments: { title: "T", arxivId: "not-an-id" } });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("InvalidArxivIdError");
  });
});

// F5 integration test: opportunistic citations row inserted for matched DOI
describe("scholar.ingest.doi (citations)", () => {
  test("CrossRef references → citations row inserted when cited DOI already in corpus", async () => {
    // Setup: seed the corpus with the cited paper first (imported_via manual).
    const ctx = buildTestCtx();
    const { client, db } = await buildClient(ctx);
    // Insert cited paper with a known DOI.
    await client.callTool({ name: "scholar.ingest.manual", arguments: { title: "Cited Paper", doi: "10.9999/cited" } });
    expect(db!.select().from(papers).all()).toHaveLength(1);

    // Now ingest citing paper via DOI lookup (mocked CrossRef response).
    // Use mock.module or a fetchCrossref spy — here we override fetch globally for this test scope.
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
    // Intercept the network call; the scholar.ingest.doi tool calls fetchCrossref, which calls globalThis.fetch.
    // Patch the module's fetch: use Bun's globalThis.fetch override for test isolation.
    const origFetch = globalThis.fetch;
    globalThis.fetch = mock((_url: string) =>
      Promise.resolve(new Response(JSON.stringify(mockCrossref), { status: 200 }))
    ) as typeof fetch;
    try {
      await client.callTool({ name: "scholar.ingest.doi", arguments: { doi: "10.1000/citing" } });
    } finally { globalThis.fetch = origFetch; }

    expect(db!.select().from(papers).all()).toHaveLength(2);
    // The citations table must contain exactly one row: citing → cited.
    const citationRows = db!.select().from(citations).all();
    expect(citationRows).toHaveLength(1);
    expect(citationRows[0].cited_id).toBeDefined(); // the cited paper's ID
  });
});
```

- [ ] **Step 2: `bun test src/server/tools/ingest.test.ts` — expect failures (stub is empty)**

### 4-B: Green

- [ ] **Step 3: Fill `src/server/tools/ingest.ts`**

```typescript
// src/server/tools/ingest.ts
// Registers scholar.ingest.* tools.
// Foundation scaffolded this as a no-op stub; this plan fills the body.
// §7.6: exports registerTools(server, ctx): void.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { ServerContext } from "./registry.js";
import { papers, citations } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { nowIso, ulid } from "../db/nowIso.js";  // ulidx re-export per foundation-009
// F1: allPdfRoots + defaultPdfRoot are foundation-007 helpers, NOT config keys.
// Verify import path against foundation plan-md (likely src/server/db/index.ts).
import { allPdfRoots, defaultPdfRoot } from "../db/index.js";
import { parseBibtex, parseRis, type ParsedEntry } from "../ingest/bibtex.js";
import { fetchCrossref, type CrossrefReference } from "../ingest/crossref.js";
import { fetchArxiv, downloadArxivPdf } from "../ingest/arxiv.js";
import { sanitizeText, resolveUnderRoot, encodeDoi, validateArxivId } from "../ingest/primitives.js";

// No test-only exports — pdf roots are injected via Bun's mock.module in tests.
function getPdfRoots(corpusId: string, configDb: BunSQLiteDatabase, importDirs: string[]): string[] {
  return [...allPdfRoots(corpusId, configDb), ...importDirs, process.env.USERPROFILE ?? process.env.HOME ?? ""].filter(Boolean);
}

// ── Duplicate detection (§12.1 three-leg order) ──────────────────────────────

function findDuplicateSync(
  db: BunSQLiteDatabase,
  entry: { doi?: string; arxivId?: string; title?: string; year?: number; authors?: string },
): string | undefined {
  if (entry.doi) {
    const row = db.select({ id: papers.id }).from(papers).where(eq(papers.doi, entry.doi)).get();
    if (row) return row.id;
  }
  if (entry.arxivId) {
    const row = db.select({ id: papers.id }).from(papers).where(eq(papers.arxiv_id, entry.arxivId)).get();
    if (row) return row.id;
  }
  if (entry.title && entry.year && entry.authors) {
    const firstAuthorLast = entry.authors.split(";")[0].split(",")[0].trim().toLowerCase();
    const titleNorm = entry.title.toLowerCase().trim();
    const candidates = db.select({ id: papers.id, title: papers.title, year: papers.year, authors: papers.authors })
      .from(papers).where(eq(papers.year, entry.year)).all();
    for (const r of candidates) {
      if (r.title?.toLowerCase().trim() === titleNorm &&
          r.authors?.split(";")[0].split(",")[0].trim().toLowerCase() === firstAuthorLast) {
        return r.id;
      }
    }
  }
  return undefined;
}

type InsertResult = { id: string; duplicate: false } | { duplicate: true; existingId: string };

// F3: synchronous insert for use inside db.transaction() — no await, no Promise.all.
function insertPaperSync(
  tx: BunSQLiteDatabase,
  entry: ParsedEntry & { arxivId?: string; pdfPath?: string },
): InsertResult {
  const existing = findDuplicateSync(tx, { doi: entry.doi, arxivId: entry.arxivId, title: entry.title, year: entry.year, authors: entry.authors });
  if (existing) return { duplicate: true, existingId: existing };

  const id = ulid();
  // F4: collision-safe key — 6-char ulid suffix prevents UNIQUE crash on same base.
  const lastNamePart = (entry.authors?.split(";")[0].split(",")[0].trim() ?? "unknown").toLowerCase().replace(/[^a-z]/g, "") || "unknown";
  const titleWord = (entry.title.split(" ")[0] ?? "").toLowerCase().replace(/[^a-z]/g, "") || "x";
  const base = `${lastNamePart}${entry.year ?? "xxxx"}${titleWord}`;
  const key  = `${base}-${id.slice(-6).toLowerCase()}`;

  tx.insert(papers).values({
    id, key,
    title:       entry.title,
    authors:     entry.authors ?? null,
    year:        entry.year ?? null,
    venue:       entry.venue ?? null,
    doi:         entry.doi ?? null,
    arxiv_id:    entry.arxivId ?? null,
    pdf_path:    entry.pdfPath ?? null,
    abstract:    entry.abstract ?? null,
    imported_via: entry.importedVia,
    imported_at: nowIso(),
    status:      "pending",
    priority:    0,
  }).run();

  return { id, duplicate: false };
}

// F5: opportunistic citation INSERT OR IGNORE — §8.2 "never blocked on".
function insertCitationsSync(
  tx: BunSQLiteDatabase,
  citingId: string,
  references: CrossrefReference[],
): void {
  for (const ref of references) {
    if (!ref.DOI) continue;
    const cited = tx.select({ id: papers.id }).from(papers).where(eq(papers.doi, ref.DOI)).get();
    if (cited) {
      tx.insert(citations).values({ citing_id: citingId, cited_id: cited.id })
        .onConflictDoNothing()
        .run();
    }
  }
}

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerTools(server: McpServer, ctx: ServerContext): void {

  // ── scholar.ingest.bibtex ─────────────────────────────────────────────────
  server.registerTool("scholar.ingest.bibtex", {
    description: "Ingest papers from BibTeX or RIS. Supply `content` (paste) or `filePath` (absolute path).",
    inputSchema: z.object({
      content:  z.string().optional(),
      filePath: z.string().optional(),
      format:   z.enum(["bibtex", "ris", "auto"]).default("auto"),
    }),
  }, async ({ content, filePath, format }) => {
    const db = ctx.db; // §7.6
    if (!db) return errResp("SCHOLAR_NO_ACTIVE_CORPUS", "Activate a corpus first.");
    if (!content && !filePath) return errResp("INGEST_NO_CONTENT", "Supply either content or filePath.");

    const corpusId   = ctx.config.activeCorpusId()!;
    const importDirs = ctx.config.get<string[]>("importDirs") ?? [];
    const roots      = getPdfRoots(corpusId, ctx.configDb, importDirs);

    let source = content ?? "";
    if (!source && filePath) {
      let resolved: string | null = null;
      for (const root of roots) { try { resolved = resolveUnderRoot(filePath, root); break; } catch { /* try next */ } }
      if (!resolved) return errResp("PathEscapeError", "File path is outside all allowed import directories.");
      source = await Bun.file(resolved).text();
    }

    const fmt = format === "auto" ? (source.trimStart().startsWith("TY  -") ? "ris" : "bibtex") : format;
    const entries = fmt === "ris" ? parseRis(source) : parseBibtex(source);

    // F3: serialize in single transaction — no Promise.all, no partial-unique races.
    const results: InsertResult[] = [];
    db.transaction((tx) => { for (const e of entries) results.push(insertPaperSync(tx, e)); });

    const inserted = results.filter((r) => !r.duplicate).length;
    const dupes    = results.filter((r) => r.duplicate).length;
    return okResp({ inserted, duplicates: dupes });
  });

  // ── scholar.ingest.doi ────────────────────────────────────────────────────
  server.registerTool("scholar.ingest.doi", {
    description: "Ingest a paper via CrossRef DOI lookup (polite tier).",
    inputSchema: z.object({ doi: z.string() }),
  }, async ({ doi }) => {
    const db = ctx.db;
    if (!db) return errResp("SCHOLAR_NO_ACTIVE_CORPUS");

    // crossref.mailto is optional — omitting gives anonymous rate limits, not an error.
    const mailto = ctx.config.get<string>("crossref.mailto");
    let entry;
    try { entry = await fetchCrossref(doi, { mailto }); }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.startsWith("CrossrefResponseInvalid") ? "CrossrefResponseInvalid"
                 : msg.startsWith("InvalidDoiError")        ? "InvalidDoiError"
                 : "CrossrefFetchError";
      return errResp(code, msg);
    }

    let result: InsertResult;
    db.transaction((tx) => {
      result = insertPaperSync(tx, entry);
      // F5: opportunistic citation inserts for any reference whose DOI is already in corpus.
      if (!result.duplicate && entry.references?.length) {
        insertCitationsSync(tx, result.id, entry.references);
      }
    });
    return okResp(result!);
  });

  // ── scholar.ingest.arxiv ──────────────────────────────────────────────────
  server.registerTool("scholar.ingest.arxiv", {
    description: "Ingest a paper from the arXiv Atom API. Optionally download the PDF.",
    inputSchema: z.object({
      id:          z.string(),
      downloadPdf: z.boolean().default(false),
    }),
  }, async ({ id, downloadPdf }) => {
    const db = ctx.db;
    if (!db) return errResp("SCHOLAR_NO_ACTIVE_CORPUS");

    let entry;
    try { entry = await fetchArxiv(id, {}); }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.startsWith("InvalidArxivIdError") ? "InvalidArxivIdError"
                 : msg.startsWith("SanitizeError")       ? "SanitizeError"
                 : "ArxivFetchError";
      return errResp(code, msg);
    }

    let pdfPath: string | undefined;
    if (downloadPdf) {
      const corpusId = ctx.config.activeCorpusId()!;
      const pdfRoot  = defaultPdfRoot(corpusId, ctx.configDb);
      if (pdfRoot) {
        try { pdfPath = await downloadArxivPdf(entry.arxivId, { pdfRoot }); }
        catch (err) { ctx.log.warn("arXiv PDF download failed", { id: entry.arxivId, err: String(err) }); }
      }
    }

    let result: InsertResult;
    db.transaction((tx) => { result = insertPaperSync(tx, { ...entry, pdfPath }); });
    return okResp(result!);
  });

  // ── scholar.ingest.manual ─────────────────────────────────────────────────
  server.registerTool("scholar.ingest.manual", {
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
  }, async ({ title, authors, year, venue, doi, arxivId, abstract, pdfPath }) => {
    const db = ctx.db;
    if (!db) return errResp("SCHOLAR_NO_ACTIVE_CORPUS");

    let safeTitle: string;
    try { safeTitle = sanitizeText(title, { maxLen: 512 }); }
    catch (err) { return errResp("SanitizeError", String(err)); }
    if (!safeTitle.trim()) return errResp("SanitizeError", "Title is empty after sanitization.");

    const safeAuthors  = authors  ? sanitizeText(authors,  { maxLen: 1024 }) : undefined;
    const safeVenue    = venue    ? sanitizeText(venue,    { maxLen: 256  }) : undefined;
    const safeAbstract = abstract ? sanitizeText(abstract, { maxLen: 8192 }) : undefined;

    // F6: validate DOI shape — encodeDoi throws InvalidDoiError on malformed input.
    let safeDoi: string | undefined;
    if (doi) {
      try { encodeDoi(doi); safeDoi = sanitizeText(doi, { maxLen: 256 }); }
      catch (err) { return errResp("InvalidDoiError", String(err)); }
    }

    // F5: validate arXiv ID — validateArxivId throws InvalidArxivIdError if malformed.
    let safeArxivId: string | undefined;
    if (arxivId) {
      try { safeArxivId = validateArxivId(sanitizeText(arxivId, { maxLen: 64 })); }
      catch (err) { return errResp("InvalidArxivIdError", String(err)); }
    }

    // §12.4: confine pdfPath against each active PDF root.
    let safePdfPath: string | undefined;
    if (pdfPath) {
      const corpusId = ctx.config.activeCorpusId()!;
      const roots    = getPdfRoots(corpusId, ctx.configDb, []);
      let resolved: string | null = null;
      for (const root of roots) { try { resolved = resolveUnderRoot(pdfPath, root); break; } catch { /* try next */ } }
      if (!resolved) return errResp("PathEscapeError", "pdfPath escapes every active PDF root.");
      safePdfPath = resolved;
    }

    const entry: ParsedEntry & { arxivId?: string; pdfPath?: string } = {
      title: safeTitle, authors: safeAuthors, year, venue: safeVenue,
      doi: safeDoi, arxivId: safeArxivId, abstract: safeAbstract,
      importedVia: "manual", pdfPath: safePdfPath,
    };

    let result: InsertResult;
    db.transaction((tx) => { result = insertPaperSync(tx, entry); });
    return okResp(result!);
  });
}

// ── Response helpers ──────────────────────────────────────────────────────────
function errResp(error: string, message?: string) {
  return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ error, message }) }] };
}
function okResp(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}
```

- [ ] **Step 4: `bun test src/server/tools/ingest.test.ts` — all pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/tools/ingest.ts src/server/tools/ingest.test.ts
git commit -m "feat(ingest): tool registration — serialized tx (F3), allPdfRoots helper (F1), citations (F5), collision-safe keys (F4)"
```

---

## Task 5: Full suite pass

- [ ] **Step 1: Full test run**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Type-check**

```bash
# Primary — works without the typescript package:
bun build src/server/tools/ingest.ts src/server/ingest/bibtex.ts \
  src/server/ingest/crossref.ts src/server/ingest/arxiv.ts \
  --no-emit --target=bun 2>&1 | grep -E "^error" || echo "No type errors"
# If tsc is available:
# bun run tsc --noEmit
```

- [ ] **Step 3: Commit any cleanup**

```bash
git add -A && git commit -m "chore(ingest): type-check + test-suite clean-up pass"
```

---

## Self-review checklist

| Requirement | Task |
|---|---|
| §6.4 BibTeX via `@retorquere/bibtex-parser` | Task 1 |
| §5.14 in-house RIS adapter in `bibtex.ts` | Task 1 |
| §12.0 `sanitizeText` on every external string | Tasks 1–4 |
| §12.1 file-path `resolveUnderRoot` against all roots (pdfRoots + importDirs + profile) | Task 4 |
| §12.1 three-leg duplicate detection (DOI → arXiv → title/year/author) | Task 4 `findDuplicateSync` |
| §12.2 CrossRef `encodeDoi` before URL interpolation | Task 2 |
| §12.2 CrossRef `references` mapped → opportunistic citations INSERT OR IGNORE | Tasks 2, 4 |
| §12.3 arXiv TLS (`https://export.arxiv.org`) | Task 3 |
| §12.3 arXiv PDF `resolveUnderRoot` on directory (F2 write-target pattern) | Task 3 |
| §12.4 manual `pdfPath` confined via `resolveUnderRoot` against each root | Task 4 |
| §12.4 manual `doi` validated via `encodeDoi` (F6) | Task 4 |
| §12.4 manual `arxivId` validated via `validateArxivId` (F5) | Task 4 |
| §7.6 `ctx.db` snapshot-at-entry in every handler | Task 4 |
| §7.6 `registerTools(server, ctx): void` signature | Task 4 |
| §8.2 `papers.key` collision-safe `${base}-${id.slice(-6)}` (F4) | Task 4 `insertPaperSync` |
| §8.2 `citations` table populated opportunistically for CrossRef (F5) | Task 4 `insertCitationsSync` |
| §8.2 `papers.pdf_path` persisted for arXiv download + manual entry | Task 4 `insertPaperSync` |
| F1 `allPdfRoots`/`defaultPdfRoot` foundation helpers (not config keys) | Task 4 |
| F2 `resolveUnderRoot(destDir, pdfRoot)` pattern for write targets | Task 3 `downloadArxivPdf` |
| F3 serialized `db.transaction()` — no `Promise.all` over inserts | Task 4 bibtex handler |
| F4 Drizzle `migrate()` uncommented in test setup | Task 4 `buildDb()` |
| F7 arXiv BibTeX eprint + archivePrefix extraction | Task 1 `parseBibtex` |
| F7 CrossRef response zod-validated (not `as`-cast) | Task 2 `CrossrefMessageSchema` |
| F8 `withCorpus` present in test mock | Task 4 `buildTestCtx` |
| F10 HTML entity decode before `sanitizeText` in arXiv adapter | Task 3 `decodeHtmlEntities` |
| F11 `InMemoryTransport` import path verified (`@modelcontextprotocol/sdk/inMemory.js`) | Task 4 test (probe comment) |
| F12 `safeText` throw-mode dropped; callers use skip semantics | Task 1 `safeText` |
| F13 whitespace-only title guard `!title.trim()` | Tasks 1, 3 |
| F14 `downloadArxivPdf` test coverage (2 tests) | Task 3 test |
| No test-only exports in production module (`setTestPdfRoots` removed; `mock.module` used instead) | Task 4 test + `tools/ingest.ts` |
| F5 citations integration test — asserts `citations` row appears after CrossRef DOI ingest | Task 4 citations describe block |
| CrossRef + arXiv handler error codes structured (`CrossrefResponseInvalid`/`InvalidDoiError`/`CrossrefFetchError`/`InvalidArxivIdError`/`ArxivFetchError`) not `String(err)` blob | Task 4 DOI + arXiv handlers |
| `titleWord` fallback `\|\| "x"` placed AFTER regex (not before), avoiding empty-base collapse on all-unicode titles | Task 4 `insertPaperSync` |
| `wrapUntrusted` correctly absent (extraction/digest domain) | N/A |

### Posture-B regression-guard (deferred)

The canonical pattern at `src/server/tools/corpus.test.ts:259-280` wraps
`built.ctx.pdf` in a Proxy that throws on any property-access whose
name contains `"sqlite3"`, then exercises the happy-path handlers. If
any code path attempts to dereference the dropped `ctx.sqlite3.*`
delegated dependency from pre-posture-B, the test fails fast.

For this plan, the parallel guard belongs in `src/server/tools/ingest.test.ts`,
exercising `scholar.ingest.bibtex` or `scholar.ingest.crossref`. Documented
post-execution by chore `propagate-proxy-regression-guard-across-plans`; add as a
Red test in a future posture-B regression refactor cycle — NOT added by this chore
because the plan-md is immutable post-close (plan-group
`2026-05-22-scholar-plugin` closed at c4f61da on 2026-05-25).
| No `bun add` / no `package.json` edit | All tasks |

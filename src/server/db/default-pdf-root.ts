// src/server/db/default-pdf-root.ts — foundation cycle 6.1 (Task 1.4c)
//
// Spec §8.1 default-root lookup. Asserts exactly one is_default=true row;
// the `pdf_roots_one_default_idx` partial unique index makes "more than one"
// impossible, so the only failure mode is "zero rows" → ConfigurationIncompleteError.
//
// Cross-plan helper convention (CLAUDE.md): first arg is the `tx` handle so
// callers wrap inside `db.transaction(tx => defaultPdfRoot(tx, corpusId))`.
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";

export class ConfigurationIncompleteError extends Error {
  constructor(corpusId: string) {
    super(`Corpus ${corpusId} has no default PDF root configured. Run scholar.roots.set-default to fix.`);
    this.name = "ConfigurationIncompleteError";
  }
}

export function defaultPdfRoot(tx: BunSQLiteDatabase, corpusId: string): string {
  const rows = tx.all(
    sql`SELECT path FROM pdf_roots WHERE corpus_id = ${corpusId} AND is_default = 1`,
  ) as { path: string }[];
  if (rows.length === 0) throw new ConfigurationIncompleteError(corpusId);
  // Partial unique index guarantees rows.length <= 1; the explicit guard is
  // defense-in-depth for cases where the index didn't get applied (e.g., a
  // raw-DDL bug in migrations.ts).
  if (rows.length > 1) {
    throw new Error(
      `Internal invariant violated: corpus ${corpusId} has ${rows.length} default PDF roots (pdf_roots_one_default_idx not applied?)`,
    );
  }
  return rows[0]!.path;
}

/**
 * Cross-plan helper (foundation-owned). Returns all pdf_roots.path rows for
 * the given corpus in insertion order (pdf_roots.id ASC, which is equivalent
 * to created_at ASC given the AUTOINCREMENT primary key). Empty array is valid —
 * the corpus exists but has no roots configured yet (the UI surfaces this as
 * a "configure a PDF root" affordance).
 *
 * Used by corpus.activate (`ctx.pdf.setRoots(allPdfRoots(tx, corpusId))`) and
 * by scholar.roots.list. Follows the tx-first cross-plan-helper convention
 * (CLAUDE.md): callers wrap inside `db.transaction(tx => allPdfRoots(tx, id))`.
 *
 * Note: the pdf_roots schema uses AUTOINCREMENT `id` for ordering (no created_at
 * column); `id ASC` is the stable insertion-order proxy.
 */
export function allPdfRoots(tx: BunSQLiteDatabase, corpusId: string): string[] {
  const rows = tx.all(
    sql`SELECT path FROM pdf_roots WHERE corpus_id = ${corpusId} ORDER BY id ASC`,
  ) as { path: string }[];
  return rows.map((r) => r.path);
}

// src/server/tools/roots.ts — corpus plan cycle 6.3 (Green)
//
// Implements scholar.roots.{list,add,remove,set-default} per §7.6, §8.1.
// Mirrors the active corpus's PDF-root set into the pdf child via ctx.pdf.setRoots
// after every mutation.
//
// All root mutations wrap in rawClient().transaction() — no awaits inside closure
// (§13 annotation-reconciliation discipline applies here too for write-lock hygiene).
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { RegisterTools, ServerContext } from "./registry.ts";
import { rawClient } from "../db/raw-client.ts";
import { allPdfRoots } from "../db/default-pdf-root.ts";

// ─── error ────────────────────────────────────────────────────────────────────

class RootsError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "RootsError";
  }
}

// ─── require-active helper ────────────────────────────────────────────────────

function requireActive(ctx: ServerContext): string {
  const slug = ctx.config.activeCorpusId();
  if (!slug) throw new RootsError("NO_ACTIVE_CORPUS", "No active corpus. Call scholar.corpus.activate first.");
  return slug;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Handlers
// ═══════════════════════════════════════════════════════════════════════════════

// ─── scholar.roots.list ───────────────────────────────────────────────────────

async function handleList(_args: unknown, ctx: ServerContext): Promise<unknown> {
  const _db = ctx.db; // snapshot at entry
  const slug = requireActive(ctx);

  const rows = ctx.configDb.all(
    sql`SELECT path, is_default FROM pdf_roots WHERE corpus_id = ${slug} ORDER BY id ASC`,
  ) as { path: string; is_default: boolean | number }[];

  return {
    corpus_id: slug,
    roots: rows.map(r => ({ path: r.path, is_default: Boolean(r.is_default) })),
  };
}

// ─── scholar.roots.add ────────────────────────────────────────────────────────

async function handleAdd(args: unknown, ctx: ServerContext): Promise<unknown> {
  const _db = ctx.db; // snapshot at entry
  const slug = requireActive(ctx);
  const { path } = args as { path: string };

  const client = rawClient(ctx.configDb);
  const addTx = client.transaction(() => {
    // De-duplicate: check if this path already exists for this corpus
    const existing = client
      .query("SELECT id FROM pdf_roots WHERE corpus_id = ? AND path = ?")
      .get(slug, path) as { id: number } | undefined;
    if (!existing) {
      client
        .query("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, ?)")
        .run(slug, path, 0);
    }
  });
  addTx();

  // Push updated root list to pdf child
  const roots = allPdfRoots(ctx.configDb, slug);
  await ctx.pdf.setRoots(roots);

  return { corpus_id: slug, added: path, roots };
}

// ─── scholar.roots.remove ─────────────────────────────────────────────────────

async function handleRemove(args: unknown, ctx: ServerContext): Promise<unknown> {
  const _db = ctx.db; // snapshot at entry
  const slug = requireActive(ctx);
  const { path } = args as { path: string };

  const client = rawClient(ctx.configDb);

  const removeTx = client.transaction(() => {
    // Check corpus has more than one root (at-least-one constraint)
    const countRow = client
      .query("SELECT COUNT(*) AS cnt FROM pdf_roots WHERE corpus_id = ?")
      .get(slug) as { cnt: number };
    if (countRow.cnt <= 1) {
      throw new RootsError("LAST_ROOT", "Cannot remove the only remaining PDF root.");
    }

    // Check if the root to remove is the current default
    const target = client
      .query("SELECT id, is_default FROM pdf_roots WHERE corpus_id = ? AND path = ?")
      .get(slug, path) as { id: number; is_default: number } | undefined;
    if (!target) {
      throw new RootsError("ROOT_NOT_FOUND", `PDF root not found: "${path}"`);
    }

    // Delete the target first so the partial unique index clears before we set a new default.
    client
      .query("DELETE FROM pdf_roots WHERE corpus_id = ? AND path = ?")
      .run(slug, path);

    // If the removed root was the default, auto-promote the oldest remaining
    // root (lowest id — insertion-order proxy per foundation allPdfRoots note).
    if (target.is_default) {
      const oldest = client
        .query("SELECT id FROM pdf_roots WHERE corpus_id = ? ORDER BY id ASC LIMIT 1")
        .get(slug) as { id: number } | undefined;
      if (oldest) {
        client
          .query("UPDATE pdf_roots SET is_default = 1 WHERE id = ?")
          .run(oldest.id);
      }
    }
  });
  removeTx();

  // Push updated root list to pdf child
  const roots = allPdfRoots(ctx.configDb, slug);
  await ctx.pdf.setRoots(roots);

  return { corpus_id: slug, removed: path, roots };
}

// ─── scholar.roots.set-default ───────────────────────────────────────────────

async function handleSetDefault(args: unknown, ctx: ServerContext): Promise<unknown> {
  const _db = ctx.db; // snapshot at entry
  const slug = requireActive(ctx);
  const { path } = args as { path: string };

  const client = rawClient(ctx.configDb);
  const setTx = client.transaction(() => {
    const target = client
      .query("SELECT id FROM pdf_roots WHERE corpus_id = ? AND path = ?")
      .get(slug, path) as { id: number } | undefined;
    if (!target) {
      throw new RootsError("ROOT_NOT_FOUND", `PDF root not found: "${path}"`);
    }
    // Clear all defaults, then set the chosen one — both in one transaction
    client.query("UPDATE pdf_roots SET is_default = 0 WHERE corpus_id = ?").run(slug);
    client.query("UPDATE pdf_roots SET is_default = 1 WHERE id = ?").run(target.id);
  });
  setTx();

  const roots = allPdfRoots(ctx.configDb, slug);
  return { corpus_id: slug, default: path, roots };
}

// ═══════════════════════════════════════════════════════════════════════════════
// registerTools
// ═══════════════════════════════════════════════════════════════════════════════

export const registerTools: RegisterTools = (_server, _ctx, _register) => {
  _register(
    "scholar.roots.list",
    { description: "List all PDF roots for the active corpus.", inputSchema: z.object({}) },
    handleList,
  );
  _register(
    "scholar.roots.add",
    {
      description: "Add a PDF root directory to the active corpus.",
      inputSchema: z.object({ path: z.string().describe("Absolute path to the PDF root directory") }),
    },
    handleAdd,
  );
  _register(
    "scholar.roots.remove",
    {
      description: "Remove a PDF root from the active corpus. Enforces at-least-one invariant.",
      inputSchema: z.object({ path: z.string() }),
    },
    handleRemove,
  );
  _register(
    "scholar.roots.set-default",
    {
      description: "Set the default PDF root for the active corpus.",
      inputSchema: z.object({ path: z.string() }),
    },
    handleSetDefault,
  );
};

// src/server/tools/query.ts — extraction cycle 6.14 (Green)
//
// scholar.query — multi-query batch over the active corpus DB via bun:sqlite
// prepared statements. Read-only by default; opt-in `commit:true` per
// request promotes the entire batch to a write transaction.
//
// Engine-level write-intent gate (no keyword sniffing). Advisor + lead
// guidance: CTE write-tricks like `WITH x AS (DELETE FROM …)` bypass naive
// keyword sniffers, AND adding a parallel-validation pre-execute keyword
// sniff sets a precedent that drifts out of sync with the engine. The sole
// auditable gate is the transaction discipline: if no request asked to
// commit, the batch runs inside BEGIN/ROLLBACK and writes are discarded.
//
// Posture B: scholar reimplements §10 inline via bun:sqlite (no sqlite3-mcp
// child). ctx has no `sqlite3` field; the test surface includes a Proxy
// regression guard to detect any drift back toward delegation.

import { z } from "zod";
import { rawClient } from "../db/raw-client.ts";
import type { RegisterTools, ServerContext } from "./registry.ts";

// ─── error ────────────────────────────────────────────────────────────────────

export class QueryToolError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "QueryToolError";
  }
}

// ─── shapes ───────────────────────────────────────────────────────────────────

export type QueryRequest = {
  label: string;
  query: string;
  params?: unknown[];
  commit?: boolean;
};

export type RunQueryArgs = { queries: QueryRequest[] };

// ─── handler ──────────────────────────────────────────────────────────────────

export async function runQuery(
  ctx: ServerContext,
  args: RunQueryArgs,
): Promise<Record<string, Record<string, unknown>[]>> {
  const db = ctx.db; // §7.6 snapshot-at-entry
  if (!db) {
    throw new QueryToolError(
      "NO_ACTIVE_CORPUS",
      "NO_ACTIVE_CORPUS: scholar.query requires an active corpus. Call scholar.corpus.activate first.",
    );
  }

  const willCommit = args.queries.some((q) => q.commit === true);
  const raw = rawClient(db);

  const result: Record<string, Record<string, unknown>[]> = {};
  raw.run("BEGIN");
  try {
    for (const req of args.queries) {
      const stmt = raw.prepare(req.query);
      const params = req.params ?? [];
      // bun:sqlite returns rows for SELECT/RETURNING via .all(), [] otherwise.
      const rows = params.length > 0
        ? (stmt.all(...(params as never[])) as Record<string, unknown>[])
        : (stmt.all() as Record<string, unknown>[]);
      result[req.label] = rows;
    }
    if (willCommit) {
      raw.run("COMMIT");
    } else {
      raw.run("ROLLBACK");
    }
  } catch (err) {
    try { raw.run("ROLLBACK"); } catch { /* no active tx */ }
    throw err;
  }
  return result;
}

// ─── registerTools ────────────────────────────────────────────────────────────

export const registerTools: RegisterTools = (_server, ctx, _register) => {
  _register(
    "scholar.query",
    {
      description:
        "Execute one or more SQL queries against the active corpus DB. " +
        "Read-only by default. Opt-in `commit: true` on any request promotes " +
        "the entire batch to a write transaction (single BEGIN/COMMIT around " +
        "all requests; rollback if any throws).",
      inputSchema: z.object({
        queries: z.array(z.object({
          label: z.string().min(1),
          query: z.string().min(1),
          params: z.array(z.unknown()).optional(),
          commit: z.boolean().optional(),
        })).min(1),
      }),
    },
    async (args) => {
      return await runQuery(ctx, (args ?? { queries: [] }) as RunQueryArgs);
    },
  );
};

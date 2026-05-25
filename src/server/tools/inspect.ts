// src/server/tools/inspect.ts — extraction cycle 6.14 (Green)
//
// scholar.inspect — no-args dump of sqlite_master tables + indexes for the
// active corpus DB. Filters sqlite_* internal objects. Power-user per-table
// introspection is delegated to scholar.query so we don't open a
// SQL-identifier-validation path nobody asked for (advisor guidance).

import { z } from "zod";
import { rawClient } from "../db/raw-client.ts";
import type { RegisterTools, ServerContext } from "./registry.ts";

// ─── error ────────────────────────────────────────────────────────────────────

export class InspectToolError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "InspectToolError";
  }
}

// ─── shapes ───────────────────────────────────────────────────────────────────

export type InspectResult = {
  tables: Array<{ name: string; sql: string }>;
  indexes: Array<{ name: string; table: string; sql: string | null }>;
};

// ─── handler ──────────────────────────────────────────────────────────────────

export async function runInspect(ctx: ServerContext): Promise<InspectResult> {
  const db = ctx.db;
  if (!db) {
    throw new InspectToolError(
      "NO_ACTIVE_CORPUS",
      "NO_ACTIVE_CORPUS: scholar.inspect requires an active corpus.",
    );
  }
  const raw = rawClient(db);

  const tables = raw.prepare(
    `SELECT name, sql FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  ).all() as Array<{ name: string; sql: string }>;

  const indexes = raw.prepare(
    `SELECT name, tbl_name AS "table", sql FROM sqlite_master
     WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
     ORDER BY tbl_name, name`,
  ).all() as Array<{ name: string; table: string; sql: string | null }>;

  return { tables, indexes };
}

// ─── registerTools ────────────────────────────────────────────────────────────

export const registerTools: RegisterTools = (_server, ctx, _register) => {
  _register(
    "scholar.inspect",
    {
      description:
        "Return the active corpus DB's user tables and indexes from sqlite_master " +
        "(no arguments). Filters sqlite_* internal objects. Use scholar.query for " +
        "targeted per-object introspection.",
      inputSchema: z.object({}).passthrough(),
    },
    async () => await runInspect(ctx),
  );
};

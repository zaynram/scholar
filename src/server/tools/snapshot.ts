// src/server/tools/snapshot.ts — corpus plan cycle 6.11 (Green)
//
// Implements scholar.snapshot.take per §5.13, §8.2.
// Pure read + one synchronous write. No schema migration — `snapshots` is
// Drizzle-managed by foundation (cycle 6.1). Delta computation lives in
// digest.ts (extraction cycle 6.8); this module only captures the snapshot.
//
// Invariants:
//   - Snapshot-at-entry (§7.6): ctx.db snapshotted on first line.
//   - INSERT wraps in db.transaction() — no awaits inside closure.
//   - No active corpus → CorpusError("NO_ACTIVE_CORPUS").
import { z } from "zod";
import type { RegisterTools, ServerContext } from "./registry.ts";
import type { SnapshotPayload } from "../db/schema.ts";
import { rawClient } from "../db/raw-client.ts";
import { ulid, nowIso } from "../db/nowIso.ts";

// ─── error ────────────────────────────────────────────────────────────────────

class SnapshotError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SnapshotError";
  }
}

// ─── handler ──────────────────────────────────────────────────────────────────

async function handleTake(args: unknown, ctx: ServerContext): Promise<unknown> {
  const db = ctx.db; // snapshot at entry (§7.6 invariant #3)
  if (!db) {
    throw new SnapshotError("NO_ACTIVE_CORPUS", "No active corpus. Call scholar.corpus.activate first.");
  }

  const { trigger } = args as { trigger: "open" | "manual" };

  // ── Build SnapshotPayload (synchronous SELECT) ──────────────────────────────
  // SELECT id, status, priority from papers — no await needed (bun:sqlite is sync).
  const rows = rawClient(db)
    .query("SELECT id, status, priority FROM papers")
    .all() as Array<{ id: string; status: "pending" | "reading" | "reviewed" | "skip"; priority: number }>;

  const paper_ids = rows.map(r => r.id);

  const statuses: Record<string, "pending" | "reading" | "reviewed" | "skip"> = {};
  const priorities: Record<string, number> = {};
  const counts = { total: 0, pending: 0, reading: 0, reviewed: 0, skip: 0 };

  for (const r of rows) {
    statuses[r.id] = r.status;
    priorities[r.id] = r.priority;
    counts.total++;
    counts[r.status]++;
  }

  const payload: SnapshotPayload = { paper_ids, statuses, priorities, counts };

  // ── Persist snapshot (synchronous transaction — no awaits inside) ───────────
  const id = ulid();
  const taken_at = nowIso();
  const payloadJson = JSON.stringify(payload);

  const client = rawClient(db);
  const insertTx = client.transaction(() => {
    client
      .query("INSERT INTO snapshots (id, taken_at, payload, trigger) VALUES (?, ?, ?, ?)")
      .run(id, taken_at, payloadJson, trigger);
  });
  insertTx();

  return { id, taken_at, trigger, payload };
}

// ═══════════════════════════════════════════════════════════════════════════════
// registerTools
// ═══════════════════════════════════════════════════════════════════════════════

export const registerTools: RegisterTools = (_server, _ctx, _register) => {
  _register(
    "scholar.snapshot.take",
    {
      description:
        "Capture a snapshot of the current corpus state (paper statuses, priorities, counts) " +
        "and persist it to the snapshots table. Used by scholar.digest.change-since-last-open.",
      inputSchema: z.object({
        trigger: z
          .enum(["open", "manual"])
          .describe("'open' when called at corpus-open time; 'manual' for on-demand capture"),
      }),
    },
    handleTake,
  );
};

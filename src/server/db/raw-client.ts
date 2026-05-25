// src/server/db/raw-client.ts — foundation cycle 6.1 (Task 1.4b)
//
// Surfaces the bun:sqlite native `Database` client backing a drizzle
// `BunSQLiteDatabase`. Use ONLY for paths drizzle doesn't model cleanly:
//
//   - vec0 virtual-table DDL (`CREATE VIRTUAL TABLE … USING vec0(…)`)
//   - vec0 INSERT with typed Float32Array binding
//   - custom pragma reads outside `openWithPragmas`
//   - user-defined function registration
//
// Centralizes the unsafe cast — drizzle exposes the client as `$client` but
// does not type it publicly. This one helper is the only place that knowledge
// lives, so a future drizzle rename is a one-file fix.
import type { Database } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

export function rawClient(db: BunSQLiteDatabase): Database {
  return (db as unknown as { $client: Database }).$client;
}

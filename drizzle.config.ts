import type { Config } from "drizzle-kit";

export default {
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  dialect: "sqlite",
  driver: "expo",
  // bun:sqlite/drizzle-orm pairs with the same generated SQL the better-sqlite3
  // driver emits; the runtime swap from better-sqlite3 → bun:sqlite is in
  // src/server/db/migrations.ts (the runner), not here.
} satisfies Config;

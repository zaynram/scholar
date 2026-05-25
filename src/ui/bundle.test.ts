// src/ui/bundle.test.ts
// Cycle 6.9 bundle-budget gate per spec §14.1.
// Builds the UI via `bun run build:ui` and asserts:
//   (1) build/ui/app.html exists
//   (2) total bundle size < 4.5 MB (THRESHOLD_KB)
//   (3) build/ui/bundle-budget.json has the shape packaging cycle 6.13 consumes
//
// Expected at Red: FAIL — src/ui/index.html does not exist; build cannot run.
import { test, expect, beforeAll } from "bun:test";
import { stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const BUNDLE_PATH = "build/ui/app.html";
const BUDGET_PATH = "build/ui/bundle-budget.json";
const THRESHOLD_KB = 4608; // 4.5 MB — spec §14.1 gate

beforeAll(async () => {
  if (!existsSync("src/ui/index.html")) return; // still Red — don't attempt build
  try {
    await Bun.$`bun run measure-bundle`.quiet();
  } catch {
    // Build or measure failed — tests will surface the missing output below.
  }
});

test("build/ui/app.html exists after bundle build", async () => {
  const s = await stat(BUNDLE_PATH).catch(() => null);
  expect(s).not.toBeNull();
});

test("bundle total size < 4.5 MB (spec §14.1 gate)", async () => {
  const s = await stat(BUNDLE_PATH);
  expect(s.size / 1024).toBeLessThan(THRESHOLD_KB);
});

test("bundle-budget.json has the shape packaging cycle 6.13 consumes", async () => {
  const raw = await readFile(BUDGET_PATH, "utf-8");
  const budget = JSON.parse(raw) as Record<string, unknown>;
  expect(budget).toMatchObject({
    total_kb: expect.any(Number),
    threshold_kb: THRESHOLD_KB,
    over_budget: expect.any(Boolean),
    per_dep: expect.arrayContaining([
      expect.objectContaining({ name: expect.any(String), kb: expect.any(Number) }),
    ]),
  });
  // remediation_recommended is always null — human review of per-dep table
  // + spec §14.1 (a/b/c) menu required. Per-dep figures are indicative only.
  expect(budget.remediation_recommended).toBeNull();
});

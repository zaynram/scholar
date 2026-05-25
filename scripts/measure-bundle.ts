// scripts/measure-bundle.ts
// Builds the UI as a single-file HTML bundle and emits build/ui/bundle-budget.json.
//
// The build step now delegates to scripts/build-ui.ts (the canonical production
// build helper, introduced by chore foundation-fix-build-ui-script-for-multi-file-output).
// build-ui.ts uses `outdir` (not `--outfile`), which is what Bun's HTML bundler
// requires for multi-file output (HTML + per-chunk JS + assets).
//
// This script still inlines JS chunks into a single `build/ui/app.html` so that
// the cycle 6.9 / resource.ts expectation of a single-file artifact at
// `build/ui/app.html` holds, and packaging cycle 6.13 gets a single-file
// plugin-bundleable artifact.
//
// bundle-budget.json is consumed by packaging cycle 6.13 to decide §14.1
// remediations. Per-dep figures are INDICATIVE — isolated builds, no
// tree-shake, no shared-peer deduplication. When over_budget=true,
// remediation_recommended is NULL — human review required.

import { mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { buildUI } from "./build-ui.ts";

const THRESHOLD_KB = 4608;
const BUNDLE_PATH = "build/ui/app.html";
const BUDGET_PATH = "build/ui/bundle-budget.json";
const CHUNK_DIR = "build/ui/_chunks";

await mkdir("build/ui", { recursive: true });
if (existsSync(CHUNK_DIR)) await rm(CHUNK_DIR, { recursive: true, force: true });
await mkdir(CHUNK_DIR, { recursive: true });

// ── Step 1: Bun HTML bundler emits HTML + JS chunk(s) into CHUNK_DIR ─────────
console.log("Building UI bundle…");
try {
  await buildUI({ outdir: CHUNK_DIR, minify: true });
} catch (err) {
  console.error(String(err));
  process.exit(1);
}

// ── Step 2: Inline JS chunks into the HTML, producing a single-file bundle ───
// Find the HTML output + the JS chunk(s) it references.
const chunkFiles = await readdir(CHUNK_DIR);
const htmlChunk = chunkFiles.find((f) => f.endsWith(".html"));
if (!htmlChunk) {
  console.error(`Expected an .html file in ${CHUNK_DIR}; found: ${chunkFiles.join(", ")}`);
  process.exit(1);
}
let html = await Bun.file(`${CHUNK_DIR}/${htmlChunk}`).text();

// Replace each <script src="./chunk.js"></script> with <script>{contents}</script>.
const SCRIPT_RE = /<script[^>]*\bsrc=["']\.?\/?([^"']+\.js)["'][^>]*>\s*<\/script>/g;
html = html.replace(SCRIPT_RE, (match, srcPath: string) => {
  const fullPath = `${CHUNK_DIR}/${srcPath}`;
  if (!existsSync(fullPath)) {
    console.warn(`Inline skip: chunk ${fullPath} not found`);
    return match;
  }
  // Use Bun.file().text() synchronously is not possible; we resolve below.
  // For this regex.replace, return a placeholder + collect paths.
  return `__INLINE__${srcPath}__/INLINE__`;
});

// Resolve placeholders sequentially (regex.replace doesn't support async).
const placeholderRe = /__INLINE__(.+?)__\/INLINE__/g;
const replacements: Array<{ marker: string; replacement: string }> = [];
let m: RegExpExecArray | null;
while ((m = placeholderRe.exec(html)) !== null) {
  const srcPath = m[1]!;
  const fullPath = `${CHUNK_DIR}/${srcPath}`;
  const jsText = await Bun.file(fullPath).text();
  // Escape </script> inside JS to prevent premature script-tag termination.
  const safeJs = jsText.replace(/<\/script>/gi, "<\\/script>");
  replacements.push({ marker: m[0], replacement: `<script type="module">${safeJs}</script>` });
}
for (const { marker, replacement } of replacements) {
  html = html.replace(marker, replacement);
}

await Bun.write(BUNDLE_PATH, html);

// Cleanup chunk dir (no longer needed once inlined).
await rm(CHUNK_DIR, { recursive: true, force: true });

const totalBytes = (await Bun.file(BUNDLE_PATH).arrayBuffer()).byteLength;
const totalKb = Math.round(totalBytes / 1024);
console.log(`Total (inlined single-file): ${totalKb} KB`);

// ── Step 3: per-dep indicative measurements ──────────────────────────────────
const HEAVY_DEPS = ["pdfjs-dist", "chart.js", "react", "react-dom"];

async function measureDep(dep: string): Promise<{ name: string; kb: number }> {
  // Entry file must live inside the project root so Bun resolves npm packages
  // against this project's node_modules (resolution would fail if entry was in
  // /tmp). Use a project-local scratch dir, cleaned after each measurement.
  const scratchDir = "build/ui/_dep_measure";
  await mkdir(scratchDir, { recursive: true });
  const entry = `${scratchDir}/${dep.replace(/\//g, "_")}-${Date.now()}.ts`;
  try {
    await Bun.write(entry, `import * as _m from "${dep}"; export default _m;`);
    const result = await Bun.build({
      entrypoints: [entry],
      target: "browser",
      minify: true,
    });
    if (!result.success) return { name: dep, kb: -1 };
    return {
      name: dep,
      kb: Math.round(result.outputs.reduce((a, o) => a + o.size, 0) / 1024),
    };
  } catch {
    return { name: dep, kb: -1 };
  } finally {
    await Bun.$`rm -f ${entry}`.quiet().catch(() => {});
  }
}

const perDep = await Promise.all(HEAVY_DEPS.map(measureDep));
console.log("\nPer-dep breakdown (indicative — isolated builds):");
console.table(perDep);

const overBudget = totalKb > THRESHOLD_KB;

const budget = {
  total_kb: totalKb,
  threshold_kb: THRESHOLD_KB,
  over_budget: overBudget,
  per_dep: perDep,
  // Always null — remediation must be selected by human review of per-dep
  // table and spec §14.1 (a/b/c) menu. Per-dep figures are indicative only.
  remediation_recommended: null,
  note: "per_dep is indicative (isolated builds); total_kb is authoritative; remediation requires human review of spec §14.1",
};

await Bun.write(BUDGET_PATH, JSON.stringify(budget, null, 2));
console.log(
  `\n${overBudget ? "⚠ OVER BUDGET — review spec §14.1 for remediation options a/b/c" : "✓ Within budget"}`,
);
console.log(`Saved to ${BUDGET_PATH}`);

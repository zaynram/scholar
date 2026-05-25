// nu/scholar.test.ts
// Red/Green tests for cycle 6.10 — nu module behavior + structural anchors.
//
// Tests split into two groups:
//   1. nu-spawn tests (skip if nu not on PATH) — exercise the actual module
//   2. grep tests (always run) — pin tool-name references in source
//
// Grep tests fail at Red phase (file not yet created). nu-spawn tests skip
// or fail with "Cannot find module" at Red phase.
import { test, expect } from "bun:test";

// Synchronous detection so test.skipIf() evaluates correctly at definition time.
const nuAvailable = (() => {
  try { return Bun.spawnSync(["nu", "--version"]).exitCode === 0; } catch { return false; }
})();

if (!nuAvailable) console.warn("WARNING: nu not on PATH — nu-spawn tests will be skipped");

test.skipIf(!nuAvailable)("nu/scholar.nu parses without errors", async () => {
  const result = await Bun.$`nu --commands "use ./nu/scholar.nu *; echo ok"`.quiet();
  expect(result.stdout.toString().trim()).toBe("ok");
});

test.skipIf(!nuAvailable)("scholar list is defined", async () => {
  const r = await Bun.$`nu --commands "use ./nu/scholar.nu *; help commands | where name == 'scholar list' | length"`.quiet();
  expect(parseInt(r.stdout.toString().trim())).toBe(1);
});

test.skipIf(!nuAvailable)("scholar status is defined", async () => {
  const r = await Bun.$`nu --commands "use ./nu/scholar.nu *; help commands | where name == 'scholar status' | length"`.quiet();
  expect(parseInt(r.stdout.toString().trim())).toBe(1);
});

test.skipIf(!nuAvailable)("scholar ingest is defined", async () => {
  const r = await Bun.$`nu --commands "use ./nu/scholar.nu *; help commands | where name == 'scholar ingest' | length"`.quiet();
  expect(parseInt(r.stdout.toString().trim())).toBe(1);
});

test.skipIf(!nuAvailable)("scholar query is defined", async () => {
  const r = await Bun.$`nu --commands "use ./nu/scholar.nu *; help commands | where name == 'scholar query' | length"`.quiet();
  expect(parseInt(r.stdout.toString().trim())).toBe(1);
});

test.skipIf(!nuAvailable)("scholar digest is defined", async () => {
  const r = await Bun.$`nu --commands "use ./nu/scholar.nu *; help commands | where name == 'scholar digest' | length"`.quiet();
  expect(parseInt(r.stdout.toString().trim())).toBe(1);
});

// Transport argv-shape test: injects a stub `scholar` binary on PATH, verifies
// the nu `scholar` wrapper passes --call + tool name + JSON-serialized args.
// Foundation-007 contract: ^scholar --call <tool> <json>.
test.skipIf(!nuAvailable)("scholar transport calls ^scholar --call with JSON-serialized args", async () => {
  const stubDir = "/tmp/scholar-nu-transport-test";
  const stubBin = `${stubDir}/scholar`;
  await Bun.$`mkdir -p ${stubDir}`.quiet();
  await Bun.write(
    stubBin,
    `#!/bin/bash\necho "{\\"flag\\":\\"$1\\",\\"tool\\":\\"$2\\",\\"args\\":$3,\\"ok\\":true}"\n`,
  );
  await Bun.$`chmod +x ${stubBin}`.quiet();
  try {
    const result = await Bun.$`nu --commands "use ./nu/scholar.nu *; scholar 'corpus.activate' {slug: 'test'} | to json"`
      .env({ ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` })
      .quiet();
    const parsed = JSON.parse(result.stdout.toString().trim());
    expect(parsed.flag).toBe("--call");
    expect(parsed.tool).toBe("corpus.activate");
    expect(parsed.args.slug).toBe("test");
    expect(parsed.ok).toBe(true);
  } finally {
    await Bun.$`rm -rf ${stubDir}`.quiet().catch(() => {});
  }
});

// Grep tests — tool names must appear in source (stable across transport changes
// and resilient to test-host nu version drift). These always run.
test("scholar.nu references scholar.papers.search", async () => {
  expect(await Bun.file("./nu/scholar.nu").text()).toContain("scholar.papers.search");
});
test("scholar.nu references scholar.corpus.status", async () => {
  expect(await Bun.file("./nu/scholar.nu").text()).toContain("scholar.corpus.status");
});
test("scholar.nu references scholar.ingest", async () => {
  expect(await Bun.file("./nu/scholar.nu").text()).toContain("scholar.ingest");
});
test("scholar.nu references scholar.digest.generate", async () => {
  expect(await Bun.file("./nu/scholar.nu").text()).toContain("scholar.digest.generate");
});

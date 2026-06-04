// src/server/cli.test.ts — foundation cycle 6.1 (Task 1.10d)
//
// Foundation-009 dual-mode entry point tests. Lead specified three:
//   (a) argv parser unit
//   (b) integration via `bun run`
//   (c) mode-mutex spy asserting StdioServerTransport is NOT constructed in CLI mode
import { test, expect, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEntryArgv, buildServer } from "./index.ts";
import { reopenPersistedCorpus } from "./tools/corpus.ts";

test("(a) parseEntryArgv: no --call → server mode", () => {
  expect(parseEntryArgv([])).toEqual({ mode: "server" });
  expect(parseEntryArgv(["--foo", "bar"])).toEqual({ mode: "server" });
});

test("(a) parseEntryArgv: --call <tool> <args-json> → CLI mode", () => {
  const p = parseEntryArgv(["--call", "scholar.corpus.list", "{}"]);
  expect(p).toEqual({ mode: "cli", toolName: "scholar.corpus.list", argsSource: "{}" });
});

test("(a) parseEntryArgv: --call <tool> - → CLI mode with stdin args", () => {
  const p = parseEntryArgv(["--call", "scholar.papers.upsert", "-"]);
  expect(p).toEqual({ mode: "cli", toolName: "scholar.papers.upsert", argsSource: "-" });
});

test("(a) parseEntryArgv: --call <tool> with missing args → CLI mode, argsSource=undefined", () => {
  // Parser stays pure; main() surfaces this as exit 2 with structured invalid_args error.
  const p = parseEntryArgv(["--call", "scholar.corpus.list"]);
  expect(p).toEqual({ mode: "cli", toolName: "scholar.corpus.list", argsSource: undefined });
});

test("(b) integration: bun run src/server/index.ts --call <unknown> '{}' → exit 2 + unknown_tool on stderr", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scholar-cli-"));
  try {
    const proc = Bun.spawn(
      ["bun", "run", "src/server/index.ts", "--call", "scholar.does.not.exist", "{}"],
      {
        cwd: process.cwd(),
        env: { ...process.env, SCHOLAR_RUNTIME_ROOT: dir },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const exitCode = await proc.exited;
    const stderrText = await new Response(proc.stderr).text();
    expect(exitCode).toBe(2);
    const errLine = stderrText.split("\n").find((l) => l.includes("unknown_tool"));
    expect(errLine).toBeDefined();
    expect(JSON.parse(errLine!)).toMatchObject({ error: "unknown_tool", tool: "scholar.does.not.exist" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(b) integration: bun run ... --call ... 'invalid-json' → exit 2 + invalid_args_json on stderr", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scholar-cli-"));
  try {
    const proc = Bun.spawn(
      ["bun", "run", "src/server/index.ts", "--call", "scholar.does.not.exist", "not-valid-json{"],
      {
        cwd: process.cwd(),
        env: { ...process.env, SCHOLAR_RUNTIME_ROOT: dir },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const exitCode = await proc.exited;
    const stderrText = await new Response(proc.stderr).text();
    expect(exitCode).toBe(2);
    const errLine = stderrText.split("\n").find((l) => l.includes("invalid_args_json"));
    expect(errLine).toBeDefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── (d) Bug #2b: runCli rehydrates the persisted active corpus into ctx.db ───
//
// `--call` builds a fresh server per process with ctx.db === undefined; corpus.activate
// is the only path that opens ctx.db, and CLI never calls it. So a fresh `--call` to an
// active-corpus tool (papers.search) against a corpus that was durably activated in a
// PRIOR process must NOT return NO_ACTIVE_CORPUS — runCli must re-open it first.
//
// Pure-spawn (3 sequential processes) so each fully closes its DB on exit — faithful
// to the real CLI entry path, no shared in-process state or cross-process WAL aliasing.
async function callCli(
  dir: string,
  tool: string,
  argsJson: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", "src/server/index.ts", "--call", tool, argsJson], {
    cwd: process.cwd(),
    env: { ...process.env, SCHOLAR_RUNTIME_ROOT: dir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test("(d) integration: fresh --call to an active-corpus tool re-opens the persisted corpus (no NO_ACTIVE_CORPUS)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scholar-cli-reopen-"));
  try {
    // Process 1: create a corpus (writes corpus DB + config row).
    const created = await callCli(
      dir,
      "scholar.corpus.create",
      JSON.stringify({ slug: "t", display_name: "T", initial_pdf_root: dir }),
    );
    expect(created.exitCode).toBe(0);

    // Process 2: activate it (durably persists activeCorpusId in the config DB).
    const activated = await callCli(dir, "scholar.corpus.activate", JSON.stringify({ slug: "t" }));
    expect(activated.exitCode).toBe(0);

    // Process 3: a fresh `--call` to an active-corpus tool. Before the fix this exits
    // non-zero with NO_ACTIVE_CORPUS; after the fix runCli rehydrates ctx.db first.
    const searched = await callCli(dir, "scholar.papers.search", JSON.stringify({ q: "anything" }));
    expect(searched.stderr).not.toContain("NO_ACTIVE_CORPUS");
    expect(searched.exitCode).toBe(0);
    expect(JSON.parse(searched.stdout)).toMatchObject({ hits: expect.any(Array) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test("(e) unit: reopenPersistedCorpus rehydrates ctx.db from the persisted active corpus; no-op when absent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "scholar-reopen-unit-"));
  // Production aligns the buildServer deps runtimeRoot with resolveRuntimeRoot() (env)
  // because main() sets both; the corpus handlers open corpus DBs via resolveRuntimeRoot(),
  // so the in-process harness must set the env too or create/activate would write the
  // corpus DB to a different root than the config DB.
  const prevRoot = process.env.SCHOLAR_RUNTIME_ROOT;
  process.env.SCHOLAR_RUNTIME_ROOT = dir;
  try {
    // Negative: a fresh server over an empty runtime root has nothing to rehydrate.
    const empty = buildServer({ runtimeRoot: dir, quiet: true });
    expect(empty.ctx.db).toBeUndefined();
    expect(reopenPersistedCorpus(empty.ctx, dir)).toBeUndefined();
    expect(empty.ctx.db).toBeUndefined();

    // Simulate the prior session: create + activate persists activeCorpusId + corpus DB.
    const s1 = buildServer({ runtimeRoot: dir, quiet: true });
    await s1.dispatch("scholar.corpus.create", { slug: "t", display_name: "T", initial_pdf_root: dir });
    await s1.dispatch("scholar.corpus.activate", { slug: "t" });
    expect(s1.ctx.db).toBeDefined();

    // Fresh process simulation: a new server starts with ctx.db undefined, then rehydrates.
    const s2 = buildServer({ runtimeRoot: dir, quiet: true });
    expect(s2.ctx.db).toBeUndefined();
    expect(reopenPersistedCorpus(s2.ctx, dir)).toBe("t");
    expect(s2.ctx.db).toBeDefined();
  } finally {
    if (prevRoot === undefined) delete process.env.SCHOLAR_RUNTIME_ROOT;
    else process.env.SCHOLAR_RUNTIME_ROOT = prevRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("(c) mode-mutex: main(['--call', ...]) does NOT bind stdio MCP transport", async () => {
  let stdioConstructed = 0;
  mock.module("@modelcontextprotocol/sdk/server/stdio.js", () => ({
    StdioServerTransport: class {
      constructor() {
        stdioConstructed += 1;
      }
      async start() {}
    },
  }));
  // Re-import after the mock so the SUT picks it up.
  const { main } = await import("./index.ts");
  const dir = mkdtempSync(join(tmpdir(), "scholar-cli-mutex-"));
  try {
    process.env.SCHOLAR_RUNTIME_ROOT = dir;
    const exitCode = await main(["--call", "scholar.does.not.exist", "{}"]);
    expect(exitCode).toBe(2); // unknown_tool → exit 2
    expect(stdioConstructed).toBe(0); // ← THE assertion: CLI mode never touches stdio transport
  } finally {
    rmSync(dir, { recursive: true, force: true });
    mock.restore();
  }
});

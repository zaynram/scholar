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
import { parseEntryArgv } from "./index.ts";

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

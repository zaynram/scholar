// scripts/first-run.test.ts — corpus plan cycle 6.3 RED
//
// Tests for the first-run wizard (scripts/first-run.ts).
// The wizard is invoked when no corpus is configured on corpus.list or corpus.activate.
// Uses elicitInput host-capability detection (M4/I4).
import { test, expect, beforeEach, afterEach, mock } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildServer, type BuiltServer } from "#server/index.ts"
import { openWithPragmas, applyMigrations } from "#server/db/migrations.ts"
import type { PdfChild } from "#server/tools/registry.ts"
import { runFirstRun } from "^scripts/first-run.ts" // Will fail Red — not exported yet

let dir: string
let built: BuiltServer
const origRuntimeRoot = process.env.SCHOLAR_RUNTIME_ROOT

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scholar-firstrun-test-"))
  mkdirSync(join(dir, "dbs"), { recursive: true })
  process.env.SCHOLAR_RUNTIME_ROOT = dir

  const configDb = openWithPragmas(join(dir, "dbs", "scholar-config.db"))
  applyMigrations(configDb)

  const mockPdf: PdfChild = {
    interact: async () => {
      throw new Error("PDF_CHILD_UNAVAILABLE")
    },
    getText: async () => {
      throw new Error("PDF_CHILD_UNAVAILABLE")
    },
    currentRoots: () => [],
    setRoots: async () => {},
    isHealthy: () => ({ alive: false, lastOkAt: null, stdioOpen: false }),
  }

  built = buildServer({
    runtimeRoot: dir,
    openConfigDb: () => configDb,
    spawnPdfChild: () => mockPdf,
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (origRuntimeRoot === undefined) delete process.env.SCHOLAR_RUNTIME_ROOT
  else process.env.SCHOLAR_RUNTIME_ROOT = origRuntimeRoot
})

// ─── elicitInput host-capability detection ────────────────────────────────────

test("runFirstRun returns FIRST_RUN_ELICIT_UNAVAILABLE when host lacks elicitation capability", async () => {
  // Server with no elicitation capability
  const mockServer = {
    server: {
      getClientCapabilities: () => undefined,
    },
  }
  const result = await runFirstRun(
    built.ctx,
    mockServer as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer,
    dir,
  )
  expect(result).toMatchObject({ code: "FIRST_RUN_ELICIT_UNAVAILABLE" })
})

test("runFirstRun returns FIRST_RUN_ELICIT_UNAVAILABLE when capabilities omit elicitation", async () => {
  const mockServer = {
    server: {
      getClientCapabilities: () => ({ sampling: {} }), // no elicitation key
    },
  }
  const result = await runFirstRun(
    built.ctx,
    mockServer as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer,
    dir,
  )
  expect(result).toMatchObject({ code: "FIRST_RUN_ELICIT_UNAVAILABLE" })
})

test("runFirstRun with elicitation capability calls elicitInput and creates corpus on success", async () => {
  const elicitMock = mock(async () => ({
    action: "accept" as const,
    content: { path: dir },
  }))

  const mockServer = {
    server: {
      getClientCapabilities: () => ({ elicitation: {} }),
      elicitInput: elicitMock,
    },
  }

  const result = await runFirstRun(
    built.ctx,
    mockServer as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer,
    dir,
  )
  expect(result).toMatchObject({ code: "FIRST_RUN_COMPLETE" })
  expect(elicitMock).toHaveBeenCalled()

  // A corpus should now exist
  const corpora = built.ctx.config.corpora()
  expect(corpora.length).toBeGreaterThan(0)
})

test("runFirstRun with user dismissal returns FIRST_RUN_DISMISSED without any write", async () => {
  const elicitMock = mock(async () => ({
    action: "cancel" as const,
    content: null,
  }))

  const mockServer = {
    server: {
      getClientCapabilities: () => ({ elicitation: {} }),
      elicitInput: elicitMock,
    },
  }

  const result = await runFirstRun(
    built.ctx,
    mockServer as unknown as import("@modelcontextprotocol/sdk/server/mcp.js").McpServer,
    dir,
  )
  expect(result).toMatchObject({ code: "FIRST_RUN_DISMISSED" })

  // No corpus should have been created
  expect(built.ctx.config.corpora()).toHaveLength(0)
})

// scripts/first-run.ts — corpus plan cycle 6.3 (Green)
//
// First-run wizard: invoked by corpus.ts when no corpus is configured and the host
// has elicitation capability. Prompts for the initial PDF root, then provisions the
// bootstrap corpus ("library") via direct DB writes (no circular back-import into
// corpus.ts).
//
// §7.3 step 1 / §5.5 atomicity: same provisioning protocol as corpus.create.
// Not a standalone executable (no `if (import.meta.main)` guard).
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { platform } from "node:process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../src/server/tools/registry.ts";
import { openWithPragmas, applyMigrations } from "../src/server/db/migrations.ts";
import { writeRuntimeConfig } from "../src/server/util/runtime-config.ts";
import { rawClient } from "../src/server/db/raw-client.ts";
import { nowIso } from "../src/server/db/nowIso.ts";

// ─── result codes ─────────────────────────────────────────────────────────────

export type FirstRunResult =
  | { code: "FIRST_RUN_COMPLETE"; slug: string }
  | { code: "FIRST_RUN_ELICIT_UNAVAILABLE" }
  | { code: "FIRST_RUN_PROVISION_FAILED"; message: string }
  | { code: "FIRST_RUN_DISMISSED" };

// ─── default PDF root suggestion per platform ─────────────────────────────────

function defaultPdfRootSuggestion(): string {
  if (platform === "win32") {
    const profile = process.env.USERPROFILE ?? "C:\\Users\\User";
    return join(profile, "mcp-data", "literature");
  }
  const home = process.env.HOME ?? "/home/user";
  return join(home, "mcp-data", "literature");
}

// ─── corpus provisioning (inline — no circular import into corpus.ts) ─────────

async function provisionBootstrapCorpus(
  ctx: ServerContext,
  slug: string,
  pdfRoot: string,
  runtimeRoot: string,
): Promise<void> {
  const dbsDir = join(runtimeRoot, "dbs");
  mkdirSync(dbsDir, { recursive: true });

  const dbPath = join(dbsDir, `scholar-${slug}.db`);
  if (existsSync(dbPath)) {
    // Orphan from a previous interrupted wizard run — not surfaced as an error,
    // just delete and re-provision (first-run is a recovery path, not a guarded create).
    unlinkSync(dbPath);
  }

  const corpusDb = openWithPragmas(dbPath);
  applyMigrations(corpusDb);

  // Config-DB transaction: INSERT corpora + INSERT pdf_roots
  const display_name = "My Library";
  const createdAt = nowIso();
  const client = rawClient(ctx.configDb);
  const insertTx = client.transaction(() => {
    client
      .query("INSERT INTO corpora (id, display_name, created_at) VALUES (?, ?, ?)")
      .run(slug, display_name, createdAt);
    client
      .query("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, ?)")
      .run(slug, pdfRoot, 1);
  });
  insertTx();

  // Persist activeCorpusId to both the settings table and runtime/config.json.
  ctx.config.set("activeCorpusId", slug);
  await writeRuntimeConfig({ activeCorpusId: slug }, runtimeRoot);
}

// ─── runFirstRun ──────────────────────────────────────────────────────────────

/**
 * First-run wizard. Checks host elicitation capability and, if available,
 * prompts for the initial PDF root before bootstrapping the "library" corpus.
 *
 * Returns a structured result code — never throws (caller logs errors as
 * FIRST_RUN_ELICIT_UNAVAILABLE or surfaces them via ctx.log).
 *
 * @param ctx         — live ServerContext (configDb + config accessor + logger).
 * @param server      — McpServer instance (for getClientCapabilities + elicitInput).
 * @param runtimeRoot — root for DB files and config.json.
 */
export async function runFirstRun(
  ctx: ServerContext,
  server: McpServer,
  runtimeRoot: string,
): Promise<FirstRunResult> {
  // I4: detection expression per plan-md §6.3 M4
  const supportsElicit = !!(server as unknown as {
    server?: { getClientCapabilities?: () => { elicitation?: unknown } | undefined };
  }).server?.getClientCapabilities?.()?.elicitation;

  if (!supportsElicit) {
    ctx.log.warn(
      "scholar.corpus: first-run wizard requires elicitation capability; " +
        "host does not support it. Create a corpus via scholar.corpus.create directly.",
    );
    return { code: "FIRST_RUN_ELICIT_UNAVAILABLE" };
  }

  const suggestion = defaultPdfRootSuggestion();
  const elicit = (server as unknown as {
    server?: {
      elicitInput?: (opts: {
        message: string;
        requestedSchema: { type: string; properties: Record<string, unknown>; required: string[] };
      }) => Promise<{ action: string; content: Record<string, unknown> | null }>;
    };
  }).server?.elicitInput;

  if (!elicit) {
    ctx.log.warn("scholar.corpus: elicitInput not available on server");
    return { code: "FIRST_RUN_ELICIT_UNAVAILABLE" };
  }

  let elicitResult: { action: string; content: Record<string, unknown> | null };
  try {
    elicitResult = await elicit({
      message:
        "Welcome to Scholar! Where would you like to store your PDF library? " +
        `(default: ${suggestion})`,
      requestedSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path to your PDF root directory",
            default: suggestion,
          },
        },
        required: ["path"],
      },
    });
  } catch (err) {
    ctx.log.error("scholar.corpus: elicitInput threw", { err: String(err) });
    return { code: "FIRST_RUN_ELICIT_UNAVAILABLE" };
  }

  if (elicitResult.action !== "accept" || !elicitResult.content) {
    ctx.log.info("scholar.corpus: first-run dismissed by user");
    return { code: "FIRST_RUN_DISMISSED" };
  }

  const pdfRoot = (elicitResult.content["path"] as string | undefined) ?? suggestion;

  // Basic absolute-path validation — the root doesn't need to exist at create-time;
  // roots.list will surface a "configure a PDF root" affordance if it's absent later.
  if (!pdfRoot || (typeof pdfRoot !== "string") || !isAbsolute(pdfRoot)) {
    ctx.log.warn("scholar.corpus: first-run received non-absolute path, using suggestion", {
      received: pdfRoot,
      suggestion,
    });
  }

  const resolvedRoot = isAbsolute(pdfRoot ?? "") ? pdfRoot : suggestion;
  const slug = "library";

  try {
    await provisionBootstrapCorpus(ctx, slug, resolvedRoot, runtimeRoot);
  } catch (err) {
    ctx.log.error("scholar.corpus: first-run provisioning failed", { err: String(err) });
    // Distinct from FIRST_RUN_ELICIT_UNAVAILABLE: that means "the host has no
    // elicitation capability so we couldn't even ask the user"; this means
    // "we got user input but the DB/sqlite-vec/permissions side blew up".
    // Same code would tell hosts to skip first-run and silently mask DB
    // corruption indefinitely.
    return {
      code: "FIRST_RUN_PROVISION_FAILED",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  ctx.log.info("scholar.corpus: first-run complete", { slug, pdfRoot: resolvedRoot });
  return { code: "FIRST_RUN_COMPLETE", slug };
}

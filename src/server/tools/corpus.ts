// src/server/tools/corpus.ts — corpus plan cycle 6.3 (Green)
//
// Implements scholar.corpus.{list,create,activate,status,export,reset-init,archive}
// and the scholar.dashboard view-opener per §5.5, §5.6, §5.37, §7.3, §7.6, §8.1, §10.
//
// Design notes:
//   - Every handler snapshots ctx.db on its first line (§7.6 invariant #3).
//   - Slot keys include resolveRuntimeRoot() so test-isolated tmpDirs produce
//     distinct slot namespaces even within the same module-level Map.
//   - corpus.create uses a fire-and-clear slot (clears after factory settles) to
//     allow subsequent creates for the same slug without server restart.
//   - corpus.activate uses a retain-on-success slot (cleared only by reset-init)
//     so re-activation of an already-open corpus is a fast-path idempotency return.
import { join, dirname, basename } from "node:path";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RegisterTools, ServerContext } from "./registry.ts";
import { openWithPragmas, applyMigrations } from "../db/migrations.ts";
import { sanitizeText } from "../ingest/primitives.ts";
import { allPdfRoots } from "../db/default-pdf-root.ts";
import { writeRuntimeConfig } from "../util/runtime-config.ts";
import { nowIso } from "../db/nowIso.ts";
import { rawClient } from "../db/raw-client.ts";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// Error
// ═══════════════════════════════════════════════════════════════════════════════

export class CorpusError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CorpusError";
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Slug validation (invariant #1, §5.5)
// ═══════════════════════════════════════════════════════════════════════════════

const SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;
// Windows-reserved filenames (rejected everywhere because the slug is the
// SQLite file basename and Windows reserves these at the filesystem level).
const WINDOWS_RESERVED = new Set([
  "con", "nul", "aux", "prn",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`) as string[],
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`) as string[],
]);
const RESERVED_SLUGS = new Set(["config", ...WINDOWS_RESERVED]);

function validateSlug(slug: string): void {
  if (
    typeof slug !== "string" ||
    slug.includes("\x00") ||
    !SLUG_RE.test(slug) ||
    RESERVED_SLUGS.has(slug.toLowerCase())
  ) {
    throw new CorpusError("INVALID_SLUG", `Invalid corpus slug: "${slug}"`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// display_name sanitization (invariant #2 — strip rather than reject for UX)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Pre-strips bidi-override, PUA, and tag-block codepoints from display_name
 * so that sanitizeText (which throws on them) can safely apply the remaining
 * normalization + length-cap. Display names are human labels — stripping is
 * better UX than hard-rejecting a corpus create.
 */
function stripDangerousUnicode(s: string): string {
  const chars: string[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    // Bidi overrides (U+202A–U+202E, U+2066–U+2069)
    if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) continue;
    // Tag block (U+E0000–U+E007F)
    if (cp >= 0xe0000 && cp <= 0xe007f) continue;
    // Private-use areas (U+E000–U+F8FF, U+F0000+)
    if ((cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000) continue;
    chars.push(ch);
  }
  return chars.join("");
}

function sanitizeDisplayName(raw: string, slug: string, log: ServerContext["log"]): string {
  const stripped = stripDangerousUnicode(raw);
  if (stripped.length !== raw.length) {
    log.warn("display_name: dangerous Unicode chars stripped", { slug });
  }
  // sanitizeText handles NFC, Cc/Cf strip, and length-cap
  const sanitized = sanitizeText(stripped, { maxLen: 128 });
  if (sanitized.length < stripped.length) {
    log.warn("display_name: truncated to 128 chars", { slug });
  }
  return sanitized;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Runtime-root + path helpers
// ═══════════════════════════════════════════════════════════════════════════════

export function resolveRuntimeRoot(): string {
  return (
    process.env.SCHOLAR_RUNTIME_ROOT ??
    join(process.env.HOME ?? process.env.USERPROFILE ?? ".", "mcp-data", "scholar", "runtime")
  );
}

function corpusDbPath(slug: string, runtimeRoot: string): string {
  return join(runtimeRoot, "dbs", `scholar-${slug}.db`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Memoization slots (runtimeRoot-keyed for test isolation)
// ═══════════════════════════════════════════════════════════════════════════════

// Create lock: fire-and-clear (slot removed after factory settles).
// Purpose: serialize concurrent creates for the same slug; does NOT prevent
// subsequent creates for the same slug after the first completes.
const createSlots = new Map<string, Promise<unknown>>();

async function withCreateLock<T>(slug: string, runtimeRoot: string, factory: () => Promise<T>): Promise<T> {
  const key = `corpus.create:${runtimeRoot}:${slug}`;
  const existing = createSlots.get(key);
  if (existing) return await (existing as Promise<T>);

  const p = factory().finally(() => {
    if (createSlots.get(key) === p) createSlots.delete(key);
  });
  createSlots.set(key, p);
  return await p;
}

// Activate slot: retain-on-success (cleared only by corpus.reset-init).
// Purpose: prevent re-running the corpus-open initialization for an already-open
// corpus. corpus.activate's idempotency check fires before this slot is consulted,
// but the slot prevents concurrent activates from racing through the DB open.
const activateSlots = new Map<string, Promise<unknown>>();

async function withActivateLock<T>(slug: string, runtimeRoot: string, factory: () => Promise<T>): Promise<T> {
  const key = `corpus:${runtimeRoot}:${slug}`;
  const existing = activateSlots.get(key);
  if (existing) return await (existing as Promise<T>);

  const p = factory().catch((err: unknown) => {
    // Clear slot on failure so callers can retry (retry semantics per §7.3).
    activateSlots.delete(key);
    throw err;
  }) as Promise<T>;
  activateSlots.set(key, p as Promise<unknown>);
  return await p;
}

function clearActivateSlot(slug: string, runtimeRoot: string): void {
  const key = `corpus:${runtimeRoot}:${slug}`;
  activateSlots.delete(key);
}

// ═══════════════════════════════════════════════════════════════════════════════
// corpus DB open helper
// ═══════════════════════════════════════════════════════════════════════════════

function openCorpusDb(slug: string, runtimeRoot: string): BunSQLiteDatabase {
  const path = corpusDbPath(slug, runtimeRoot);
  const db = openWithPragmas(path);
  applyMigrations(db);
  return db;
}

// ═══════════════════════════════════════════════════════════════════════════════
// currentStatusPayload — shared by activate + idempotency return
// ═══════════════════════════════════════════════════════════════════════════════

function currentStatusPayload(ctx: ServerContext) {
  const activeId = ctx.config.activeCorpusId();
  return {
    activeCorpusId: activeId ?? null,
    // dbOpen reflects the REAL in-process handle, not the persisted activeCorpusId
    // (Bug #2a′): a fresh process can have a persisted active id with ctx.db still
    // undefined. Reporting `activeId !== undefined` here would falsely claim the
    // db is open.
    dbOpen: ctx.db !== undefined,
    // Operator-facing discriminator (Bug #3 degrade visibility): isHealthy().alive
    // is true for a wired live pdf child, false for the throwing stub — so a failed
    // spawn (which degrades to the stub) is distinguishable from "wiring never landed".
    pdf_child: ctx.pdf.isHealthy(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Handlers
// ═══════════════════════════════════════════════════════════════════════════════

// ─── scholar.corpus.list ─────────────────────────────────────────────────────

async function handleList(_args: unknown, ctx: ServerContext): Promise<unknown> {
  const _db = ctx.db; // snapshot at entry (§7.6)
  return { corpora: ctx.config.corpora() };
}

// ─── scholar.corpus.create ───────────────────────────────────────────────────

async function handleCreate(args: unknown, ctx: ServerContext): Promise<unknown> {
  const _db = ctx.db; // snapshot at entry
  const { slug, display_name, initial_pdf_root } = args as {
    slug: string;
    display_name: string;
    initial_pdf_root: string;
  };

  validateSlug(slug);
  const sanitized = sanitizeDisplayName(display_name, slug, ctx.log);
  const runtimeRoot = resolveRuntimeRoot();

  await withCreateLock(slug, runtimeRoot, async () => {
    const dbPath = corpusDbPath(slug, runtimeRoot);

    // Step a: orphan DB check
    if (existsSync(dbPath)) {
      throw new CorpusError("ORPHAN_DB_EXISTS", `Per-corpus DB already exists at ${dbPath}`);
    }

    // Steps b–d: provision per-corpus DB (try/catch → unlink on failure)
    let corpusDb: BunSQLiteDatabase | undefined;
    try {
      mkdirSync(join(runtimeRoot, "dbs"), { recursive: true });
      corpusDb = openWithPragmas(dbPath);  // b: creates file; PRAGMA foreign_keys = ON
      applyMigrations(corpusDb);            // c–d: Drizzle migrations + runRawDdl
      // e: loadVecAndProbeDim — deferred until extraction cycle 6.5.
      //    Corpus is created without chunk_vec initially; extraction fills it.
    } catch (err) {
      if (corpusDb) {
        try { rawClient(corpusDb).close(); } catch { /* ignore */ }
      }
      try { unlinkSync(dbPath); } catch { /* file may not have been created */ }
      throw err;
    }

    // Step h: Config-DB transaction — INSERT corpora + INSERT pdf_roots (is_default=true)
    const createdAt = nowIso();
    const client = rawClient(ctx.configDb);
    const insertTx = client.transaction(() => {
      client
        .query("INSERT INTO corpora (id, display_name, created_at) VALUES (?, ?, ?)")
        .run(slug, sanitized, createdAt);
      client
        .query("INSERT INTO pdf_roots (corpus_id, path, is_default) VALUES (?, ?, ?)")
        .run(slug, initial_pdf_root, 1);
    });
    insertTx();
  });

  return { slug, created: true };
}

// ─── scholar.corpus.activate ─────────────────────────────────────────────────

async function handleActivate(args: unknown, ctx: ServerContext): Promise<unknown> {
  const _db = ctx.db; // snapshot at entry (§7.6)
  const { slug } = args as { slug: string };

  // Idempotency: already-active *and already open in THIS process* → return current
  // status without re-running the factory. The `&& ctx.db` conjunct is load-bearing
  // (Bug #2a′): a fresh runServer process inherits a *persisted* activeCorpusId from
  // a prior session but has ctx.db === undefined. A bare activeCorpusId check would
  // short-circuit and never open the corpus DB, so activate would report success
  // while every corpus-scoped tool (ingest, pdf.open) fails with no open db. The
  // conjunct means "active in this process"; a fresh process falls through and opens.
  if (ctx.config.activeCorpusId() === slug && ctx.db) {
    return currentStatusPayload(ctx);
  }

  // Pre-flight: corpus must exist and not be archived
  const row = ctx.config.corpora().find(c => c.id === slug);
  if (!row) throw new CorpusError("CORPUS_NOT_FOUND", `Corpus not found: "${slug}"`);
  if (row.archived_at) throw new CorpusError("CORPUS_ARCHIVED", `Corpus is archived: "${slug}"`);

  const runtimeRoot = resolveRuntimeRoot();

  await withActivateLock(slug, runtimeRoot, async () => {
    // I2 race fix: re-read archived_at INSIDE the factory to close the
    // activate-vs-archive race window (if archive landed after pre-flight).
    const freshRow = ctx.config.corpora().find(c => c.id === slug);
    if (freshRow?.archived_at) {
      throw new CorpusError("CORPUS_ARCHIVED", `Corpus was archived during activation`);
    }

    // Open per-corpus DB (PRAGMA foreign_keys = ON, applyMigrations).
    const db = openCorpusDb(slug, runtimeRoot);

    // Write last_opened_at INSIDE factory (§7.3 step 4 — not written again after).
    ctx.configDb.run(
      sql`UPDATE corpora SET last_opened_at = ${nowIso()} WHERE id = ${slug}`,
    );

    ctx.db = db;  // mutate in place — handlers that snapshot at entry are safe
    ctx.config.set("activeCorpusId", slug);

    // Atomic tmp+fdatasync+rename write to runtime/config.json (durable cache).
    await writeRuntimeConfig({ activeCorpusId: slug }, runtimeRoot);

    // Populate pdf child's roots from config DB. Best-effort (Bug #2a): a missing
    // or crashed pdf child must NOT fail activation — the corpus is already durably
    // active (ctx.db + activeCorpusId + config.json committed above). With the pdf
    // child wired (runServer) this succeeds; against the CLI stub or a crashed child
    // it throws and we log + continue. pdf features then surface their own
    // PDF_CHILD_UNAVAILABLE; corpus/search/digest are unaffected. Roots are re-pushed
    // on the next activate (and on pdf-child respawn, which replays current roots).
    const roots = allPdfRoots(ctx.configDb, slug);
    try {
      await ctx.pdf.setRoots(roots);
    } catch (err) {
      ctx.log.warn(
        "corpus.activate: pdf root push failed (corpus active; pdf features degraded until child available)",
        { slug, err: String(err) },
      );
    }
  });

  return currentStatusPayload(ctx);
}

// ─── scholar.corpus.archive ──────────────────────────────────────────────────

async function handleArchive(args: unknown, ctx: ServerContext): Promise<unknown> {
  const _db = ctx.db; // snapshot at entry
  const { slug } = args as { slug: string };

  // Verify corpus exists
  const row = ctx.config.corpora().find(c => c.id === slug);
  if (!row) throw new CorpusError("CORPUS_NOT_FOUND", `Corpus not found: "${slug}"`);

  const archivedAt = nowIso();

  // M4 commit-order discipline: DB UPDATE is the durable point.
  // In-memory and config.json updates follow only on DB success.
  ctx.configDb.run(
    sql`UPDATE corpora SET archived_at = ${archivedAt} WHERE id = ${slug}`,
  );

  // If this corpus is currently active, clear in-memory state + config.json.
  const runtimeRoot = resolveRuntimeRoot();
  if (ctx.config.activeCorpusId() === slug) {
    ctx.db = undefined;  // in-memory clear
    ctx.config.set("activeCorpusId", null);
    await writeRuntimeConfig({ activeCorpusId: null }, runtimeRoot);
  }

  // Also clear the activate slot so it can be reset-and-re-opened if unarchived later.
  clearActivateSlot(slug, runtimeRoot);

  return { slug, archived_at: archivedAt };
}

// ─── scholar.corpus.status ───────────────────────────────────────────────────

async function handleStatus(args: unknown, ctx: ServerContext): Promise<unknown> {
  const _db = ctx.db; // snapshot at entry
  const { slug } = args as { slug?: string };

  const targetSlug = slug ?? ctx.config.activeCorpusId();
  if (!targetSlug) throw new CorpusError("NO_ACTIVE_CORPUS", "No active corpus. Activate one first.");

  const row = ctx.config.corpora().find(c => c.id === targetSlug);
  if (!row) throw new CorpusError("CORPUS_NOT_FOUND", `Corpus not found: "${targetSlug}"`);

  // Paper count — available only if this corpus is currently the active (open) one.
  let paperCount = 0;
  if (ctx.config.activeCorpusId() === targetSlug && _db) {
    const rows = _db.all(sql`SELECT COUNT(*) AS cnt FROM papers`) as { cnt: number }[];
    paperCount = rows[0]?.cnt ?? 0;
  }

  return {
    id: row.id,
    display_name: row.display_name,
    created_at: row.created_at,
    last_opened_at: row.last_opened_at,
    archived_at: row.archived_at,
    paper_count: paperCount,
  };
}

// ─── scholar.corpus.export ───────────────────────────────────────────────────
// §5.37 — packs per-corpus DB to runtime/exports/<slug>-<ts>.tar.zst.
// No user-supplied output path (§12.0 M5 — no untrusted path crossing the boundary).

async function handleExport(args: unknown, ctx: ServerContext): Promise<unknown> {
  const _db = ctx.db; // snapshot at entry
  const { slug } = args as { slug: string };

  const row = ctx.config.corpora().find(c => c.id === slug);
  if (!row) throw new CorpusError("CORPUS_NOT_FOUND", `Corpus not found: "${slug}"`);

  const runtimeRoot = resolveRuntimeRoot();
  const src = corpusDbPath(slug, runtimeRoot);
  if (!existsSync(src)) {
    throw new CorpusError("CORPUS_DB_MISSING", `Per-corpus DB not found at ${src}`);
  }

  const ts = nowIso().replace(/[:.]/g, "-").slice(0, 19);
  const exportDir = join(runtimeRoot, "exports");
  mkdirSync(exportDir, { recursive: true });
  const dest = join(exportDir, `${slug}-${ts}.tar.zst`);

  // Audit H1: argv-form spawn so paths can't be shell-interpolated. Uses
  // `tar --zstd` (GNU tar ≥1.31; bsdtar on macOS) instead of a `tar | zstd`
  // pipeline so we don't need a shell at all. The closed-corpus case still
  // works — tar reads the DB file directly without needing an open handle.
  const { exited, stderr } = Bun.spawn(
    ["tar", "--zstd", "-cf", dest, "-C", dirname(src), basename(src)],
    { stdout: "ignore", stderr: "pipe" },
  );
  const code = await exited;
  if (code !== 0) {
    const errMsg = await new Response(stderr).text();
    throw new CorpusError("EXPORT_FAILED", `tar/zstd failed (exit ${code}): ${errMsg}`);
  }

  return { slug, exported_to: dest };
}

// ─── scholar.corpus.reset-init ───────────────────────────────────────────────

async function handleResetInit(args: unknown, ctx: ServerContext): Promise<unknown> {
  const _db = ctx.db; // snapshot at entry
  const { slug } = args as { slug: string };
  const runtimeRoot = resolveRuntimeRoot();
  clearActivateSlot(slug, runtimeRoot);
  ctx.log.info("corpus.reset-init: cleared activation slot", { slug });
  return { slug, reset: true };
}

// ─── scholar.dashboard view-opener ───────────────────────────────────────────

async function handleDashboard(_args: unknown, ctx: ServerContext): Promise<unknown> {
  const _db = ctx.db; // snapshot at entry

  // If no corpus is configured, trigger first-run wizard.
  if (!ctx.config.activeCorpusId() && ctx.config.corpora().length === 0) {
    // First-run is caller-responsibility; dashboard still opens.
    ctx.log.info("scholar.dashboard: no corpus configured, first-run wizard should be triggered");
  }

  // View-opener per §7.6 table: returns structuredContent for the host to open.
  return { view: "dashboard", resource: "ui://scholar/app.html" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// registerTools
// ═══════════════════════════════════════════════════════════════════════════════

const slugSchema = z.string().describe("Corpus slug (a-z, digits, dashes; 1–64 chars)");

export const registerTools: RegisterTools = (_server, _ctx, _register) => {
  _register(
    "scholar.corpus.list",
    { description: "List all corpora registered in the config DB.", inputSchema: z.object({}) },
    handleList,
  );
  _register(
    "scholar.corpus.create",
    {
      description: "Create a new corpus. Provisions per-corpus DB and registers in config DB.",
      inputSchema: z.object({
        slug: slugSchema,
        display_name: z.string().describe("Human-friendly label"),
        initial_pdf_root: z.string().describe("Path to the initial PDF root directory"),
      }),
    },
    handleCreate,
  );
  _register(
    "scholar.corpus.activate",
    {
      description: "Activate a corpus (open its DB, set as current).",
      inputSchema: z.object({ slug: slugSchema }),
    },
    handleActivate,
  );
  _register(
    "scholar.corpus.archive",
    {
      description: "Archive a corpus (marks it inactive; data retained).",
      inputSchema: z.object({ slug: slugSchema }),
    },
    handleArchive,
  );
  _register(
    "scholar.corpus.status",
    {
      description: "Return counts and metadata for the active (or specified) corpus.",
      inputSchema: z.object({ slug: slugSchema.optional() }),
    },
    handleStatus,
  );
  _register(
    "scholar.corpus.export",
    {
      description: "Pack the per-corpus DB to runtime/exports/<slug>-<ts>.tar.zst.",
      inputSchema: z.object({ slug: slugSchema }),
    },
    handleExport,
  );
  _register(
    "scholar.corpus.reset-init",
    {
      description: "Clear the corpus activation slot (allows re-initialization after failure).",
      inputSchema: z.object({ slug: slugSchema }),
    },
    handleResetInit,
  );
  _register(
    "scholar.dashboard",
    { description: "Open the scholar dashboard view.", inputSchema: z.object({}) },
    handleDashboard,
  );
};

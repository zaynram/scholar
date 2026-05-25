// src/server/tools/digest.test.ts — extraction cycle 6.8 (Red)
//
// scholar.digest.generate: Ollama by default; opt-in `use_claude:true` returns
// the askClaude sentinel without calling Ollama. Wraps every abstract in
// <untrusted_data id=NONCE> tags per §12.0 with a per-request hex nonce.
// Persists to digests table with scope_signature for §9.3 cache invalidation.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { generateDigest } from "./digest.ts";

let server: ReturnType<typeof Bun.serve> | null = null;
let chatBody: unknown = null;
let chatStatus = 200;
let chatResponse: unknown = { message: { content: "## Synthesis\n\nPaper 1 is about X." }, done: true };

beforeEach(() => {
  chatBody = null;
  chatStatus = 200;
  chatResponse = { message: { content: "## Synthesis\n\nPaper 1 is about X." }, done: true };
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/chat") {
        chatBody = await req.json();
        if (chatStatus !== 200) return new Response("err", { status: chatStatus });
        return Response.json(chatResponse);
      }
      return new Response("not found", { status: 404 });
    },
  });
  process.env.SCHOLAR_OLLAMA_URL = `http://127.0.0.1:${server!.port}`;
});

afterEach(() => {
  server?.stop(true);
  delete process.env.SCHOLAR_OLLAMA_URL;
});

function seededDb() {
  const sqlite = new Database(":memory:");
  sqlite.run(`CREATE TABLE papers (
    id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    authors TEXT, abstract TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL, status_touched_at TEXT
  )`);
  sqlite.run(`CREATE TABLE digests (
    id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, scope_signature TEXT NOT NULL,
    body_md TEXT NOT NULL, generated_at TEXT NOT NULL,
    model TEXT, paper_count INTEGER
  )`);
  sqlite.run(`INSERT INTO papers(id,key,title,abstract,imported_at) VALUES
    ('p1','foo','Foo paper','We study foo.','2026-01-01T00:00:00.000Z'),
    ('p2','bar','Bar paper','Bar is an extension of foo.','2026-01-01T00:00:00.000Z')`);
  return sqlite;
}

const noopLog = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

function fakeCtx(sqlite: Database) {
  const db = drizzle(sqlite);
  return {
    db, configDb: db,
    pdf: {
      interact: async () => null,
      getText: async () => "",
      currentRoots: () => [],
      setRoots: async () => {},
      isHealthy: () => ({ alive: true, lastOkAt: 0, stdioOpen: true }),
    },
    config: {
      get: <T,>(_k: string): T | undefined => undefined,
      set: (_k: string, _v: unknown) => {},
      corpora: () => [], activeCorpusId: () => undefined,
    },
    log: noopLog,
    withCorpus: async <T,>(fn: (db: ReturnType<typeof drizzle>) => Promise<T> | T) => await fn(db),
  } as unknown as Parameters<typeof generateDigest>[0];
}

test("digest.generate (default Ollama): wraps abstracts in <untrusted_data id=NONCE> and persists", async () => {
  const sqlite = seededDb();
  const result = await generateDigest(fakeCtx(sqlite), { scope_key: "all" });
  expect(result.body_md).toContain("Synthesis");
  expect(result.digest_id).toBeDefined();

  // Untrusted wrapping discipline (§12.0)
  const body = chatBody as { messages: Array<{ role: string; content: string }>; model: string };
  const userMsg = body.messages.find((m) => m.role === "user")!;
  expect(userMsg.content).toMatch(/<untrusted_data id="[0-9a-f]{16}">/);
  expect(userMsg.content).toMatch(/<\/untrusted_data id="[0-9a-f]{16}">/);
  expect(userMsg.content).toContain("We study foo");

  // System prompt carries the §12.0 mandatory clause.
  const sysMsg = body.messages.find((m) => m.role === "system")!;
  expect(sysMsg.content).toContain("untrusted_data");

  // Default model = qwen3:8b per §11.
  expect(body.model).toBe("qwen3:8b");

  // Persisted to digests table.
  const row = sqlite.query(
    "SELECT body_md, model, paper_count FROM digests",
  ).get() as { body_md: string; model: string; paper_count: number };
  expect(row.body_md).toContain("Synthesis");
  expect(row.model).toBe("qwen3:8b");
  expect(row.paper_count).toBe(2);
});

test("digest.generate (opt-in askClaude): returns sentinel and does NOT call Ollama", async () => {
  const sqlite = seededDb();
  chatBody = "untouched";
  const result = await generateDigest(fakeCtx(sqlite), { scope_key: "all", use_claude: true });
  expect(result.askClaude).toBeDefined();
  expect(result.askClaude?.reason).toBe("user-opt-in");
  expect(result.askClaude?.prompt).toMatch(/<untrusted_data id=/);
  expect(chatBody).toBe("untouched");
  // Body must still be empty (the sentinel carries the data).
  expect(result.body_md).toBe("");
});

test("digest.generate (Ollama offline, no opt-in): returns degraded placeholder", async () => {
  const sqlite = seededDb();
  // Point to a closed port.
  process.env.SCHOLAR_OLLAMA_URL = "http://127.0.0.1:1";
  const result = await generateDigest(fakeCtx(sqlite), { scope_key: "all" });
  expect(result.body_md).toMatch(/Ollama unavailable/i);
});

test("digest.generate: NO_ACTIVE_CORPUS guard", async () => {
  const sqlite = seededDb();
  const ctx = fakeCtx(sqlite) as unknown as Record<string, unknown>;
  ctx.db = undefined;
  await expect(
    generateDigest(ctx as unknown as Parameters<typeof generateDigest>[0], { scope_key: "all" }),
  ).rejects.toThrow(/NO_ACTIVE_CORPUS/);
});

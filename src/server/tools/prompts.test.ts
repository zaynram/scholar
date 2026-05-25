// src/server/tools/prompts.test.ts — extraction cycle 6.8 (Red)
//
// scholar.prompts.generate: Ollama by default; opt-in `use_claude:true`
// returns the askClaude sentinel. Per-request hex nonce + sanitize +
// wrap for the abstract payload. Parser accepts both JSON-array and
// numbered-line responses.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { generatePrompts } from "./prompts.ts";

let server: ReturnType<typeof Bun.serve> | null = null;
let chatBody: unknown = null;
let chatResponse: unknown = {
  message: {
    content: JSON.stringify([
      "What is the central claim?",
      "What evidence supports it?",
      "What are the limitations?",
    ]),
  },
  done: true,
};

beforeEach(() => {
  chatBody = null;
  chatResponse = {
    message: {
      content: JSON.stringify([
        "What is the central claim?",
        "What evidence supports it?",
        "What are the limitations?",
      ]),
    },
    done: true,
  };
  server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/api/chat") {
        chatBody = await req.json();
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
    abstract TEXT, status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL, status_touched_at TEXT
  )`);
  sqlite.run(`CREATE TABLE reading_prompts (
    paper_id TEXT PRIMARY KEY, prompts_json TEXT NOT NULL,
    generated_at TEXT NOT NULL, model TEXT
  )`);
  sqlite.run(`INSERT INTO papers(id,key,title,abstract,imported_at)
    VALUES ('p1','foo','Foo paper','We study foo.','2026-01-01T00:00:00.000Z')`);
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
  } as unknown as Parameters<typeof generatePrompts>[0];
}

test("prompts.generate (default Ollama): JSON-array response parsed and persisted", async () => {
  const sqlite = seededDb();
  const result = await generatePrompts(fakeCtx(sqlite), { paper_id: "p1" });
  expect(result.prompts).toHaveLength(3);
  expect(result.prompts[0]).toMatch(/central claim/i);

  // Untrusted wrapping discipline (§12.0)
  const body = chatBody as { messages: Array<{ role: string; content: string }>; model: string };
  const userMsg = body.messages.find((m) => m.role === "user")!;
  expect(userMsg.content).toMatch(/<untrusted_data id="[0-9a-f]{16}">/);
  expect(body.model).toBe("qwen3:8b");

  const row = sqlite.query(
    "SELECT prompts_json, model FROM reading_prompts WHERE paper_id='p1'",
  ).get() as { prompts_json: string; model: string };
  expect(JSON.parse(row.prompts_json)).toHaveLength(3);
  expect(row.model).toBe("qwen3:8b");
});

test("prompts.generate (opt-in askClaude): returns sentinel and does NOT call Ollama", async () => {
  const sqlite = seededDb();
  chatBody = "untouched";
  const result = await generatePrompts(fakeCtx(sqlite), { paper_id: "p1", use_claude: true });
  expect(result.askClaude).toBeDefined();
  expect(result.askClaude?.reason).toBe("user-opt-in");
  expect(chatBody).toBe("untouched");
  expect(result.prompts).toEqual([]);
});

test("prompts.generate (Ollama non-JSON content): line-split parser yields prompts", async () => {
  // Restart server with a non-JSON response.
  server?.stop(true);
  server = Bun.serve({
    port: 0,
    fetch: async () => Response.json({
      message: { content: "1. Q one\n2. Q two\n3. Q three" },
      done: true,
    }),
  });
  process.env.SCHOLAR_OLLAMA_URL = `http://127.0.0.1:${server!.port}`;
  const sqlite = seededDb();
  const result = await generatePrompts(fakeCtx(sqlite), { paper_id: "p1" });
  expect(result.prompts.length).toBeGreaterThanOrEqual(3);
});

test("prompts.generate: NO_ACTIVE_CORPUS guard", async () => {
  const sqlite = seededDb();
  const ctx = fakeCtx(sqlite) as unknown as Record<string, unknown>;
  ctx.db = undefined;
  await expect(
    generatePrompts(ctx as unknown as Parameters<typeof generatePrompts>[0], { paper_id: "p1" }),
  ).rejects.toThrow(/NO_ACTIVE_CORPUS/);
});

test("prompts.generate: unknown paper_id throws PAPER_NOT_FOUND", async () => {
  const sqlite = seededDb();
  await expect(
    generatePrompts(fakeCtx(sqlite), { paper_id: "nope" }),
  ).rejects.toThrow(/PAPER_NOT_FOUND|not found/);
});

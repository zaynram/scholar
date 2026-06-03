// src/server/ollama/client.test.ts — foundation cycle 6.1 (Task 1.9)
//
// Updated at chore foundation-fill-ollama-client-and-migrate-extraction
// (2026-05-25): deleted the "stubs throw 'unimplemented'" test since the
// methods now have real implementations. Retained: singleton surface
// assertions (methods exist + default model constants exported correctly).
//
// S3 roadmap batch (2026-05-27): timeout regression tests. The audit flagged
// embed/chat with no AbortSignal — a hung Ollama would hang the caller
// forever. The fixture server keeps requests open (handler awaits a
// never-resolving promise) while a short timeout via env-var override keeps
// CI runtime short. Per advisor: 200–500ms keeps the abort firmly in the
// fetch-wait window, out of the body-read race.
//
// chore cover-ollama-client-and-index-dispatch-unit-gaps (2026-06-02):
// Added chat success/fallback, listModels, and healthCheck coverage.
import { test, expect, afterEach } from "bun:test";
import {
  ollama,
  DEFAULT_EMBED_MODEL,
  DEFAULT_CHAT_MODEL,
  OllamaUnavailableError,
} from "./client.ts";

test("ollama exposes the foundation-frozen singleton surface", () => {
  expect(ollama).toBeDefined();
  expect(typeof ollama.embed).toBe("function");
  expect(typeof ollama.chat).toBe("function");
  expect(typeof ollama.listModels).toBe("function");
  expect(typeof ollama.healthCheck).toBe("function");
});

test("DEFAULT_EMBED_MODEL defaults to nomic-embed-text:v1.5", () => {
  // Only valid when SCHOLAR_OLLAMA_EMBED_MODEL is not set in test env.
  // This asserts the §11 spec default; override via env var in production.
  expect(DEFAULT_EMBED_MODEL).toBe(
    process.env.SCHOLAR_OLLAMA_EMBED_MODEL ?? "nomic-embed-text:v1.5",
  );
});

test("DEFAULT_CHAT_MODEL defaults to qwen3:8b", () => {
  expect(DEFAULT_CHAT_MODEL).toBe(
    process.env.SCHOLAR_OLLAMA_CHAT_MODEL ?? "qwen3:8b",
  );
});

test("OllamaUnavailableError has correct code and name", () => {
  const err = new OllamaUnavailableError("test");
  expect(err.code).toBe("OLLAMA_UNAVAILABLE");
  expect(err.name).toBe("OllamaUnavailableError");
  expect(err instanceof Error).toBe(true);
});

// ─── S3: timeout coverage ────────────────────────────────────────────────────

let hangingServer: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  hangingServer?.stop(true);
  hangingServer = null;
  delete process.env.SCHOLAR_OLLAMA_URL;
  delete process.env.SCHOLAR_OLLAMA_EMBED_TIMEOUT_MS;
  delete process.env.SCHOLAR_OLLAMA_CHAT_TIMEOUT_MS;
});

function startHangingServer(): string {
  hangingServer = Bun.serve({
    port: 0,
    // Handler never resolves: the request stays open until the client aborts
    // or the server is force-stopped in afterEach.
    fetch: () => new Promise<Response>(() => {}),
  });
  return `http://127.0.0.1:${hangingServer.port}`;
}

test("embed throws OllamaUnavailableError when the request exceeds the embed timeout", async () => {
  process.env.SCHOLAR_OLLAMA_URL = startHangingServer();
  process.env.SCHOLAR_OLLAMA_EMBED_TIMEOUT_MS = "250";

  const start = Date.now();
  await expect(ollama.embed("test-model", "hello")).rejects.toBeInstanceOf(
    OllamaUnavailableError,
  );
  const elapsed = Date.now() - start;
  // Should fire close to the 250ms budget — generous upper bound to avoid CI flake.
  expect(elapsed, `expected timeout near 250ms, got ${elapsed}ms`).toBeLessThan(5_000);
});

test("chat throws OllamaUnavailableError when the request exceeds the chat timeout", async () => {
  process.env.SCHOLAR_OLLAMA_URL = startHangingServer();
  process.env.SCHOLAR_OLLAMA_CHAT_TIMEOUT_MS = "250";

  const start = Date.now();
  await expect(
    ollama.chat("test-model", [{ role: "user", content: "hi" }]),
  ).rejects.toBeInstanceOf(OllamaUnavailableError);
  const elapsed = Date.now() - start;
  expect(elapsed, `expected timeout near 250ms, got ${elapsed}ms`).toBeLessThan(5_000);
});

// ─── chore cover-ollama-client-and-index-dispatch-unit-gaps ─────────────────
// chat(), listModels(), and healthCheck() success/failure branches.
// All use Bun.serve fixture servers (same pattern as the timeout tests above)
// rather than global-fetch monkey-patching, which matches the file's existing
// style and avoids any potential cross-test contamination.

// --- helpers ---

/** Start a fixture server that returns a canned JSON body with the given HTTP status. */
function startJsonServer(body: unknown, status = 200): string {
  const srv = Bun.serve({
    port: 0,
    fetch() {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  });
  jsonServers.push(srv);
  return `http://127.0.0.1:${srv.port}`;
}

const jsonServers: ReturnType<typeof Bun.serve>[] = [];

afterEach(() => {
  for (const srv of jsonServers.splice(0)) srv.stop(true);
});

// ─── embed() success (complement to the timeout test above) ──────────────────

test("embed() returns a Float32Array on success (embedding field)", async () => {
  process.env.SCHOLAR_OLLAMA_URL = startJsonServer({ embedding: [1, 2, 3] });
  const result = await ollama.embed("nomic-embed-text:v1.5", "hello");
  expect(result).toBeInstanceOf(Float32Array);
  expect(result.length).toBe(3);
  expect(result[0]).toBe(1);
});

test("embed() returns a Float32Array on success (embeddings[] field fallback)", async () => {
  process.env.SCHOLAR_OLLAMA_URL = startJsonServer({ embeddings: [[4, 5, 6]] });
  const result = await ollama.embed("nomic-embed-text:v1.5", "hello");
  expect(result).toBeInstanceOf(Float32Array);
  expect(result.length).toBe(3);
  expect(result[0]).toBe(4);
});

// ─── chat() ──────────────────────────────────────────────────────────────────

test("chat() resolves the message.content string on success", async () => {
  process.env.SCHOLAR_OLLAMA_URL = startJsonServer({
    message: { content: "hello from ollama" },
  });
  const result = await ollama.chat("test-model", [{ role: "user", content: "hi" }]);
  expect(result).toBe("hello from ollama");
});

test("chat() falls back to response field when message is absent", async () => {
  process.env.SCHOLAR_OLLAMA_URL = startJsonServer({ response: "fallback text" });
  const result = await ollama.chat("test-model", [{ role: "user", content: "hi" }]);
  expect(result).toBe("fallback text");
});

test("chat() throws when both message.content and response are empty/absent", async () => {
  // Both fields absent → "" content → throw (lines 139–141)
  process.env.SCHOLAR_OLLAMA_URL = startJsonServer({});
  await expect(
    ollama.chat("test-model", [{ role: "user", content: "hi" }]),
  ).rejects.toThrow();
});

// ─── thinking-model handling (qwen3:8b default) ──────────────────────────────

test("chat() strips a leading <think>…</think> reasoning block from content", async () => {
  // A thinking model that ignores `think: false` still prefixes its answer with
  // a reasoning monologue; scholar must return the answer only so digests and
  // reading-prompts don't leak the chain-of-thought.
  process.env.SCHOLAR_OLLAMA_URL = startJsonServer({
    message: {
      content: "<think>\nThe user wants a definition. Keep it tight.\n</think>\n\nA literature review surveys existing work on a topic.",
    },
  });
  const result = await ollama.chat("qwen3:8b", [{ role: "user", content: "define it" }]);
  expect(result).toBe("A literature review surveys existing work on a topic.");
});

test("chat() leaves content without a think block untouched", async () => {
  process.env.SCHOLAR_OLLAMA_URL = startJsonServer({
    message: { content: "A plain answer, no reasoning tags." },
  });
  const result = await ollama.chat("test-model", [{ role: "user", content: "hi" }]);
  expect(result).toBe("A plain answer, no reasoning tags.");
});

test("chat() requests think:false to suppress reasoning at the source", async () => {
  // Capture the posted body and assert the suppression flag rides along with
  // stream:false — the request-level half of the belt-and-suspenders.
  let posted: Record<string, unknown> | null = null;
  const srv = Bun.serve({
    port: 0,
    async fetch(req) {
      posted = (await req.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ message: { content: "ok" } }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  jsonServers.push(srv);
  process.env.SCHOLAR_OLLAMA_URL = `http://127.0.0.1:${srv.port}`;
  await ollama.chat("qwen3:8b", [{ role: "user", content: "hi" }]);
  expect(posted).not.toBeNull();
  expect(posted!.think).toBe(false);
  expect(posted!.stream).toBe(false);
});

// ─── listModels() ─────────────────────────────────────────────────────────────

test("listModels() returns the models array on success", async () => {
  const models = [{ name: "llama3", size: 1234, modified_at: "2025-01-01T00:00:00Z" }];
  process.env.SCHOLAR_OLLAMA_URL = startJsonServer({ models });
  const result = await ollama.listModels();
  expect(result).toEqual(models);
});

test("listModels() returns [] when the models key is absent", async () => {
  process.env.SCHOLAR_OLLAMA_URL = startJsonServer({});
  const result = await ollama.listModels();
  expect(result).toEqual([]);
});

test("listModels() rejects OllamaUnavailableError when fetch throws (unreachable host)", async () => {
  // Point at a guaranteed-dead port by starting then immediately stopping a server.
  const dead = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const deadUrl = `http://127.0.0.1:${dead.port}`;
  dead.stop(true);
  process.env.SCHOLAR_OLLAMA_URL = deadUrl;
  await expect(ollama.listModels()).rejects.toBeInstanceOf(OllamaUnavailableError);
});

test("listModels() rejects OllamaUnavailableError when res.ok is false", async () => {
  process.env.SCHOLAR_OLLAMA_URL = startJsonServer({ error: "not found" }, 503);
  await expect(ollama.listModels()).rejects.toBeInstanceOf(OllamaUnavailableError);
});

// ─── healthCheck() ────────────────────────────────────────────────────────────

test("healthCheck() returns ok:true when the server responds with 200", async () => {
  process.env.SCHOLAR_OLLAMA_URL = startJsonServer({ models: [] });
  const result = await ollama.healthCheck();
  expect(result.ok).toBe(true);
  expect(typeof result.url).toBe("string");
});

test("healthCheck() returns ok:false with HTTP error string when res.ok is false", async () => {
  process.env.SCHOLAR_OLLAMA_URL = startJsonServer({ error: "gone" }, 503);
  const result = await ollama.healthCheck();
  expect(result.ok).toBe(false);
  expect(result.error).toBe("HTTP 503");
});

test("healthCheck() returns ok:false with error message when fetch throws", async () => {
  const dead = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const deadUrl = `http://127.0.0.1:${dead.port}`;
  dead.stop(true);
  process.env.SCHOLAR_OLLAMA_URL = deadUrl;
  const result = await ollama.healthCheck();
  expect(result.ok).toBe(false);
  expect(typeof result.error).toBe("string");
  expect(result.error!.length).toBeGreaterThan(0);
});

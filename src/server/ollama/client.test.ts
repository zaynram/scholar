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

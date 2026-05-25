// src/server/ollama/client.test.ts — foundation cycle 6.1 (Task 1.9)
//
// Updated at chore foundation-fill-ollama-client-and-migrate-extraction
// (2026-05-25): deleted the "stubs throw 'unimplemented'" test since the
// methods now have real implementations. Retained: singleton surface
// assertions (methods exist + default model constants exported correctly).
import { test, expect } from "bun:test";
import { ollama, DEFAULT_EMBED_MODEL, DEFAULT_CHAT_MODEL, OllamaUnavailableError } from "./client.ts";

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

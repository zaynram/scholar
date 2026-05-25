// src/server/ollama/client.test.ts — foundation cycle 6.1 (Task 1.9)
//
// Foundation pins the singleton surface; method bodies are filled by extraction
// at cycle 6.5 (embed/listModels/healthCheck) and cycle 6.8 (chat). Foundation
// asserts only that the methods exist and that the stubs throw "unimplemented".
import { test, expect } from "bun:test";
import { ollama } from "./client.ts";

test("ollama exposes the foundation-frozen singleton surface", () => {
  expect(ollama).toBeDefined();
  expect(typeof ollama.embed).toBe("function");
  expect(typeof ollama.chat).toBe("function");
  expect(typeof ollama.listModels).toBe("function");
  expect(typeof ollama.healthCheck).toBe("function");
});

test("ollama method stubs throw 'unimplemented' at the foundation layer", async () => {
  await expect(ollama.embed({ model: "x", input: "y" })).rejects.toThrow(/unimplemented/i);
  await expect(ollama.chat({ model: "x", messages: [] })).rejects.toThrow(/unimplemented/i);
});

// src/server/extraction/ollama-http.ts — extraction cycles 6.5 / 6.8 (Green)
//
// Local HTTP client for the Ollama API used by the extraction tools
// (embeddings for refresh-extraction + papers.search; chat for digest +
// prompts). Foundation owns the §5.17 OllamaClient interface at
// src/server/ollama/client.ts; that file is foundation-owned per the lead's
// posture-B carve-out and currently exposes throw-on-call stubs awaiting
// foundation's body fill. To unblock extraction's production runtime
// without editing foundation's file, extraction ships its own minimal
// HTTP path here. Both paths talk to the same SCHOLAR_OLLAMA_URL.
//
// Scope:
//   - embedOllama(model, prompt) → Float32Array        (POST /api/embeddings)
//   - chatOllama(model, messages, opts?) → string       (POST /api/chat)
//   - OllamaUnavailableError                            (caught by digest/prompts)
//   - DEFAULT_EMBED_MODEL / DEFAULT_CHAT_MODEL constants from §11

export const DEFAULT_EMBED_MODEL =
  process.env.SCHOLAR_OLLAMA_EMBED_MODEL ?? "nomic-embed-text:v1.5";
export const DEFAULT_CHAT_MODEL =
  process.env.SCHOLAR_OLLAMA_CHAT_MODEL ?? "qwen3:8b";

export class OllamaUnavailableError extends Error {
  code = "OLLAMA_UNAVAILABLE";
  override name = "OllamaUnavailableError";
}

function baseUrl(): string {
  return process.env.SCHOLAR_OLLAMA_URL ?? "http://127.0.0.1:11434";
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new OllamaUnavailableError(
      `cannot reach Ollama at ${baseUrl()}: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    if (res.status >= 500 || res.status === 404) {
      throw new OllamaUnavailableError(
        `Ollama responded ${res.status} at ${baseUrl()}${path}`,
      );
    }
    throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export async function embedOllama(
  model: string,
  prompt: string,
): Promise<Float32Array> {
  // Ollama's /api/embeddings is the legacy endpoint; the newer /api/embed
  // returns embeddings nested under `embeddings[0]`. We POST to the legacy
  // path because foundation's OllamaClient interface declares the same.
  const body = { model, prompt };
  const res = await postJson<{ embedding?: number[]; embeddings?: number[][] }>(
    "/api/embeddings",
    body,
  );
  const vec = res.embedding ?? res.embeddings?.[0];
  if (!vec || vec.length === 0) {
    throw new Error(`Ollama /api/embeddings returned no embedding for model=${model}`);
  }
  return Float32Array.from(vec);
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chatOllama(
  model: string,
  messages: ChatMessage[],
  opts?: { temperature?: number; num_ctx?: number },
): Promise<string> {
  const body = {
    model,
    messages,
    stream: false,
    options: opts,
  };
  const res = await postJson<{ message?: { content: string }; response?: string }>(
    "/api/chat",
    body,
  );
  const content = res.message?.content ?? res.response ?? "";
  if (!content) {
    throw new Error(`Ollama /api/chat returned empty content for model=${model}`);
  }
  return content;
}

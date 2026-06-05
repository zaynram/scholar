// src/server/ollama/client.ts — foundation cycle 6.1 (Task 1.9)
//
// Canonical production HTTP client for the Ollama API. Filled at chore
// foundation-fill-ollama-client-and-migrate-extraction (2026-05-25).
// Previously held throw-on-call stubs; extraction shipped a parallel path in
// extraction/ollama-http.ts to unblock cycles 6.5/6.8 without editing this
// foundation-owned file. That workaround has been removed; this file is now
// the single source of truth for all Ollama HTTP access.
//
// Per spec §7.6 + lead ruling 2026-05-24: this client is NOT a `ServerContext`
// field; consumers `import { ollama } from "../ollama/client"` directly.

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface OllamaClient {
  /** POST /api/embeddings → Float32Array */
  embed(model: string, prompt: string): Promise<Float32Array>;
  /** POST /api/chat → response content string */
  chat(model: string, messages: ChatMessage[], opts?: { temperature?: number; num_ctx?: number }): Promise<string>;
  /** GET /api/tags → list of available models */
  listModels(): Promise<OllamaModel[]>;
  /** Quick reachability probe — GET /api/tags with 2s timeout */
  healthCheck(): Promise<{ ok: boolean; url: string; error?: string }>;
}

// ─── Re-exported constants (single source of truth post-migration) ────────────

export const DEFAULT_EMBED_MODEL: string =
  process.env.SCHOLAR_OLLAMA_EMBED_MODEL ?? "nomic-embed-text:v1.5";

export const DEFAULT_CHAT_MODEL: string =
  process.env.SCHOLAR_OLLAMA_CHAT_MODEL ?? "qwen3:8b";

export class OllamaUnavailableError extends Error {
  code = "OLLAMA_UNAVAILABLE";
  override name = "OllamaUnavailableError";
  constructor(message: string) {
    super(message);
  }
}

// ─── Implementation ───────────────────────────────────────────────────────────

// S3 roadmap batch (2026-05-27): per-call timeouts so a hung Ollama process
// can't stall callers indefinitely. Env-overridable to keep tests fast.
//
// Defect #5 (2026-06-05): the chat budget was raised 120s → 300s. Field report
// (Cowork, 88-paper corpus) measured a warm digest at 146s — past the old 120s
// ceiling — so the default aborted a digest that would otherwise have succeeded.
// 300s gives headroom for large corpora / slower CPUs; it is a ceiling, not a
// wait, and stays env-overridable via SCHOLAR_OLLAMA_CHAT_TIMEOUT_MS.
const DEFAULT_EMBED_TIMEOUT_MS = 60_000;
const DEFAULT_CHAT_TIMEOUT_MS = 300_000;

class OllamaClientImpl implements OllamaClient {
  // baseUrl() is a method (not a stored property) so env-var changes made by
  // tests via `process.env.SCHOLAR_OLLAMA_URL = ...` take effect at call time.
  private baseUrl(): string {
    return process.env.SCHOLAR_OLLAMA_URL ?? "http://127.0.0.1:11434";
  }

  private embedTimeoutMs(): number {
    const v = process.env.SCHOLAR_OLLAMA_EMBED_TIMEOUT_MS;
    return v ? Number(v) : DEFAULT_EMBED_TIMEOUT_MS;
  }

  private chatTimeoutMs(): number {
    const v = process.env.SCHOLAR_OLLAMA_CHAT_TIMEOUT_MS;
    return v ? Number(v) : DEFAULT_CHAT_TIMEOUT_MS;
  }

  private async postJson<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    const url = this.baseUrl();
    let res: Response;
    try {
      res = await fetch(`${url}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === "TimeoutError") {
        throw new OllamaUnavailableError(
          `Ollama timed out after ${timeoutMs}ms at ${url}${path}`,
        );
      }
      throw new OllamaUnavailableError(
        `cannot reach Ollama at ${url}: ${e.message}`,
      );
    }
    if (!res.ok) {
      if (res.status >= 500 || res.status === 404) {
        throw new OllamaUnavailableError(
          `Ollama responded ${res.status} at ${url}${path}`,
        );
      }
      throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async embed(model: string, prompt: string): Promise<Float32Array> {
    const body = { model, prompt };
    const res = await this.postJson<{ embedding?: number[]; embeddings?: number[][] }>(
      "/api/embeddings",
      body,
      this.embedTimeoutMs(),
    );
    const vec = res.embedding ?? res.embeddings?.[0];
    if (!vec || vec.length === 0) {
      throw new Error(`Ollama /api/embeddings returned no embedding for model=${model}`);
    }
    return Float32Array.from(vec);
  }

  async chat(
    model: string,
    messages: ChatMessage[],
    opts?: { temperature?: number; num_ctx?: number },
  ): Promise<string> {
    const body = {
      model,
      messages,
      stream: false,
      // Thinking models (e.g. the default qwen3:8b) otherwise prefix their
      // answer with a <think>…</think> reasoning monologue that would leak into
      // digests and reading-prompts. Ask the model to skip it — this also saves
      // the GPU from generating tokens we'd discard. Non-thinking models and
      // older Ollama builds ignore the field.
      think: false,
      options: opts,
    };
    const res = await this.postJson<{ message?: { content: string }; response?: string }>(
      "/api/chat",
      body,
      this.chatTimeoutMs(),
    );
    const raw = res.message?.content ?? res.response ?? "";
    // Defensive strip: if a model ignores `think: false` (or honors it only
    // partially), drop a leading <think>…</think> block so callers get the
    // answer only. Belt-and-suspenders with the request-level suppression.
    const content = raw.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");
    if (!content) {
      throw new Error(`Ollama /api/chat returned empty content for model=${model}`);
    }
    return content;
  }

  async listModels(): Promise<OllamaModel[]> {
    const url = this.baseUrl();
    let res: Response;
    try {
      res = await fetch(`${url}/api/tags`);
    } catch (err) {
      throw new OllamaUnavailableError(
        `cannot reach Ollama at ${url}: ${(err as Error).message}`,
      );
    }
    if (!res.ok) {
      throw new OllamaUnavailableError(
        `Ollama responded ${res.status} at ${url}/api/tags`,
      );
    }
    const data = (await res.json()) as { models?: OllamaModel[] };
    return data.models ?? [];
  }

  async healthCheck(): Promise<{ ok: boolean; url: string; error?: string }> {
    const url = this.baseUrl();
    try {
      const res = await fetch(`${url}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        return { ok: true, url };
      }
      return { ok: false, url, error: `HTTP ${res.status}` };
    } catch (err) {
      return {
        ok: false,
        url,
        error: (err as Error).message,
      };
    }
  }
}

/** Process-singleton. One connection-pool + one health-check state across callers. */
export const ollama: OllamaClient = new OllamaClientImpl();

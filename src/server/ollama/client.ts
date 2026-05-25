// src/server/ollama/client.ts — foundation cycle 6.1 (Task 1.9)
//
// Foundation-frozen singleton surface. Method bodies are filled by extraction
// at cycle 6.5 (embed/listModels/healthCheck) and cycle 6.8 (chat).
// Importers: digest.ts, prompts.ts, pdf.ts, papers.ts — never re-construct.
//
// Per spec §7.6 + lead ruling 2026-05-24: this client is NOT a `ServerContext`
// field; consumers `import { ollama } from "../ollama/client"` directly.

export interface OllamaEmbedRequest {
  model: string;
  input: string;
}
export interface OllamaEmbedResponse {
  embedding: number[];
  model: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  options?: { temperature?: number; num_ctx?: number };
}
export interface OllamaChatResponse {
  content: string;
  model: string;
  done_reason?: string;
}

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export interface OllamaClient {
  /** Filled by extraction cycle 6.5 — POST /api/embeddings */
  embed(req: OllamaEmbedRequest): Promise<OllamaEmbedResponse>;
  /** Filled by extraction cycle 6.8 — POST /api/chat */
  chat(req: OllamaChatRequest): Promise<OllamaChatResponse>;
  /** Filled by extraction cycle 6.5 — GET /api/tags */
  listModels(): Promise<OllamaModel[]>;
  /** Filled by extraction cycle 6.5 — quick reachability probe */
  healthCheck(): Promise<{ ok: boolean; url: string; error?: string }>;
}

class OllamaClientImpl implements OllamaClient {
  // Reserved for the cycle-6.5 implementation; not exposed publicly.
  readonly baseUrl: string;
  constructor() {
    this.baseUrl = process.env.SCHOLAR_OLLAMA_URL ?? "http://127.0.0.1:11434";
  }
  async embed(_req: OllamaEmbedRequest): Promise<OllamaEmbedResponse> {
    throw new Error("ollama.embed unimplemented at the foundation layer; filled by extraction cycle 6.5");
  }
  async chat(_req: OllamaChatRequest): Promise<OllamaChatResponse> {
    throw new Error("ollama.chat unimplemented at the foundation layer; filled by extraction cycle 6.8");
  }
  async listModels(): Promise<OllamaModel[]> {
    throw new Error("ollama.listModels unimplemented at the foundation layer; filled by extraction cycle 6.5");
  }
  async healthCheck(): Promise<{ ok: boolean; url: string; error?: string }> {
    throw new Error("ollama.healthCheck unimplemented at the foundation layer; filled by extraction cycle 6.5");
  }
}

/** Process-singleton. One connection-pool + one health-check state across callers. */
export const ollama: OllamaClient = new OllamaClientImpl();

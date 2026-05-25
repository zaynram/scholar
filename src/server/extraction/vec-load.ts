// src/server/extraction/vec-load.ts — extraction cycle 6.5 (Green)
//
// Loads the sqlite-vec extension on a per-corpus connection and probes the
// Ollama embed model's vector dimension. Mirrors foundation §12.0's
// `loadVecAndProbeDim` semantics; foundation's primitive currently throws
// (typecheck stub awaiting implementation), so extraction ships its own
// helper here to unblock the §11 deferred-chunk_vec path without editing
// the foundation-owned primitives.ts.
//
// Once foundation lands the primitive body, this helper can be deleted and
// callers can switch to `import { loadVecAndProbeDim } from "../ingest/primitives"`.

import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { rawClient } from "../db/raw-client.ts";
import { resolveVec0Path } from "../db/sqlite-vec.ts";
import { embedOllama, DEFAULT_EMBED_MODEL } from "./ollama-http.ts";

export async function probeEmbedDimAndLoadVec(
  db: BunSQLiteDatabase,
  embedModel: string = DEFAULT_EMBED_MODEL,
): Promise<{ dim: number; modelTag: string }> {
  // 1. Load vec0 onto the bun:sqlite connection.
  try {
    rawClient(db).loadExtension(resolveVec0Path());
  } catch (err) {
    throw new Error(
      `sqlite-vec loadExtension failed at ${resolveVec0Path()}: ${(err as Error).message}`,
    );
  }
  // 2. Probe dim by running one tiny embed through Ollama.
  const vec = await embedOllama(embedModel, "scholar-vec-probe");
  return { dim: vec.length, modelTag: embedModel };
}

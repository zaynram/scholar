// src/server/ingest/primitives.ts — foundation cycle 6.1 (Task 1.5)
//
// The seven §12.0 primitives. Every untrusted-input boundary in the scholar
// codebase MUST route through one of these — bare string concatenation into
// prompts, paths, or HTTP requests is forbidden by the spec's §12.0 invariant.
//
// Foundation owns this file exclusively per lead ruling 2026-05-24; ingest may
// import type-only. Adding new primitives is a foundation-only edit.
import { lstatSync, realpathSync, statSync } from "node:fs";
import { resolve as resolvePath, sep as pathSep } from "node:path";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { rawClient } from "../db/raw-client.ts";
import { resolveVec0Path } from "../db/sqlite-vec.ts";
import { ollama, DEFAULT_EMBED_MODEL } from "../ollama/client.ts";

export class SanitizeError extends Error { override name = "SanitizeError"; }
export class PathEscapeError extends Error { override name = "PathEscapeError"; }
export class InvalidDoiError extends Error { override name = "InvalidDoiError"; }
export class InvalidArxivIdError extends Error { override name = "InvalidArxivIdError"; }
export class VecLoadError extends Error { override name = "VecLoadError"; }

/**
 * Text sanitization — applied to every persisted string from external sources.
 *
 * Behavioral contract (verbatim from §12.0):
 *   1. NFC normalize
 *   2. Reject U+202A–U+202E + U+2066–U+2069 (bidi overrides)
 *   3. Reject U+E0000–U+E007F (tag block)
 *   4. Reject U+E000–U+F8FF + U+F0000+ (PUA)
 *   5. Strip Cc/Cf/Co/Cn (except \n and \t)
 *   6. Length-cap to `opts.maxLen` when provided
 */
export function sanitizeText(input: string, opts?: { maxLen?: number }): string {
  let s = input.normalize("NFC");
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    // Reject bidi overrides
    if ((cp >= 0x202A && cp <= 0x202E) || (cp >= 0x2066 && cp <= 0x2069)) {
      throw new SanitizeError(`bidi override U+${cp.toString(16).toUpperCase()}`);
    }
    // Reject tag block
    if (cp >= 0xE0000 && cp <= 0xE007F) {
      throw new SanitizeError(`tag block U+${cp.toString(16).toUpperCase()}`);
    }
    // Reject private-use areas
    if ((cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000) {
      throw new SanitizeError(`PUA U+${cp.toString(16).toUpperCase()}`);
    }
  }
  // Strip Cc/Cf/Co/Cn except \n and \t (Unicode-property regex; /u flag required for \p{})
  s = s.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/gu, (m) => (m === "\n" || m === "\t" ? m : ""));
  if (opts?.maxLen != null && s.length > opts.maxLen) s = s.slice(0, opts.maxLen);
  return s;
}

/**
 * Untrusted-data envelope — wraps content for safe inclusion in LLM prompts.
 * Caller MUST generate a fresh nonce per request via
 * `crypto.randomBytes(8).toString("hex")` and include the matching
 * system-prompt clause describing the boundary.
 */
export function wrapUntrusted(payload: string, nonce: string): string {
  return `<untrusted_data id="${nonce}">${payload}</untrusted_data id="${nonce}">`;
}

/**
 * TOCTOU-safe path confinement.
 *   1. path.resolve(p)
 *   2. lstatSync (refuse symlink leaf)
 *   3. realpathSync(resolved) and realpathSync(root)
 *   4. assert resolved.startsWith(realRoot + sep) AND resolved !== realRoot
 *   5. assert statSync(resolved).isFile()
 * Throws PathEscapeError on any failure.
 */
export function resolveUnderRoot(p: string, root: string): string {
  const resolved = resolvePath(p);
  let leafStat;
  try {
    leafStat = lstatSync(resolved);
  } catch {
    throw new PathEscapeError(`does not exist: ${resolved}`);
  }
  if (leafStat.isSymbolicLink()) throw new PathEscapeError(`symlink leaf rejected: ${resolved}`);
  const real = realpathSync(resolved);
  // Audit M9: realpathSync(root) was unguarded, so a missing or unreadable
  // root leaked a raw ENOENT to callers that only catch PathEscapeError.
  let realRoot;
  try {
    realRoot = realpathSync(root);
  } catch {
    throw new PathEscapeError(`root unresolvable: ${root}`);
  }
  if (!real.startsWith(realRoot + pathSep) || real === realRoot) {
    throw new PathEscapeError(`escapes root ${realRoot}: ${real}`);
  }
  if (!statSync(real).isFile()) throw new PathEscapeError(`not a regular file: ${real}`);
  return real;
}

/**
 * DOI encoding — applied before interpolating into any HTTP path.
 * Asserts /^10\.\d{4,9}\/[ -~]+$/ then returns encodeURIComponent(doi).
 */
export function encodeDoi(doi: string): string {
  if (!/^10\.\d{4,9}\/[ -~]+$/.test(doi)) throw new InvalidDoiError(doi);
  return encodeURIComponent(doi);
}

/**
 * arXiv ID validation — anchored regex covering modern + legacy forms.
 * Returns canonicalized id with archive prefix lower-cased; preserves version.
 */
export function validateArxivId(id: string): string {
  const re = /^(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2,})?\/\d{7}(?:v\d+)?)$/i;
  if (!re.test(id)) throw new InvalidArxivIdError(id);
  const slash = id.indexOf("/");
  if (slash === -1) return id;
  // Legacy form: lowercase ONLY the archive prefix (the part before any sub-
  // category `.XX`); preserve the sub-category casing per arXiv convention
  // (e.g., `cs.LG`, `math.AG`).
  const prefix = id.slice(0, slash);
  const dot = prefix.indexOf(".");
  const archive = dot === -1 ? prefix.toLowerCase() : prefix.slice(0, dot).toLowerCase() + prefix.slice(dot);
  return archive + id.slice(slash);
}

/**
 * sqlite-vec load + dimension probe — called once per corpus at first open.
 * Loads the vec0 extension on the raw bun:sqlite connection, then runs one
 * tiny embed through Ollama to determine the embedding dimension.
 * Returns { dim: embedding.length, modelTag: embedModel }.
 *
 * Filled at chore foundation-fill-loadvecanddim-primitive-and-migrate-extraction
 * (2026-05-25). The ollamaUrl arg was dropped (was part of the original 3-arg stub
 * signature); callers now rely on the ollama singleton which reads SCHOLAR_OLLAMA_URL.
 */
export async function loadVecAndProbeDim(
  db: BunSQLiteDatabase,
  embedModel: string = DEFAULT_EMBED_MODEL,
): Promise<{ dim: number; modelTag: string }> {
  try {
    rawClient(db).loadExtension(resolveVec0Path());
  } catch (err) {
    throw new VecLoadError(
      `sqlite-vec loadExtension failed at ${resolveVec0Path()}: ${(err as Error).message}`,
    );
  }
  const vec = await ollama.embed(embedModel, "scholar-vec-probe");
  return { dim: vec.length, modelTag: embedModel };
}

/**
 * Retry-safe init memoization. Module-level `Map<string, Promise<T>>`. On
 * resolve, retain; subsequent calls with same key return the resolved promise.
 * On reject, clear the slot before re-throwing UNLESS `classify` returns
 * `"fatal"`, in which case the rejected promise is retained (no retry).
 * Process-local.
 */
const initOnceSlots = new Map<string, Promise<unknown>>();
export async function initOnce<T>(
  key: string,
  factory: () => Promise<T>,
  classify?: (err: unknown) => "retry" | "fatal",
): Promise<T> {
  const existing = initOnceSlots.get(key);
  if (existing) return existing as Promise<T>;
  const p = (async () => {
    try {
      return await factory();
    } catch (err) {
      const verdict = classify?.(err) ?? "retry";
      if (verdict === "retry") initOnceSlots.delete(key);
      throw err;
    }
  })();
  initOnceSlots.set(key, p as Promise<unknown>);
  return p;
}

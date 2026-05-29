// src/server/ingest/primitives.test.ts — foundation cycle 6.1 (Task 1.5)
//
// The seven §12.0 primitives. Foundation owns this file exclusively per lead
// ruling 2026-05-24 (ingest may import type-only; never edit). `loadVecAndProbeDim`
// requires Ollama and is exercised at extraction cycle 6.5 — foundation provides
// only a typecheck-stub that throws "unimplemented".
import { test, expect } from "bun:test";
import {
  sanitizeText, SanitizeError,
  wrapUntrusted,
  resolveUnderRoot, PathEscapeError,
  encodeDoi, InvalidDoiError,
  validateArxivId, InvalidArxivIdError,
  initOnce,
} from "./primitives.ts";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- sanitizeText ---
test("sanitizeText NFC-normalizes and strips disallowed Unicode categories", () => {
  // Combining-character form normalizes to NFC.
  const decomposed = "é";       // 'e' + combining acute
  expect(sanitizeText(decomposed)).toBe("é"); // 'é'
});

test("sanitizeText rejects U+202E bidi override", () => {
  expect(() => sanitizeText("hello‮world")).toThrow(SanitizeError);
});

test("sanitizeText rejects Unicode tag block U+E0000–U+E007F", () => {
  // \u{E0020} = SPACE TAG; 󠀠 in surrogate pair form.
  expect(() => sanitizeText("foo󠀠bar")).toThrow(SanitizeError);
});

test("sanitizeText caps length when maxLen supplied", () => {
  expect(sanitizeText("abcdef", { maxLen: 3 })).toBe("abc");
});

// --- wrapUntrusted ---
test("wrapUntrusted brackets payload with nonce-tagged delimiters", () => {
  const out = wrapUntrusted("hello", "deadbeef");
  expect(out).toBe(`<untrusted_data id="deadbeef">hello</untrusted_data id="deadbeef">`);
});

// --- resolveUnderRoot ---
test("resolveUnderRoot accepts a regular file under the root", () => {
  const root = mkdtempSync(join(tmpdir(), "scholar-rur-"));
  const file = join(root, "ok.txt");
  writeFileSync(file, "x");
  try {
    expect(resolveUnderRoot(file, root)).toBe(file);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveUnderRoot throws PathEscapeError on parent traversal", () => {
  const root = mkdtempSync(join(tmpdir(), "scholar-rur-"));
  try {
    expect(() => resolveUnderRoot(join(root, "..", "etc", "passwd"), root)).toThrow(PathEscapeError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveUnderRoot wraps a missing root in PathEscapeError (M9)", () => {
  // Audit M9: realpathSync(root) was unguarded, so a non-existent root path
  // leaked a raw ENOENT past callers that expect to catch only PathEscapeError
  // (the contract documented at the function header). Common trigger: backup
  // destination resolved before the corpus root directory has been created.
  // Construct a case the existing leaf-stat catch can't mask: real leaf,
  // missing root.
  const leafDir = mkdtempSync(join(tmpdir(), "scholar-rur-realleaf-"));
  const leaf = join(leafDir, "ok.txt");
  writeFileSync(leaf, "x");
  const missingRoot = join(tmpdir(), `scholar-rur-missing-${process.pid}-${Date.now()}`);
  try {
    expect(() => resolveUnderRoot(leaf, missingRoot)).toThrow(PathEscapeError);
  } finally {
    rmSync(leafDir, { recursive: true, force: true });
  }
});

test("resolveUnderRoot throws PathEscapeError on symlink leaf", () => {
  if (process.platform === "win32") return; // symlinks require admin on Windows
  const root = mkdtempSync(join(tmpdir(), "scholar-rur-"));
  const outside = mkdtempSync(join(tmpdir(), "scholar-rur-outside-"));
  writeFileSync(join(outside, "secret.txt"), "x");
  symlinkSync(join(outside, "secret.txt"), join(root, "link"));
  try {
    expect(() => resolveUnderRoot(join(root, "link"), root)).toThrow(PathEscapeError);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// --- encodeDoi ---
test("encodeDoi percent-encodes a valid DOI", () => {
  expect(encodeDoi("10.1145/3242897.3242916")).toBe("10.1145%2F3242897.3242916");
});

test("encodeDoi rejects malformed DOI", () => {
  expect(() => encodeDoi("not-a-doi")).toThrow(InvalidDoiError);
});

// --- validateArxivId ---
test("validateArxivId accepts modern form", () => {
  expect(validateArxivId("2403.12345")).toBe("2403.12345");
  expect(validateArxivId("2403.12345v2")).toBe("2403.12345v2");
});

test("validateArxivId accepts legacy form and lower-cases archive", () => {
  expect(validateArxivId("cs.LG/0405001")).toBe("cs.LG/0405001");
  expect(validateArxivId("MATH/9912345v3")).toBe("math/9912345v3");
});

test("validateArxivId rejects bogus id", () => {
  expect(() => validateArxivId("paper-123")).toThrow(InvalidArxivIdError);
});

// --- initOnce ---
test("initOnce memoizes resolved promises", async () => {
  let calls = 0;
  const f = () => {
    calls++;
    return Promise.resolve(42);
  };
  const a = await initOnce("k1", f);
  const b = await initOnce("k1", f);
  expect(a).toBe(42);
  expect(b).toBe(42);
  expect(calls).toBe(1);
});

test("initOnce clears the slot on reject so the next call retries", async () => {
  let attempt = 0;
  const f = () => {
    attempt++;
    return attempt === 1 ? Promise.reject(new Error("transient")) : Promise.resolve("ok");
  };
  await expect(initOnce("k2", f)).rejects.toThrow("transient");
  await expect(initOnce("k2", f)).resolves.toBe("ok");
  expect(attempt).toBe(2);
});

test("initOnce retains the rejected promise when classify returns 'fatal'", async () => {
  let attempt = 0;
  const f = () => {
    attempt++;
    return Promise.reject(new Error("schema-bad"));
  };
  const classify = (): "fatal" => "fatal";
  await expect(initOnce("k3", f, classify)).rejects.toThrow("schema-bad");
  await expect(initOnce("k3", f, classify)).rejects.toThrow("schema-bad");
  expect(attempt).toBe(1);
});

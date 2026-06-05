// src/ui/views/DigestPanel.tsx
// §9.3 — Synthesis + delta tab + Claude opt-in.
//
// Contract (extraction-003 lines 1485-1486, 1496, 1563-1566, 1572):
//   scholar.digest.generate args:
//     scope_key: string  (SA3 post-#6: "all" | "section:<label>"; selection is
//       tool-only — it needs paper_ids the panel doesn't carry; stale unimplemented)
//     use_claude?: boolean  (SA4: opt-in per request; DEFAULT FALSE per CLAUDE.md)
//   Result:
//     body_md: string  (renamed from digest_md per extraction-003 line 1496)
//     askClaude?: AskClaudePayload  (SA2 sentinel; UI forwards to host)
//
// Tool name (F4): scholar.digest.change-since-last-open (extraction-003 line 41).
// askClaude.reason field dropped (spec §11 only defines {prompt, data}).

import { useState } from "react";
import {
  callServerTool,
  isAskClaudeAvailable,
  askClaude,
  type AskClaudePayload,
} from "../lib/app.ts";

// SA3 enum — the scope_keys this panel can forward and have the server honor.
// Defect #6 (2026-06-05) scrub: the panel only ever forwards the scope_key it is
// opened with and carries NO selection-state, so it can't supply paper_ids — a
// `selection:` digest would fail closed (SELECTION_REQUIRES_IDS), and `stale` is
// unimplemented server-side (UNIMPLEMENTED_SCOPE). Both were removed from the
// advertised enum so a host-opened panel doesn't surface fail-closed noise for a
// scope the UI can never satisfy. Selection digests are driven directly through
// the scholar.digest.generate tool (scope_key:'selection' + paper_ids), not here.
export type ScopeKey = "all" | `section:${string}`;

export type DigestResult =
  | { type: "text"; body: string }
  | { type: "askClaude"; payload: AskClaudePayload };

export type DigestPanelProps = {
  scopeKey: ScopeKey;
  digest: DigestResult | null;
  onAction: (action: { type: string }) => void;
};

export function DigestPanel({
  scopeKey,
  digest: initDigest,
  onAction,
}: DigestPanelProps) {
  const [tab, setTab] = useState<"digest" | "delta">("digest");
  const [digest, setDigest] = useState<DigestResult | null>(initDigest);
  const [deltaDigest, setDeltaDigest] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [askClaudeAvailable] = useState(
    () => typeof window !== "undefined" && isAskClaudeAvailable(),
  );

  // SA4: use_claude defaults to false (CLAUDE.md: "cowork.askClaude is an
  // explicit per-request opt-in only — never the default path").
  async function generateDigest(useClaudeOpt = false) {
    setLoading(true);
    try {
      // SA3: args carry scope_key (not `since`). SA4: use_claude explicit default.
      const res = (await callServerTool("scholar.digest.generate", {
        scope_key: scopeKey,
        use_claude: useClaudeOpt,
      })) as Record<string, unknown>;

      // SA2: structuredContent.askClaude → forward to window.cowork.askClaude.
      if (res.askClaude && isAskClaudeAvailable()) {
        const claudeResult = await askClaude(res.askClaude as AskClaudePayload);
        const body =
          typeof claudeResult === "string"
            ? claudeResult
            : JSON.stringify(claudeResult);
        setDigest({ type: "text", body });
      } else if (res.askClaude) {
        setDigest({
          type: "askClaude",
          payload: res.askClaude as AskClaudePayload,
        });
      } else {
        setDigest({ type: "text", body: res.body_md as string });
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadDelta() {
    setLoading(true);
    try {
      // F4: tool name confirmed by extraction-003 line 41.
      const res = (await callServerTool(
        "scholar.digest.change-since-last-open",
        { scope_key: scopeKey },
      )) as { body_md: string };
      setDeltaDigest(res.body_md);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div data-view="digest" style={{ padding: "1rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          onClick={() => setTab("digest")}
          style={{ fontWeight: tab === "digest" ? "bold" : "normal" }}
        >
          Digest
        </button>
        <button
          onClick={() => {
            setTab("delta");
            loadDelta();
          }}
          style={{ fontWeight: tab === "delta" ? "bold" : "normal" }}
        >
          Changes since last open
        </button>
      </div>
      {tab === "digest" && (
        <div>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
            {/* SA4: "Generate (Ollama)" fires use_claude=false (default) */}
            <button onClick={() => generateDigest(false)}>Generate (Ollama)</button>
            {/* SA2: "Use Claude instead" — offered ONLY when host-capability present */}
            {askClaudeAvailable && (
              <button onClick={() => generateDigest(true)}>
                Use Claude instead
              </button>
            )}
            {/* SA2: when host absent, static note replaces toggle (no toggle offered) */}
            {!askClaudeAvailable && (
              <span
                style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}
              >
                Claude fallback unavailable in this host.
              </span>
            )}
          </div>
          {loading && <p>Generating…</p>}
          {digest?.type === "text" && (
            <p style={{ whiteSpace: "pre-wrap" }}>{digest.body}</p>
          )}
          {digest?.type === "askClaude" && (
            <p style={{ color: "var(--color-text-secondary)" }}>
              Digest requires Ollama (offline) or Claude host support (unavailable).
              Start Ollama or run <code>/scholar:digest --claude</code> in a Cowork
              host.
            </p>
          )}
        </div>
      )}
      {tab === "delta" && (
        <div>
          {loading && <p>Computing delta…</p>}
          {deltaDigest && (
            <p style={{ whiteSpace: "pre-wrap" }}>{deltaDigest}</p>
          )}
        </div>
      )}
    </div>
  );
}

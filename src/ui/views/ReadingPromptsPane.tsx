// src/ui/views/ReadingPromptsPane.tsx
// §9.4 — Per-paper or per-scope reading questions.
//
// Contract (extraction-003 lines 1750, 1817):
//   scholar.prompts.generate args: { paper_id: string; use_claude?: boolean }
//   Result: { prompts: string[] }  — flat string array (not nested objects)
//   DEFERRED to v1.1: intent, target_section args.
//
// SA4: use_claude defaults to false (CLAUDE.md mechanical-LLM-default invariant).
// SA2: host-capability detection identical to DigestPanel (toggle hidden when absent).

import { useState } from "react";
import {
  callServerTool,
  isAskClaudeAvailable,
  askClaude,
  type AskClaudePayload,
} from "../lib/app.ts";

export type ReadingPromptsPaneProps = {
  paperId?: string;
  prompts: string[];
  onAction: (action: { type: string }) => void;
};

export function ReadingPromptsPane({
  paperId,
  prompts: initPrompts,
  onAction,
}: ReadingPromptsPaneProps) {
  const [prompts, setPrompts] = useState<string[]>(initPrompts);
  const [loading, setLoading] = useState(false);
  const [askClaudeAvailable] = useState(
    () => typeof window !== "undefined" && isAskClaudeAvailable(),
  );

  // SA4: use_claude defaults to false; toggle sets it to true only when clicked.
  async function generate(useClaudeOpt = false) {
    setLoading(true);
    try {
      const res = (await callServerTool("scholar.prompts.generate", {
        paper_id: paperId,
        use_claude: useClaudeOpt,
      })) as Record<string, unknown>;

      // SA2: askClaude sentinel forwarding.
      if (res.askClaude && isAskClaudeAvailable()) {
        const claudeResult = await askClaude(res.askClaude as AskClaudePayload);
        const body =
          typeof claudeResult === "string"
            ? claudeResult
            : JSON.stringify(claudeResult);
        setPrompts([body]);
      } else if (res.askClaude) {
        setPrompts([
          "Prompts require Ollama (offline) or a Cowork host with Claude support.",
        ]);
      } else {
        setPrompts((res.prompts as string[]) ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div data-view="prompts" style={{ padding: "1rem" }}>
      <h3>{paperId ? "Reading prompts for paper" : "Scope reading prompts"}</h3>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {/* SA4: "Generate (Ollama)" fires use_claude=false (default) */}
        <button onClick={() => generate(false)}>
          {prompts.length ? "Regenerate" : "Generate"}
        </button>
        {/* SA2: "Use Claude instead" — only when host-capability present */}
        {askClaudeAvailable && (
          <button onClick={() => generate(true)}>Use Claude instead</button>
        )}
        {/* SA2: static note when host absent */}
        {!askClaudeAvailable && (
          <span
            style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}
          >
            Claude fallback unavailable in this host.
          </span>
        )}
      </div>
      {loading && <p>Generating…</p>}
      <ol style={{ paddingLeft: "1.25rem" }}>
        {prompts.map((q, i) => (
          <li key={i} style={{ marginBottom: "0.5rem" }}>
            {q}
          </li>
        ))}
      </ol>
    </div>
  );
}

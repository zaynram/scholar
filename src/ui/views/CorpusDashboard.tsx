// src/ui/views/CorpusDashboard.tsx
// §9.1 — Corpus dashboard: scope picker, status filter, semantic search, paper cards.
// On mount: calls scholar.papers.search to populate list even when corpusId absent.
//
// Contract (extraction-003 lines 1167-1169, 1237):
//   SearchArgs: { q: string; limit?: number }  — corpus_id and mode DROPPED
//   SearchResult: { hits: SearchHit[]; still_indexing: boolean }
//   SearchHit: { id; key; title; score; lex_rank?; vec_rank? }
//
// SearchHit does NOT include authors/year/status/depth/section/role/annotationCount.
// Rich PaperRow fields come from a separate papers.get path (not consumed in v1).

import { useState, useEffect } from "react";
import { callServerTool, sendMessage } from "../lib/app.ts";

export type PaperStatus = "pending" | "reading" | "reviewed" | "skip";
export type PaperDepth = "skim" | "normal" | "deep";
export type PaperRow = {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  status: PaperStatus;
  depth: PaperDepth;
  section: string | null;
  role: string | null;
  annotationCount: number;
};
export type SearchHit = {
  id: string;
  key: string;
  title: string;
  score: number;
  lex_rank?: number;
  vec_rank?: number;
};
export type CorpusDashboardProps = {
  corpusId?: string;
  papers: PaperRow[];
  onAction: (action: { type: string; paperId?: string }) => void;
};

type Scope = "all" | "queue" | "section" | "selection";
type StatusFilter = PaperStatus | "all";

export function CorpusDashboard({ corpusId, papers, onAction }: CorpusDashboardProps) {
  const [scope, setScope] = useState<Scope>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  // SA1 — still_indexing pill state (spec §11 line 1007).
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [stillIndexing, setStillIndexing] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // args: { q, limit? } — corpus_id DROPPED (per-corpus ctx.db snapshot)
    callServerTool("scholar.papers.search", { q: "", limit: 50 })
      .then((res) => {
        const r = res as { hits?: SearchHit[]; still_indexing?: boolean };
        setHits(r.hits ?? []);
        setStillIndexing(r.still_indexing ?? false);
      })
      .catch(() => {});
  }, [corpusId]);

  async function handleSearch(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setHits([]);
      setStillIndexing(false);
      return;
    }
    setLoading(true);
    try {
      const res = (await callServerTool("scholar.papers.search", {
        q,
        limit: 50,
      })) as { hits?: SearchHit[]; still_indexing?: boolean };
      setHits(res.hits ?? []);
      setStillIndexing(res.still_indexing ?? false);
    } finally {
      setLoading(false);
    }
  }

  const filteredPapers = papers.filter(
    (p) => statusFilter === "all" || p.status === statusFilter,
  );

  return (
    <div data-view="dashboard" style={{ padding: "1rem" }}>
      <header style={{ marginBottom: "1rem" }}>
        {corpusId && (
          <span style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
            Corpus: {corpusId}
          </span>
        )}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          {(["all", "queue", "section", "selection"] as Scope[]).map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{ fontWeight: scope === s ? "bold" : "normal" }}
            >
              {s}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          {(["all", "pending", "reading", "reviewed", "skip"] as StatusFilter[]).map(
            (f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                style={{ fontWeight: statusFilter === f ? "bold" : "normal" }}
              >
                {f}
              </button>
            ),
          )}
        </div>
        <input
          type="search"
          placeholder="Search papers…"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          style={{ width: "100%", marginTop: "0.5rem", padding: "0.5rem" }}
        />
        {/* SA1: "still indexing" pill — spec §11 line 1007:
            "Semantic-search code paths (scholar.papers.search with semantic
             mode) check settings.chunk_vec.created and degrade to lexical with
             a 'still indexing' pill when false — the same affordance used for
             partially-embedded chunks." */}
        {stillIndexing && (
          <span
            data-badge="still-indexing"
            style={{
              fontSize: "0.7rem",
              color: "var(--color-text-secondary)",
              marginTop: "0.25rem",
              display: "inline-block",
            }}
          >
            still indexing
          </span>
        )}
      </header>
      {loading && (
        <p style={{ color: "var(--color-text-secondary)" }}>Searching…</p>
      )}
      {hits.length > 0 && (
        <ul style={{ listStyle: "none" }}>
          {hits.map((h) => (
            <li
              key={h.id}
              style={{
                borderBottom: "1px solid var(--color-background-secondary)",
                padding: "0.75rem 0",
              }}
            >
              <strong>{h.title}</strong>
              <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() =>
                    callServerTool("scholar.paper.show", { paper_id: h.id })
                  }
                >
                  Open
                </button>
                <button onClick={() => sendMessage(`scholar: ${h.title}`)}>
                  Send to chat
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {hits.length === 0 && (
        <ul style={{ listStyle: "none" }}>
          {filteredPapers.map((p) => (
            <li
              key={p.id}
              style={{
                borderBottom: "1px solid var(--color-background-secondary)",
                padding: "0.75rem 0",
              }}
            >
              <strong>{p.title}</strong>
              <span
                style={{ marginLeft: "0.5rem", color: "var(--color-text-secondary)" }}
              >
                {p.authors.join(", ")} {p.year ? `(${p.year})` : ""}
              </span>
              <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.5rem" }}>
                <span data-badge="status">{p.status}</span>
                <span data-badge="depth">{p.depth}</span>
                {p.annotationCount > 0 && (
                  <span data-badge="annotations">
                    {p.annotationCount} annotations
                  </span>
                )}
                <button
                  onClick={() =>
                    callServerTool("scholar.paper.show", { paper_id: p.id })
                  }
                >
                  Open
                </button>
                <button onClick={() => sendMessage(`scholar: ${p.title}`)}>
                  Send to chat
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

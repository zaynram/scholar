// src/ui/views/PaperDetail.tsx
// §9.2 — pdfjs-dist canvas + annotations.
//
// PDF source (F2 resolved — chore 9d78da3 + Task 8b): scholar.pdf.open returns
// {success, viewUUID}, NOT a URL. The iframe-PDF URL rides MCP resources/read
// with URI scheme ui://scholar/pdf/<paper_id>. PaperDetail calls readResource,
// decodes the base64 blob, creates an object URL for pdfjs.
//
// The "Open in pdf-viewer plugin" button calls scholar.pdf.open with
// external:true to launch the external viewer (thin-proxy semantics retained).

import { useState, useEffect, useRef } from "react";
import {
  callServerTool,
  readResource,
  isAskClaudeAvailable,
} from "../lib/app.ts";

export type Annotation = {
  id: string;
  page?: number;
  anchor?: string;
  body: string;
  created_at: string;
  updated_at: string;
  source: "scholar" | "pdf-viewer";
};

export type PaperDetailProps = {
  paperId: string;
  title: string;
  annotations: Annotation[];
  onAction: (action: { type: string }) => void;
};

export function PaperDetail({
  paperId,
  title,
  annotations: initAnnotations,
  onAction,
}: PaperDetailProps) {
  const [annotations, setAnnotations] = useState<Annotation[]>(initAnnotations);
  const [newBody, setNewBody] = useState("");
  // pdfUrl is a Blob object URL created from the base64 blob returned by
  // resources/read. Revoked on component unmount to avoid memory leaks.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [askClaudeAvailable] = useState(
    () => typeof window !== "undefined" && isAskClaudeAvailable(),
  );

  useEffect(() => {
    if (!paperId || typeof window === "undefined") return;
    // F2 resolved: fetch PDF bytes via MCP resources/read, not scholar.pdf.open.
    let objectUrl: string | null = null;
    readResource(`ui://scholar/pdf/${paperId}`)
      .then((res) => {
        const content = res.contents[0];
        if (content?.blob) {
          const bytes = Uint8Array.from(atob(content.blob), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: "application/pdf" });
          objectUrl = URL.createObjectURL(blob);
          setPdfUrl(objectUrl);
        }
      })
      .catch(() => {});
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [paperId]);

  useEffect(() => {
    if (!pdfUrl || !canvasRef.current || typeof window === "undefined") return;
    let cancelled = false;
    const canvas = canvasRef.current;
    (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).href;
      const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
      if (cancelled) return;
      setNumPages(pdf.numPages);
      const page = await pdf.getPage(currentPage);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 1.5 });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, currentPage]);

  async function upsertAnnotation() {
    if (!newBody.trim()) return;
    const res = (await callServerTool("scholar.annotations.upsert", {
      paper_id: paperId,
      body: newBody,
    })) as { annotation: Annotation };
    setAnnotations((prev) => [...prev, res.annotation]);
    setNewBody("");
  }

  async function deleteAnnotation(id: string) {
    await callServerTool("scholar.annotations.delete", { id });
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div
      data-view="paper"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        height: "100vh",
      }}
    >
      <div
        style={{
          borderRight: "1px solid var(--color-background-secondary)",
          overflow: "auto",
        }}
      >
        {pdfUrl ? (
          <>
            <canvas ref={canvasRef} style={{ display: "block", width: "100%" }} />
            {numPages > 1 && (
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  padding: "0.5rem",
                  justifyContent: "center",
                }}
              >
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  ←
                </button>
                <span>
                  {currentPage} / {numPages}
                </span>
                <button
                  onClick={() =>
                    setCurrentPage((p) => Math.min(numPages, p + 1))
                  }
                  disabled={currentPage === numPages}
                >
                  →
                </button>
              </div>
            )}
            {/* scholar.pdf.open with external:true launches the external pdf viewer
                (thin proxy, returns {success, viewUUID}) */}
            <button
              onClick={() =>
                callServerTool("scholar.pdf.open", {
                  paper_id: paperId,
                  external: true,
                })
              }
              style={{ display: "block", margin: "0.5rem auto" }}
            >
              Open in pdf-viewer plugin
            </button>
          </>
        ) : (
          <div
            style={{
              padding: "1rem",
              color: "var(--color-text-secondary)",
            }}
          >
            {paperId ? "Loading PDF…" : "No PDF available"}
          </div>
        )}
      </div>
      <div style={{ overflow: "auto", padding: "1rem" }}>
        <h2>{title}</h2>
        {!askClaudeAvailable && (
          <p style={{ fontSize: "0.75rem", color: "var(--color-text-secondary)" }}>
            Claude fallback unavailable in this host.
          </p>
        )}
        <section>
          <h3>Annotations</h3>
          <ul style={{ listStyle: "none" }}>
            {annotations.map((a) => (
              <li key={a.id} style={{ marginBottom: "0.5rem" }}>
                <p>{a.body}</p>
                <small style={{ color: "var(--color-text-secondary)" }}>
                  {a.source} · {new Date(a.updated_at).toLocaleDateString()}
                </small>
                <button onClick={() => deleteAnnotation(a.id)}>Delete</button>
              </li>
            ))}
          </ul>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <input
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="Add annotation…"
              style={{ flex: 1, padding: "0.5rem" }}
            />
            <button onClick={upsertAnnotation}>Add</button>
          </div>
        </section>
      </div>
    </div>
  );
}

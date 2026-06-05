// src/ui/App.tsx
// React root. Dispatches on the `view` field emitted by view-opener tools
// (scholar.{dashboard,paper.show,digest.show,prompts.show,progress.show}).
//
// The view discriminant arrives on the ext-apps `App`'s `toolresult`
// notification (the view rides each opener's tool RESULT structuredContent),
// wired via lib/app.ts's initApp — which registers handlers BEFORE connect()
// because toolresult is a one-shot event (§9 conformance amendment 2026-06-04).

import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  type ViewInput,
  type HostContext,
  initApp,
} from "./lib/app.ts";
import { CorpusDashboard } from "./views/CorpusDashboard.tsx";
import { PaperDetail } from "./views/PaperDetail.tsx";
import { DigestPanel } from "./views/DigestPanel.tsx";
import { ReadingPromptsPane } from "./views/ReadingPromptsPane.tsx";
import { ReaderProgress } from "./views/ReaderProgress.tsx";

function App() {
  const [view, setView] = useState<ViewInput>({ view: "dashboard" });
  const [hostCtx, setHostCtx] = useState<HostContext>({});

  useEffect(() => {
    // initApp registers the toolresult/hostcontextchanged handlers BEFORE it
    // connects (one-shot delivery) and returns a cleanup that detaches them.
    return initApp({ onView: setView, onHostContext: setHostCtx });
  }, []);

  useEffect(() => {
    if (!hostCtx.cssVars) return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(hostCtx.cssVars)) {
      root.style.setProperty(k, v);
    }
  }, [hostCtx.cssVars]);

  switch (view.view) {
    case "dashboard":
      return (
        <CorpusDashboard corpusId={view.corpus_id} papers={[]} onAction={() => {}} />
      );
    case "paper":
      return (
        <PaperDetail
          paperId={view.paper_id}
          title=""
          annotations={[]}
          onAction={() => {}}
        />
      );
    case "digest":
      return (
        <DigestPanel
          scopeKey={view.scope_key as import("./views/DigestPanel.tsx").ScopeKey}
          digest={null}
          onAction={() => {}}
        />
      );
    case "prompts":
      return (
        <ReadingPromptsPane
          paperId={view.paper_id}
          prompts={[]}
          onAction={() => {}}
        />
      );
    case "progress":
      return <ReaderProgress stats={{ bySection: [], statusMix: [] }} />;
  }
}

// Mount guard — prevents crash when App.tsx is imported by SSR or unit tests.
if (typeof document !== "undefined") {
  const container = document.getElementById("root");
  if (container) createRoot(container).render(<App />);
}

export { App };

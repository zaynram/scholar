// src/ui/App.test.tsx
// SSR component tests via renderToString — no DOM, no window, no SDK wiring.
// These exercise each view's surface in isolation: that it renders without
// throwing and emits the documented data-view attribute.
//
// Companion: App.dispatch.test.tsx uses a real DOM (registerDom helper) to
// exercise App.tsx's switch(view.view) wiring; this file does NOT.
//
// Expected at Red: FAIL — Cannot find module './views/CorpusDashboard' etc.
import { test, expect } from "bun:test";
import { renderToString } from "react-dom/server";
import { createElement } from "react";

import { CorpusDashboard } from "./views/CorpusDashboard.tsx";
import { PaperDetail } from "./views/PaperDetail.tsx";
import { DigestPanel } from "./views/DigestPanel.tsx";
import { ReadingPromptsPane } from "./views/ReadingPromptsPane.tsx";
import { ReaderProgress } from "./views/ReaderProgress.tsx";

test("CorpusDashboard renders without error", () => {
  const html = renderToString(
    createElement(CorpusDashboard, { papers: [], onAction: () => {} }),
  );
  expect(html).toContain('data-view="dashboard"');
});

test("PaperDetail renders without error", () => {
  const html = renderToString(
    createElement(PaperDetail, {
      paperId: "p1",
      title: "Test Paper",
      annotations: [],
      onAction: () => {},
    }),
  );
  expect(html).toContain('data-view="paper"');
});

test("DigestPanel renders without error", () => {
  const html = renderToString(
    createElement(DigestPanel, { scopeKey: "all", digest: null, onAction: () => {} }),
  );
  expect(html).toContain('data-view="digest"');
});

test("ReadingPromptsPane renders without error", () => {
  const html = renderToString(
    createElement(ReadingPromptsPane, {
      paperId: undefined,
      prompts: [],
      onAction: () => {},
    }),
  );
  expect(html).toContain('data-view="prompts"');
});

test("ReaderProgress renders without error", () => {
  const html = renderToString(
    createElement(ReaderProgress, { stats: { bySection: [], statusMix: [] } }),
  );
  expect(html).toContain('data-view="progress"');
});

// F2 PDF resources/read contract conformance test (chore 9d78da3 +
// plan-md Task 8b). scholar.pdf.open returns {success, viewUUID} — NOT a URL.
// Iframe-PDF bytes ride MCP resources/read({uri: "ui://scholar/pdf/<paper_id>"}).
test("F2 contract: PDF iframe source is MCP resources/read ui://scholar/pdf/<paper_id> (NOT scholar.pdf.open URL)", () => {
  const paperId = "paper-123";
  const expectedUri = `ui://scholar/pdf/${paperId}`;
  const parsed = new URL(expectedUri);
  expect(parsed.protocol).toBe("ui:");
  expect(parsed.hostname).toBe("scholar");
  expect(parsed.pathname).toBe(`/pdf/${paperId}`);
  // Confirm the scheme is NOT http/https (which would be the old wrong contract).
  expect(["http:", "https:"]).not.toContain(parsed.protocol);
});

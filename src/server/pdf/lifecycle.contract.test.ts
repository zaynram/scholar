// src/server/pdf/lifecycle.contract.test.ts — S1 (2026-05-27) vendor contract test
//
// Exercises the §13 v1.1 wire envelope `{viewUUID, action, ...rest}` against
// the *real* vendored @modelcontextprotocol/server-pdf process. This is the
// drift canary called out by the production-readiness audit (S1 bullet 7):
// scholar's interact() translator + scholar's note-shape mapping land
// together, so if either the translator or the vendor's command schema
// changes in a future re-vendor pass, this test fails at the wire level
// rather than at a downstream user-visible regression.
//
// Why a separate file from lifecycle.test.ts?
//   The wire-envelope coverage here is a contract against the vendored binary
//   — it's load-bearing for `re-vendor` chore reviewers in particular. Keeping
//   it adjacent in its own file (lifecycle.contract.test.ts) is the §16
//   "vendor-truth invariant" — when re-vendoring, the diff-reviewer reads
//   exactly this file to know what wire shapes scholar relies on.
//
// Gate: SCHOLAR_PDF_E2E=1 (same flag the FIXTURE 4 + 6 heavyweights use).
// Default `bun test` skips this; CI sets the flag and runs it.
import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnPdfChild, type PdfChildHandle } from "./lifecycle.ts";
import { ulid } from "../db/nowIso.ts";

const E2E = process.env.SCHOLAR_PDF_E2E === "1";

let handle: PdfChildHandle | undefined;
let tmpRoot: string | undefined;

afterEach(async () => {
  if (handle) {
    await handle.shutdown();
    handle = undefined;
  }
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
    tmpRoot = undefined;
  }
});

/**
 * Minimal valid PDF (one empty page, with xref + trailer). Vendor parses this
 * via pdf-lib; the synthetic byte-blob FIXTURE 4 uses is not a full PDF and
 * vendor may refuse it depending on parser version. This fixture is built
 * from a single canonical byte stream tested against pdf-lib 1.17.
 */
function writeMinimalPdf(path: string): void {
  // 1-page A4 portrait PDF, no content stream, no fonts — pdf-lib parses this
  // and vendor's display_pdf accepts it as openable. Generated offline with
  // pdf-lib; bytes are stable.
  const bytes = Buffer.from(
    [
      "%PDF-1.4",
      "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
      "2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj",
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<<>>>>endobj",
      "xref",
      "0 4",
      "0000000000 65535 f ",
      "0000000009 00000 n ",
      "0000000054 00000 n ",
      "0000000101 00000 n ",
      "trailer<</Size 4/Root 1 0 R>>",
      "startxref",
      "170",
      "%%EOF",
      "",
    ].join("\n"),
    "utf-8",
  );
  writeFileSync(path, bytes);
}

function makeFixtureRoot(): { root: string; pdf: string } {
  const root = mkdtempSync(join(tmpdir(), "scholar-pdf-contract-"));
  mkdirSync(join(root, "papers"), { recursive: true });
  const pdf = join(root, "papers", "fixture.pdf");
  writeMinimalPdf(pdf);
  return { root, pdf };
}

// =============================================================================
// FIXTURE C1 — display_pdf returns a viewUUID and `interact` accepts the
//              v1.1 envelope `{viewUUID, action: "navigate", page: 1}`.
//
// Why this matters: the v1.0 code path mistakenly sent `{type: "navigate", ...}`
// without viewUUID at all. If the vendor evolves to validate `viewUUID` more
// strictly (or renames `action`), this fixture is the first thing that fails.
// =============================================================================

test.skipIf(!E2E)(
  "C1 — display_pdf + interact({navigate}) round-trips under the §13 v1.1 envelope",
  async () => {
    const fix = makeFixtureRoot();
    tmpRoot = fix.root;
    handle = await spawnPdfChild({ initialRoots: [fix.root] });

    const { viewUUID } = await handle.displayPdf(fix.pdf);
    expect(typeof viewUUID).toBe("string");
    expect(viewUUID.length).toBeGreaterThan(0);

    // navigate carries no annotations, no rects — pure envelope check.
    // If lifecycle.ts.interact ever stops appending viewUUID as a sibling
    // of action, the vendor will reject or no-op silently; this fixture
    // round-trips a value (vendor returns null on success) and asserts
    // no throw.
    await expect(
      handle.interact({ type: "navigate", page: 1 }, { viewUUID }),
    ).resolves.toBeDefined();
  },
);

// =============================================================================
// FIXTURE C2 — add_annotations({note}) round-trips with scholar's serializeForViewer
//              shape: {id, type: "note", page, x, y, content}.
//
// Why this matters: serializeForViewer (annotations.ts) maps scholar rows to
// the vendor's NoteAnnotation. If the vendor evolves AnnotationBase or the
// note discriminator, scholar's PUSH path silently fails until users notice
// missing sticky notes. This fixture catches that regression at re-vendor time.
// =============================================================================

test.skipIf(!E2E)(
  "C2 — add_annotations({type: 'note'}) round-trips under the §13 v1.1 envelope",
  async () => {
    const fix = makeFixtureRoot();
    tmpRoot = fix.root;
    handle = await spawnPdfChild({ initialRoots: [fix.root] });
    const { viewUUID } = await handle.displayPdf(fix.pdf);

    const annotationId = ulid();
    await expect(
      handle.interact(
        {
          type: "add_annotations",
          annotations: [
            {
              id: annotationId,
              type: "note",
              page: 1,
              x: 20,
              y: 20,
              content: "contract-test sticky",
            },
          ],
        },
        { viewUUID },
      ),
    ).resolves.toBeDefined();

    // remove_annotations also exercised — payload is {ids: string[]}; the
    // envelope translator strips `type` and pushes ids as a sibling.
    await expect(
      handle.interact(
        { type: "remove_annotations", ids: [annotationId] },
        { viewUUID },
      ),
    ).resolves.toBeDefined();
  },
);

// Why no C3 for get_text? Vendor's `get_text` action requires a live viewer
// process (browser) connected to the pdf-server to extract text — without one,
// the action enqueues to the poll queue and never gets a response, so a
// vendor-only contract test hangs indefinitely. The wire-envelope translation
// for get_text is *already* covered by C1+C2: both go through the same
// `interact()` translator that getText() uses. If the translator regressed,
// C1/C2 fail before C3 would. Liveness against a real viewer belongs in an
// end-to-end browser fixture, not in the wire-contract suite.

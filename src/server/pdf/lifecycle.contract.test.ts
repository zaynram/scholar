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
import { rmSync } from "node:fs";
import { spawnPdfChild, type PdfChildHandle } from "./lifecycle.ts";
import { ulid } from "../db/nowIso.ts";
import { makeFixtureRoot } from "%/util/pdf-fixture";

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

// The valid-minimal-PDF fixture (writeMinimalPdf / makeFixtureRoot) lives in
// tests/util/pdf-fixture.ts — shared with lifecycle.test.ts FIXTURE 4, which
// likewise needs a vendor-openable document for its display_pdf round-trip.

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

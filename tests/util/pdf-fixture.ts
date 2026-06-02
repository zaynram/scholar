import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Minimal valid PDF (one empty A4 page, with xref + trailer). The vendored
 * @modelcontextprotocol/server-pdf parses this via pdf-lib and `display_pdf`
 * accepts it as openable. Generated offline with pdf-lib 1.17; bytes are stable.
 *
 * Distinct from the synthetic `%PDF-1.4`-magic blob used by the spawn-only
 * fixtures (1–3) in lifecycle.test.ts: those never open the file, so a header
 * stub suffices. Any fixture that calls `display_pdf` needs THIS valid document
 * — the vendor refuses the synthetic blob.
 */
export function writeMinimalPdf(path: string): void {
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
  )
  writeFileSync(path, bytes)
}

/**
 * Temp PDF root containing `papers/fixture.pdf` (a valid minimal PDF). Returns
 * both the root (pass as an initial root to spawnPdfChild) and the pdf path
 * (pass to handle.displayPdf). Caller owns cleanup of `root`.
 */
export function makeFixtureRoot(): { root: string; pdf: string } {
  const root = mkdtempSync(join(tmpdir(), "scholar-pdf-fixture-"))
  mkdirSync(join(root, "papers"), { recursive: true })
  const pdf = join(root, "papers", "fixture.pdf")
  writeMinimalPdf(pdf)
  return { root, pdf }
}

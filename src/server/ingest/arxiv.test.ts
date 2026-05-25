// src/server/ingest/arxiv.test.ts — cycle 6.4 Task 3 RED
import { expect, test, describe, mock } from "bun:test";
import { fetchArxiv, downloadArxivPdf } from "./arxiv.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <title>Attention Is All You Need (Test)</title>
    <summary>A seminal paper on transformers.</summary>
    <published>2024-01-01T00:00:00Z</published>
    <author><name>Vaswani, Ashish</name></author>
    <author><name>Shazeer, Noam</name></author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1000/attention</arxiv:doi>
  </entry>
</feed>`;

// F10: entity-encoded bidi override — HTML entity must be decoded before sanitizeText
const ENTITY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00002v1</id>
    <title>Bad &#x202E; Title</title>
    <summary>Abstract.</summary>
    <published>2024-01-01T00:00:00Z</published>
    <author><name>Attacker</name></author>
  </entry>
</feed>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"></feed>`;

const FAKE_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF magic

describe("fetchArxiv", () => {
  test("parses a valid modern arXiv ID", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response(ATOM_FEED, { status: 200 })),
    );
    const entry = await fetchArxiv("2401.00001", { fetch: mockFetch as unknown as typeof fetch });
    expect(entry.arxivId).toBe("2401.00001");
    expect(entry.title).toBe("Attention Is All You Need (Test)");
    expect(entry.abstract).toBe("A seminal paper on transformers.");
    expect(entry.year).toBe(2024);
    expect(entry.authors).toBe("Vaswani, Ashish; Shazeer, Noam");
    expect(entry.importedVia).toBe("arxiv");
  });

  test("accepts full arXiv URL", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response(ATOM_FEED, { status: 200 })),
    );
    const entry = await fetchArxiv("https://arxiv.org/abs/2401.00001", {
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(entry.arxivId).toBe("2401.00001");
  });

  test("throws for garbage ID", async () => {
    await expect(fetchArxiv("not-an-id", {})).rejects.toThrow();
  });

  test("accepts legacy archive/YYMMNNN form", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response(ATOM_FEED, { status: 200 })),
    );
    await expect(
      fetchArxiv("cs.AI/0001001", { fetch: mockFetch as unknown as typeof fetch }),
    ).resolves.toBeDefined();
  });

  test("throws on empty feed", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response(EMPTY_FEED, { status: 200 })),
    );
    await expect(
      fetchArxiv("2401.00001", { fetch: mockFetch as unknown as typeof fetch }),
    ).rejects.toThrow();
  });

  test("URL uses TLS (https://export.arxiv.org)", async () => {
    let capturedUrl = "";
    const mockFetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(ATOM_FEED, { status: 200 }));
    });
    await fetchArxiv("2401.00001", { fetch: mockFetch as unknown as typeof fetch });
    expect(capturedUrl).toMatch(/^https:\/\/export\.arxiv\.org/);
  });

  test("HTML entity-encoded bidi override is rejected by sanitizeText (F10)", async () => {
    // decodeHtmlEntities converts &#x202E; → U+202E before sanitizeText sees it.
    // sanitizeText then rejects U+202E (bidi-override category).
    const mockFetch = mock(() =>
      Promise.resolve(new Response(ENTITY_FEED, { status: 200 })),
    );
    await expect(
      fetchArxiv("2401.00002", { fetch: mockFetch as unknown as typeof fetch }),
    ).rejects.toThrow(); // SanitizeError — bidi override detected
  });
});

// F14: downloadArxivPdf test coverage
describe("downloadArxivPdf", () => {
  test("writes PDF bytes to <pdfRoot>/arxiv/<id>.pdf and returns the path", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scholar-test-"));
    try {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(FAKE_PDF, { status: 200, headers: { "content-type": "application/pdf" } }),
        ),
      );
      const result = await downloadArxivPdf("2401.00001", {
        pdfRoot: tmpRoot,
        fetch: mockFetch as unknown as typeof fetch,
      });
      expect(result).toBe(path.join(tmpRoot, "arxiv", "2401.00001.pdf"));
      expect(fs.existsSync(result)).toBe(true);
      expect(fs.readFileSync(result)[0]).toBe(0x25); // %PDF magic
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("throws on non-200 PDF response", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scholar-test-"));
    try {
      const mockFetch = mock(() =>
        Promise.resolve(new Response("Forbidden", { status: 403 })),
      );
      await expect(
        downloadArxivPdf("2401.00001", {
          pdfRoot: tmpRoot,
          fetch: mockFetch as unknown as typeof fetch,
        }),
      ).rejects.toThrow();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("download to non-existent destination succeeds (F2 resolveUnderRoot dir pattern)", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scholar-test-"));
    try {
      const mockFetch = mock(() =>
        Promise.resolve(new Response(FAKE_PDF, { status: 200 })),
      );
      // arxiv/ subdir does not exist yet — mkdir -p creates it
      await expect(
        downloadArxivPdf("2401.00001", {
          pdfRoot: tmpRoot,
          fetch: mockFetch as unknown as typeof fetch,
        }),
      ).resolves.toBeDefined();
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

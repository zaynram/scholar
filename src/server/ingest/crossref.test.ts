// src/server/ingest/crossref.test.ts — cycle 6.4 Task 2 RED
import { expect, test, describe, mock } from "bun:test";
import { fetchCrossref } from "./crossref.ts";

const MOCK_CROSSREF = {
  status: "ok",
  message: {
    title: ["Test Article"],
    author: [{ family: "Smith", given: "John" }, { family: "Doe", given: "Jane" }],
    published: { "date-parts": [[2022]] },
    "container-title": ["Journal of Testing"],
    abstract: "<jats:p>An abstract.</jats:p>",
    DOI: "10.1000/xyz123",
    reference: [{ DOI: "10.9999/cited" }],
  },
};

describe("fetchCrossref", () => {
  test("parses a valid DOI response", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(MOCK_CROSSREF), { status: 200 })),
    );
    const entry = await fetchCrossref("10.1000/xyz123", {
      mailto: "test@example.com",
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(entry.title).toBe("Test Article");
    expect(entry.doi).toBe("10.1000/xyz123");
    expect(entry.year).toBe(2022);
    expect(entry.authors).toBe("Smith, John; Doe, Jane");
    expect(entry.importedVia).toBe("crossref");
    expect(entry.references).toEqual([{ DOI: "10.9999/cited" }]);
  });

  test("throws InvalidDoiError for malformed DOI", async () => {
    await expect(fetchCrossref("not-a-doi", { mailto: "t@t.com" })).rejects.toThrow();
  });

  test("URL contains encodeDoi-escaped DOI and mailto", async () => {
    let capturedUrl = "";
    const mockFetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify(MOCK_CROSSREF), { status: 200 }));
    });
    await fetchCrossref("10.1000/xyz123", {
      mailto: "test@example.com",
      fetch: mockFetch as unknown as typeof fetch,
    });
    expect(capturedUrl).toContain("10.1000%2Fxyz123");
    expect(capturedUrl).toContain("mailto=test%40example.com");
  });

  test("omitting mailto omits ?mailto= from URL (no fake-email stub)", async () => {
    let capturedUrl = "";
    const mockFetch = mock((url: string) => {
      capturedUrl = url;
      return Promise.resolve(new Response(JSON.stringify(MOCK_CROSSREF), { status: 200 }));
    });
    await fetchCrossref("10.1000/xyz123", { fetch: mockFetch as unknown as typeof fetch }); // no mailto
    expect(capturedUrl).not.toContain("mailto");
  });

  test("throws on non-200 response", async () => {
    const mockFetch = mock(() => Promise.resolve(new Response("Not Found", { status: 404 })));
    await expect(
      fetchCrossref("10.1000/xyz123", {
        mailto: "t@t.com",
        fetch: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });

  test("throws CrossrefResponseInvalid on malformed response shape (F7)", async () => {
    // published.date-parts as string instead of number[][] — zod rejects it
    const bad = { status: "ok", message: { title: ["T"], published: { "date-parts": "2024" } } };
    const mockFetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify(bad), { status: 200 })),
    );
    await expect(
      fetchCrossref("10.1000/xyz123", {
        mailto: "t@t.com",
        fetch: mockFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/CrossrefResponseInvalid/);
  });
});

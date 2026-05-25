// src/server/ingest/bibtex.test.ts — cycle 6.4 Task 1 RED
import { expect, test, describe } from "bun:test";
import { parseBibtex, parseRis } from "./bibtex.ts";

const MINIMAL_BIBTEX = `@article{smith2024test,
  title  = {Test Paper},
  author = {Smith, John and Doe, Jane},
  year   = {2024},
  doi    = {10.1000/xyz123},
}`;

const INJECTION_BIBTEX = `@article{evil,
  title  = {Bad ‮ Title},
  author = {Attacker},
  year   = {2024},
}`;

const ARXIV_BIBTEX = `@misc{vaswani2017,
  title        = {Attention Is All You Need},
  author       = {Vaswani, Ashish},
  year         = {2017},
  eprint       = {1706.03762},
  archivePrefix = {arXiv},
}`;

const NON_ARXIV_EPRINT = `@misc{hal2017,
  title        = {A HAL Paper},
  author       = {Dupont, Jean},
  year         = {2017},
  eprint       = {hal-01234567},
  archivePrefix = {HAL},
}`;

const WHITESPACE_TITLE = `@article{blank,
  title  = {   },
  author = {Author},
  year   = {2020},
}`;

const MINIMAL_RIS = `TY  - JOUR
AU  - Smith, John
TI  - RIS Paper
PY  - 2023
DO  - 10.9999/ris-test
ER  -
`;

describe("parseBibtex", () => {
  test("parses minimal BibTeX entry", () => {
    const entries = parseBibtex(MINIMAL_BIBTEX);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Test Paper");
    expect(entries[0].year).toBe(2024);
    expect(entries[0].doi).toBe("10.1000/xyz123");
    expect(entries[0].importedVia).toBe("bibtex");
  });

  test("authors are semicolon-delimited 'Last, First' strings", () => {
    const entries = parseBibtex(MINIMAL_BIBTEX);
    expect(entries[0].authors).toBe("Smith, John; Doe, Jane");
  });

  test("skips entry with bidi-override title (onError=skip)", () => {
    expect(parseBibtex(INJECTION_BIBTEX, { onError: "skip" })).toHaveLength(0);
  });

  test("skips entry with whitespace-only title (F13)", () => {
    expect(parseBibtex(WHITESPACE_TITLE, { onError: "skip" })).toHaveLength(0);
  });

  test("extracts arxivId from eprint when archivePrefix is arXiv (F7)", () => {
    const entries = parseBibtex(ARXIV_BIBTEX);
    expect(entries[0].arxivId).toBe("1706.03762");
  });

  test("does NOT set arxivId when archivePrefix is not arXiv", () => {
    const entries = parseBibtex(NON_ARXIV_EPRINT);
    expect(entries[0].arxivId).toBeUndefined();
  });
});

describe("parseRis", () => {
  test("parses minimal RIS entry", () => {
    const entries = parseRis(MINIMAL_RIS);
    expect(entries[0].title).toBe("RIS Paper");
    expect(entries[0].year).toBe(2023);
    expect(entries[0].doi).toBe("10.9999/ris-test");
    expect(entries[0].importedVia).toBe("ris");
  });

  test("skips entry with no TI field", () => {
    const noTitle = `TY  - JOUR\nAU  - Author\nPY  - 2020\nER  -\n`;
    expect(parseRis(noTitle, { onError: "skip" })).toHaveLength(0);
  });
});

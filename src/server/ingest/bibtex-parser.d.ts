// Type declarations for @retorquere/bibtex-parser (no official types shipped).
// Minimal surface — only fields accessed by bibtex.ts are typed.
declare module "@retorquere/bibtex-parser" {
  export interface BibtexAuthor {
    lastName?: string;
    firstName?: string;
  }

  export interface BibtexEntry {
    type: string;
    key: string;
    fields: Record<string, string | BibtexAuthor[] | undefined>;
    mode?: Record<string, string>;
    input?: string;
  }

  export interface BibtexParseResult {
    entries: BibtexEntry[];
    errors?: unknown[];
  }

  export interface BibtexParseOptions {
    errorHandler?: (err: unknown) => void;
  }

  export function parse(
    source: string,
    opts?: BibtexParseOptions,
  ): BibtexParseResult;
}

/**
 * PDF MCP Server
 *
 * An MCP server that displays PDFs in an interactive viewer.
 * Supports local files and remote HTTPS URLs.
 *
 * Tools:
 * - list_pdfs: List available PDFs
 * - display_pdf: Show interactive PDF viewer
 * - read_pdf_bytes: Stream PDF data in chunks (used by viewer)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import "./pdfjs-polyfill.js";
import { PDFDataRangeTransport } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api.js";
/**
 * PDF Standard-14 fonts from CDN. Used by both server and viewer so we
 * declare a single well-known origin in CSP connectDomains.
 *
 * pdf.js in Node defaults to NodeStandardFontDataFactory (fs.readFile) which
 * can't fetch URLs, so we pass {@link FetchStandardFontDataFactory} alongside.
 * The browser viewer uses the DOM factory by default and just needs the URL.
 */
export declare const STANDARD_FONT_DATA_URL: string;
import type { PrimitiveSchemaDefinition } from "@modelcontextprotocol/sdk/types.js";
export declare const DEFAULT_PDF = "https://arxiv.org/pdf/1706.03762";
export declare const MAX_CHUNK_BYTES: number;
export declare const RESOURCE_URI = "ui://pdf-viewer/mcp-app.html";
/** Inactivity timeout: clear cache entry if not accessed for this long */
export declare const CACHE_INACTIVITY_TIMEOUT_MS = 10000;
/** Max lifetime: clear cache entry after this time regardless of access */
export declare const CACHE_MAX_LIFETIME_MS = 60000;
/** Max size for cached PDFs (defensive limit to prevent memory exhaustion) */
export declare const CACHE_MAX_PDF_SIZE_BYTES: number;
/** Max total bytes across all cache entries; oldest evicted first when exceeded. */
export declare const CACHE_MAX_TOTAL_BYTES: number;
/** Allowed local file paths (CLI args + file roots — read access). */
export declare const allowedLocalFiles: Set<string>;
/** Allowed local directories (CLI args + directory roots — read access). */
export declare const allowedLocalDirs: Set<string>;
/**
 * Subset of allowedLocalFiles that came from CLI args (not MCP roots).
 * Only these individual files are writable. File roots from the client
 * are uploaded copies in ad-hoc hidden folders — treat as read-only.
 * Directory roots are mounted folders; files UNDER them are writable.
 */
export declare const cliLocalFiles: Set<string>;
/**
 * Write-permission flags. Object wrapper (not a bare `let`) so main.ts can
 * mutate via the exported binding without re-import gymnastics — same
 * pattern as the Sets above.
 */
export declare const writeFlags: {
    /**
     * Claude Desktop mounts its per-conversation drop folder as a directory
     * root whose basename is literally `uploads`. Files in there are one-shot
     * copies the client doesn't expect us to overwrite. Default: read-only.
     * `--writeable-uploads-root` flips this for local testing.
     */
    allowUploadsRoot: boolean;
};
/**
 * Saving is allowed iff:
 *   (a) the file was passed as a CLI arg — the user explicitly named it
 *       when starting the server, so overwriting is clearly intentional; OR
 *   (b) the file is STRICTLY UNDER a directory root at any depth
 *       (isAncestorDir excludes rel === "", so the root itself never
 *       counts), AND the client did not ALSO send it as a file root.
 *       A file root is the client's way of saying "here's an upload" —
 *       treat that signal as authoritative even when the path happens
 *       to fall inside a mounted directory.
 *
 *   EXCEPTION to (b): a dir root whose basename is `uploads` is treated
 *   as read-only unless `writeFlags.allowUploadsRoot` is set. This is how
 *   Claude Desktop surfaces attached files — writing back to them
 *   surprises the user (the attachment doesn't update).
 *
 * With no directory roots and no CLI files, nothing is writable.
 */
export declare function isWritablePath(resolved: string): boolean;
import type { PdfCommand } from "./src/commands.js";
export type { PdfCommand };
/**
 * Resolved local file path per viewer UUID, for save_as without an explicit
 * target. Only set for local files (remote PDFs have nothing to overwrite).
 * Populated during display_pdf, cleared by the heartbeat sweep.
 *
 * Exported for tests.
 */
export declare const viewSourcePaths: Map<string, string>;
export declare function startFileWatch(viewUUID: string, filePath: string): void;
export declare function stopFileWatch(viewUUID: string): void;
export declare function isFileUrl(url: string): boolean;
export declare function isArxivUrl(url: string): boolean;
export declare function normalizeArxivUrl(url: string): string;
export declare function fileUrlToPath(fileUrl: string): string;
export declare function pathToFileUrl(filePath: string): string;
/**
 * Check if `dir` is an ancestor of `filePath` using path.relative,
 * which is more robust than string prefix matching (handles normalization).
 */
export declare function isAncestorDir(dir: string, filePath: string): boolean;
export declare function validateUrl(url: string): {
    valid: boolean;
    error?: string;
};
/**
 * Session-local PDF cache utilities.
 * Each call to createPdfCache() creates an independent cache instance.
 */
export interface PdfCache {
    /** Read a range of bytes from a PDF, using cache for servers without Range support */
    readPdfRange(url: string, offset: number, byteCount: number): Promise<{
        data: Uint8Array;
        totalBytes: number;
    }>;
    /** Get current number of cached entries */
    getCacheSize(): number;
    /** Clear all cached entries and their timers */
    clearCache(): void;
}
/**
 * Creates a session-local PDF cache with automatic timeout-based cleanup.
 *
 * When a remote server returns HTTP 200 (full body) instead of 206 (partial),
 * the full response is cached so subsequent chunk requests don't re-download.
 *
 * Entries are automatically cleared after:
 * - CACHE_INACTIVITY_TIMEOUT_MS of no access (resets on each access)
 * - CACHE_MAX_LIFETIME_MS from creation (absolute timeout)
 */
export declare function createPdfCache(maxTotalBytes?: number): PdfCache;
/**
 * pdf.js range transport backed by {@link PdfCache.readPdfRange}. Lets
 * getDocument() fetch only the byte ranges it needs (xref, /AcroForm dict)
 * instead of the whole file. With disableAutoFetch, a PDF without form
 * fields is opened with ~5% of bytes fetched.
 *
 * pdf.js has no upstream error channel on PDFDataRangeTransport (its
 * `abort()` is a no-op stub it calls *on* us, not the other way). Callers
 * must `Promise.race` their pdf.js awaits against {@link failed}, which
 * rejects on the first fetch error.
 */
export declare class PdfCacheRangeTransport extends PDFDataRangeTransport {
    private url;
    private readPdfRange;
    /** Rejects on the first range-fetch error; never resolves. */
    readonly failed: Promise<never>;
    private fail;
    constructor(url: string, length: number, readPdfRange: PdfCache["readPdfRange"]);
    requestDataRange(begin: number, end: number): void;
    /**
     * pdf.js coalesces adjacent missing chunks into one unbounded request, but
     * readPdfRange clamps each call to MAX_CHUNK_BYTES. Its reader is keyed by
     * the original `begin` and removed after one delivery, so we must accumulate
     * slices and call onDataRange exactly once with the full buffer.
     */
    private deliver;
}
/**
 * Extract form fields from a PDF and build an elicitation schema.
 * Returns null if the PDF has no form fields.
 */
/** Shape of field objects returned by pdfjs-dist's getFieldObjects(). */
interface PdfJsFieldObject {
    type: string;
    name: string;
    editable: boolean;
    exportValues?: string;
    items?: Array<{
        exportValue: string;
        displayValue: string;
    }>;
}
export declare function extractFormSchema(pdfDoc: PDFDocumentProxy, fieldObjects: Record<string, PdfJsFieldObject[]> | null): Promise<{
    type: "object";
    properties: Record<string, PrimitiveSchemaDefinition>;
    required?: string[];
} | null>;
export interface CreateServerOptions {
    /**
     * Enable the `interact` tool and related command-queue infrastructure
     * (in-memory command queue, `poll_pdf_commands`, `submit_page_data`).
     * Only suitable for single-instance deployments (e.g. stdio transport).
     * Defaults to false — server exposes only `list_pdfs` and `display_pdf` (read-only).
     */
    enableInteract?: boolean;
    /**
     * Whether to honour MCP roots sent by the client.
     *
     * When a server is exposed over HTTP, the connecting client is
     * typically remote and may advertise `roots` that refer to
     * directories on the **client's** file system.  Because the server
     * resolves those paths locally, accepting them by default would give
     * the remote client access to arbitrary directories on the
     * **server's** machine.
     *
     * For stdio the client is typically local (e.g. Claude Desktop on the
     * same machine), so roots are safe and enabled by default.
     *
     * Set this to `true` for HTTP only when you trust the client, or
     * pass the `--use-client-roots` CLI flag.
     *
     * @default false
     */
    useClientRoots?: boolean;
    /**
     * Emit debug metadata to the viewer (currently: allowed roots shown
     * in a floating bubble). Toggled by the `--debug` CLI flag.
     */
    debug?: boolean;
}
export declare function createServer(options?: CreateServerOptions): McpServer;

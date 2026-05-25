/**
 * PDF Annotation Helpers
 *
 * Pure functions for annotation persistence (diff-based model),
 * color conversion, and PDF annotation dict creation using pdf-lib.
 *
 * The diff-based model stores only changes relative to the PDF's
 * native annotations: additions, removals, and modifications.
 * This keeps localStorage small and preserves round-trip fidelity.
 */
import { PDFDocument } from "@cantoo/pdf-lib";
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface AnnotationBase {
    id: string;
    page: number;
}
export interface HighlightAnnotation extends AnnotationBase {
    type: "highlight";
    rects: Rect[];
    color?: string;
    content?: string;
}
export interface UnderlineAnnotation extends AnnotationBase {
    type: "underline";
    rects: Rect[];
    color?: string;
}
export interface StrikethroughAnnotation extends AnnotationBase {
    type: "strikethrough";
    rects: Rect[];
    color?: string;
}
export interface NoteAnnotation extends AnnotationBase {
    type: "note";
    x: number;
    y: number;
    content: string;
    color?: string;
}
export interface RectangleAnnotation extends AnnotationBase {
    type: "rectangle";
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
    fillColor?: string;
    rotation?: number;
}
export interface CircleAnnotation extends AnnotationBase {
    type: "circle";
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
    fillColor?: string;
}
export interface LineAnnotation extends AnnotationBase {
    type: "line";
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color?: string;
}
export interface FreetextAnnotation extends AnnotationBase {
    type: "freetext";
    x: number;
    y: number;
    content: string;
    fontSize?: number;
    color?: string;
}
export interface StampAnnotation extends AnnotationBase {
    type: "stamp";
    x: number;
    y: number;
    label: string;
    color?: string;
    rotation?: number;
}
export interface ImageAnnotation extends AnnotationBase {
    type: "image";
    x: number;
    y: number;
    width: number;
    height: number;
    imageData?: string;
    imageUrl?: string;
    mimeType?: string;
    rotation?: number;
    aspect?: "preserve" | "ignore";
}
/**
 * An annotation that already exists in the loaded PDF and that we render
 * verbatim from its appearance stream (via pdf.js's annotationCanvasMap)
 * rather than re-modeling it with one of our shape types.
 *
 * Covers two cases:
 *  - subtypes we don't model (Ink, Polygon, Caret, FileAttachment, …)
 *  - subtypes we *could* model but whose appearance carries information
 *    our model would drop (e.g. Stamp with an image signature)
 *
 * The rasterized canvas is supplied at render time by mcp-app.ts; this
 * struct only carries placement and identity. Coords are PDF user-space
 * (origin bottom-left), matching the other rect-shaped types.
 */
export interface ImportedAnnotation extends AnnotationBase {
    type: "imported";
    x: number;
    y: number;
    width: number;
    height: number;
    /** pdf.js getAnnotations() id (e.g. "118R") — key into annotationCanvasMap. */
    pdfjsId: string;
    /** Original PDF /Subtype (e.g. "Stamp", "Ink") for the panel label. */
    subtype: string;
}
export type PdfAnnotationDef = HighlightAnnotation | UnderlineAnnotation | StrikethroughAnnotation | NoteAnnotation | RectangleAnnotation | CircleAnnotation | LineAnnotation | FreetextAnnotation | StampAnnotation | ImageAnnotation | ImportedAnnotation;
/**
 * Convert annotation coordinates from model space (top-left origin, Y↓)
 * to internal PDF space (bottom-left origin, Y↑).
 *
 * Call this when receiving coordinates from the model via add/update_annotations.
 */
export declare function convertFromModelCoords(def: PdfAnnotationDef, pageHeight: number): PdfAnnotationDef;
/**
 * Convert annotation coordinates from internal PDF space (bottom-left origin, Y↑)
 * to model space (top-left origin, Y↓).
 *
 * Call this when presenting coordinates to the model (e.g. in context strings).
 */
export declare function convertToModelCoords(def: PdfAnnotationDef, pageHeight: number): PdfAnnotationDef;
/**
 * Represents changes relative to the PDF's native annotations.
 * Only this diff is stored in localStorage, keeping it small.
 */
export interface AnnotationDiff {
    /** Annotations created by the user (not in the original PDF) */
    added: PdfAnnotationDef[];
    /** PDF annotation ref strings that the user deleted */
    removed: string[];
    /** Form field values the user filled in */
    formFields: Record<string, string | boolean>;
}
/** Create an empty diff */
export declare function emptyDiff(): AnnotationDiff;
/** Check if a diff has any changes */
export declare function isDiffEmpty(diff: AnnotationDiff): boolean;
/** Serialize diff to JSON string for localStorage */
export declare function serializeDiff(diff: AnnotationDiff): string;
/** Deserialize diff from JSON string. Returns empty diff on error. */
export declare function deserializeDiff(json: string): AnnotationDiff;
/**
 * Merge PDF-native annotations with user diff to produce the final annotation set.
 *
 * @param pdfAnnotations - Annotations imported from the PDF file
 * @param diff - User's local changes (additions, removals)
 * @returns Merged annotation list
 */
export declare function mergeAnnotations(pdfAnnotations: PdfAnnotationDef[], diff: AnnotationDiff): PdfAnnotationDef[];
/**
 * Compute a diff given the PDF-native annotations and the current full set.
 *
 * @param pdfAnnotations - Original annotations from the PDF
 * @param currentAnnotations - Current full annotation set (after user edits)
 * @param formFields - Current form field values
 * @returns The diff to persist
 */
export declare function computeDiff(pdfAnnotations: PdfAnnotationDef[], currentAnnotations: PdfAnnotationDef[], formFields: Map<string, string | boolean>, baselineFormFields?: Map<string, string | boolean>): AnnotationDiff;
/**
 * Parse a CSS color string to normalized RGB values (0-1 range).
 * Supports hex (#rgb, #rrggbb, #rrggbbaa) and rgb()/rgba() notation.
 */
export declare function cssColorToRgb(color: string): {
    r: number;
    g: number;
    b: number;
} | null;
/** Default colors for each annotation type */
export declare function defaultColor(type: PdfAnnotationDef["type"]): string;
/**
 * Add proper PDF annotation objects to a pdf-lib PDFDocument.
 * Creates /Type /Annot dictionaries with correct /Subtype for each annotation type.
 * These are real PDF annotations, editable in Acrobat/Preview.
 */
export declare function addAnnotationDicts(pdfDoc: PDFDocument, annotations: PdfAnnotationDef[]): Promise<void>;
/**
 * Recover the PDF object reference from an annotation id assigned by
 * `makeAnnotationId`. Handles both `pdf-<num>-<gen>` (from `ann.ref`) and
 * `pdf-<num>R` (from pdf.js's string `ann.id`, gen always 0). Returns null for
 * page-index fallback ids — those have no stable ref to remove by.
 */
export declare function parseAnnotationRef(id: string): {
    objectNumber: number;
    generationNumber: number;
} | null;
/**
 * Build annotated PDF bytes from the original document.
 * Applies user annotations and form fills, removes baseline annotations the
 * user deleted, returns Uint8Array of the new PDF.
 */
export declare function buildAnnotatedPdfBytes(pdfBytes: Uint8Array, annotations: PdfAnnotationDef[], formFields: Map<string, string | boolean>, removedRefs?: {
    objectNumber: number;
    generationNumber: number;
}[]): Promise<Uint8Array>;
/**
 * Convert a single PDF.js annotation object to our PdfAnnotationDef format.
 * Returns null for unsupported annotation types.
 */
export declare function importPdfjsAnnotation(ann: any, pageNum: number, index: number): PdfAnnotationDef | null;
/**
 * Convert base64 string to Uint8Array.
 */
export declare function base64ToUint8Array(base64: string): Uint8Array;
/**
 * Convert Uint8Array to base64 string.
 */
export declare function uint8ArrayToBase64(bytes: Uint8Array): string;

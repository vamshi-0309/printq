import { PDFDocument } from "pdf-lib";
import { unzipSync, strFromU8 } from "fflate";
import { extensionOf } from "./fileExtension";

/**
 * How many pages will this document print?
 *
 * This number decides what the customer is charged, so it has to be real.
 * The previous implementation scanned the raw PDF bytes for "/Type /Page"
 * occurrences and returned 1 for essentially every multi-page document —
 * a 120-page file was billed as a single page. It now parses properly.
 *
 * Per format:
 *   PDF        parsed with pdf-lib — exact
 *   DOCX/PPTX  read from docProps/app.xml, which Word and PowerPoint write
 *              when saving — exact when present
 *   JPG/PNG    always one page
 *   DOC/PPT    legacy binary formats carry no reliable page count; reported
 *              as unknown rather than guessed
 *
 * Unknown is a first-class result, not an error. Guessing "1" is what caused
 * the underbilling, so callers are made to handle the uncertainty instead.
 */

export type PageCountSource = "pdf" | "docx" | "pptx" | "image";

export type PageCountResult =
  | { known: true; pages: number; source: PageCountSource }
  | { known: false; reason: string };

export class EncryptedPdfError extends Error {
  constructor() {
    super("This PDF is password-protected, so it can't be printed. Remove the password and try again.");
  }
}

/** Exact page count for a PDF. Throws `EncryptedPdfError` for protected files. */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/encrypt/i.test(message)) throw new EncryptedPdfError();
    throw new Error("This PDF appears to be damaged and can't be read.");
  }

  // pdf-lib will load an encrypted document when told to ignore encryption,
  // but its contents are unusable — and unprintable — so reject it here.
  if (doc.isEncrypted) throw new EncryptedPdfError();

  const pages = doc.getPageCount();
  if (!Number.isInteger(pages) || pages < 1) {
    throw new Error("This PDF reports no printable pages.");
  }
  return pages;
}

/**
 * Page/slide count from an OOXML file's own metadata.
 *
 * `docProps/app.xml` is written by Word and PowerPoint and holds the count
 * they computed at save time. Returns null when the part is missing (some
 * generators omit it) so the caller can treat it as unknown.
 */
export function countOoxmlPages(bytes: Uint8Array, kind: "docx" | "pptx"): number | null {
  let xml: string;
  try {
    // Only inflate the one small part we need, not the whole document.
    const files = unzipSync(bytes, { filter: (f) => f.name === "docProps/app.xml" });
    const part = files["docProps/app.xml"];
    if (!part) return null;
    xml = strFromU8(part);
  } catch {
    return null;
  }

  const tag = kind === "docx" ? "Pages" : "Slides";
  const match = new RegExp(`<${tag}>\\s*(\\d+)\\s*</${tag}>`).exec(xml);
  if (!match) return null;

  const n = parseInt(match[1], 10);
  // Guard against a corrupt or absurd value rather than billing on it.
  if (!Number.isInteger(n) || n < 1 || n > 20000) return null;
  return n;
}

// Re-exported for existing callers. The implementation lives in a
// dependency-free module so client code can use it without pulling in pdf-lib.
export { extensionOf } from "./fileExtension";

/** Page count for any supported upload. */
export async function countDocumentPages(
  bytes: Uint8Array,
  filename: string
): Promise<PageCountResult> {
  const ext = extensionOf(filename);

  if (ext === ".pdf") {
    return { known: true, pages: await countPdfPages(bytes), source: "pdf" };
  }

  if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
    return { known: true, pages: 1, source: "image" };
  }

  if (ext === ".docx" || ext === ".pptx") {
    const kind = ext === ".docx" ? "docx" : "pptx";
    const n = countOoxmlPages(bytes, kind);
    if (n !== null) return { known: true, pages: n, source: kind };
    return {
      known: false,
      reason:
        "This file doesn't record its page count. The shop will confirm it after converting the document.",
    };
  }

  if (ext === ".doc" || ext === ".ppt") {
    return {
      known: false,
      reason:
        "Older Word and PowerPoint files don't carry a page count. Save as PDF for an exact price up front.",
    };
  }

  return { known: false, reason: "Page count can't be determined for this file type." };
}

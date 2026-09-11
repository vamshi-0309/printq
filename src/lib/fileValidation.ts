import { extensionOf } from "./fileExtension";

/**
 * File validation. Runs both client-side (for immediate feedback) and
 * server-side (as the authoritative check before storage). The client check is
 * a UX convenience, not a security boundary — the server re-validates
 * independently because a malicious client can skip JS.
 *
 * MIME HANDLING
 * The browser-reported MIME type is advisory only, and on phones it is
 * frequently absent: Android's document picker and cloud providers (Drive,
 * OneDrive) routinely hand over a File with `type === ""`, and some Android
 * builds report the non-standard "image/jpg". The previous rule required an
 * exact match against a fixed list, so those files were rejected before an
 * upload was ever attempted — the picker opened, a file was chosen, and
 * nothing happened. That is the mobile upload failure.
 *
 * The extension now governs, and the MIME type is only used to reject a value
 * that positively contradicts it. This loses nothing in safety: the real check
 * is that the server parses the bytes (pdf-lib for PDF, a zip read for
 * OOXML) before anything is stored, which a spoofed MIME string cannot pass.
 */

export const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".jpg", ".jpeg", ".png",
]);

/**
 * MIME types each extension may legitimately arrive with, including the
 * non-standard variants seen from real mobile pickers.
 */
const MIMES_BY_EXTENSION: Record<string, string[]> = {
  ".pdf": ["application/pdf", "application/x-pdf", "application/acrobat"],
  ".jpg": ["image/jpeg", "image/jpg", "image/pjpeg"],
  ".jpeg": ["image/jpeg", "image/jpg", "image/pjpeg"],
  ".png": ["image/png", "image/x-png"],
  ".doc": ["application/msword"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    // Android pickers often fall back to the container type for OOXML files.
    "application/zip",
    "application/x-zip-compressed",
    "application/msword",
  ],
  ".ppt": ["application/vnd.ms-powerpoint"],
  ".pptx": [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.ms-powerpoint",
  ],
};

/**
 * Values that carry no information about the content. Treated as "unknown"
 * rather than "wrong" — this is what a phone usually sends.
 */
const UNINFORMATIVE_MIMES = new Set([
  "",
  "application/octet-stream",
  "application/binary",
  "binary/octet-stream",
  "*/*",
]);

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export interface FileValidationResult {
  ok: boolean;
  error?: string;
}

/** Whether a reported MIME type is compatible with the file's extension. */
export function isMimeAcceptableFor(ext: string, mimeType: string | null | undefined): boolean {
  // Extension first: an unsupported one is never acceptable, however
  // uninformative the MIME type is.
  const allowed = MIMES_BY_EXTENSION[ext];
  if (!allowed) return false;

  const mime = (mimeType ?? "").trim().toLowerCase();
  if (UNINFORMATIVE_MIMES.has(mime)) return true;

  return allowed.includes(mime);
}

export function validateFile(
  filename: string,
  mimeType: string,
  sizeBytes: number
): FileValidationResult {
  const ext = extensionOf(filename);

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      error: ext
        ? `"${ext}" files aren't supported. Use PDF, Word, PowerPoint, JPG, or PNG.`
        : "That file has no extension, so we can't tell what it is. Use PDF, Word, PowerPoint, JPG, or PNG.",
    };
  }

  if (!isMimeAcceptableFor(ext, mimeType)) {
    return {
      ok: false,
      error: `That file says it's ${mimeType}, which doesn't match a ${ext} file.`,
    };
  }

  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `File is too large (${Math.round(sizeBytes / 1024 / 1024)}MB). Maximum is 50MB.`,
    };
  }

  if (sizeBytes === 0) {
    return { ok: false, error: "File is empty." };
  }

  return { ok: true };
}

/**
 * Value for an <input type="file"> accept attribute.
 *
 * Includes MIME types as well as extensions: Android's picker filters on MIME
 * and can grey out every file when given extensions alone, while iOS prefers
 * extensions. Offering both keeps the picker usable on either platform.
 */
export const ACCEPT_ATTRIBUTE = [
  ...ALLOWED_EXTENSIONS,
  ...new Set(Object.values(MIMES_BY_EXTENSION).flat()),
].join(",");

/** Extension categories for downstream processing decisions. */
export function fileCategory(ext: string): "pdf" | "office" | "image" | "unknown" {
  ext = ext.toLowerCase();
  if (ext === ".pdf") return "pdf";
  if ([".doc", ".docx", ".ppt", ".pptx"].includes(ext)) return "office";
  if ([".jpg", ".jpeg", ".png"].includes(ext)) return "image";
  return "unknown";
}

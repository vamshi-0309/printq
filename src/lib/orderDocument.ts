import { countDocumentPages, EncryptedPdfError } from "./documentPages";
import { extensionOf } from "./fileExtension";
import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
  MAX_PAGE_COUNT,
  canonicalMimeFor,
} from "./fileValidation";

/**
 * What an order is actually going to print, established by the server.
 *
 * THE HOLE THIS CLOSES
 * The upload route counts pages properly, then hands the count back to the
 * browser. The browser echoed it to /api/orders, and the order route priced
 * from that echoed number without ever looking at the stored file again. It
 * also stored the customer's raw page-range text. So a 100-page PDF could be
 * submitted with `pageCount: 1, pageRange: "all"`: priced as one page, stored
 * as "all", and printed as all 100 by the agent.
 *
 * Every value that decides money or paper -- how many pages, which pages,
 * which file -- now comes from the stored object itself. The client's
 * numbers are not consulted for anything that is billed or printed.
 *
 * The same was true of the file: `fileStoragePath` arrived from the client and
 * nothing checked it belonged to this shop. It must now sit under the shop's
 * own prefix, which is where /api/upload writes it.
 */

export type StoredDocumentError =
  | "bad_path"
  | "missing"
  | "unsupported_type"
  | "too_large"
  | "encrypted"
  | "unreadable"
  | "unknown_page_count"
  | "too_many_pages";

export type StoredDocumentResult =
  | {
      ok: true;
      pageCount: number;
      sizeBytes: number;
      mimeType: string;
      extension: string;
    }
  | { ok: false; code: StoredDocumentError; message: string };

/**
 * Is this a path /api/upload could have produced for this shop?
 *
 * Upload writes `${shopId}/${uniqueDir}/${safeName}`. Anything else -- another
 * shop's prefix, a traversal, an absolute path -- is refused before storage is
 * touched. Pure, so it can be tested without a bucket.
 */
export function isShopStoragePath(shopId: string, storagePath: string): boolean {
  if (typeof storagePath !== "string" || !storagePath) return false;
  if (storagePath.includes("\\") || storagePath.includes("\0")) return false;
  if (storagePath.startsWith("/")) return false;

  const segments = storagePath.split("/");
  // shopId / uniqueDir / filename -- exactly three, none empty or relative.
  if (segments.length !== 3) return false;
  if (segments.some((seg) => seg === "" || seg === "." || seg === "..")) return false;

  return segments[0] === shopId;
}

/**
 * Establish the facts of a stored upload.
 *
 * `download` is injected so the rules can be tested without storage; the route
 * passes the real one from ./storage.
 */
export async function verifyStoredDocument(
  shopId: string,
  storagePath: string,
  download: (path: string) => Promise<Uint8Array>,
  isMissing: (err: unknown) => boolean
): Promise<StoredDocumentResult> {
  if (!isShopStoragePath(shopId, storagePath)) {
    return {
      ok: false,
      code: "bad_path",
      message: "That upload doesn't belong to this shop. Please upload your file again.",
    };
  }

  const filename = storagePath.split("/")[2];
  const extension = extensionOf(filename);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      code: "unsupported_type",
      message: "That file type can't be printed. Use PDF, Word, PowerPoint, JPG, or PNG.",
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = await download(storagePath);
  } catch (err) {
    if (isMissing(err)) {
      return {
        ok: false,
        code: "missing",
        message: "Your upload has expired. Please upload the file again.",
      };
    }
    throw err;
  }

  if (bytes.byteLength === 0) {
    return { ok: false, code: "unreadable", message: "That file is empty." };
  }
  if (bytes.byteLength > MAX_FILE_SIZE_BYTES) {
    return { ok: false, code: "too_large", message: "That file is larger than 50 MB." };
  }

  let counted;
  try {
    counted = await countDocumentPages(bytes, filename);
  } catch (err) {
    if (err instanceof EncryptedPdfError) {
      return { ok: false, code: "encrypted", message: err.message };
    }
    return {
      ok: false,
      code: "unreadable",
      message: err instanceof Error ? err.message : "That file could not be read.",
    };
  }

  // A count the server cannot establish is not replaced with the customer's
  // number: that would reopen exactly this hole. The customer UI already
  // declines to quote these files, so no working flow depends on it.
  if (!counted.known) {
    return {
      ok: false,
      code: "unknown_page_count",
      message: `${counted.reason} Save it as a PDF and upload that instead.`,
    };
  }

  if (counted.pages > MAX_PAGE_COUNT) {
    return {
      ok: false,
      code: "too_many_pages",
      message: `That document has ${counted.pages} pages. The most one order can print is ${MAX_PAGE_COUNT}.`,
    };
  }

  return {
    ok: true,
    pageCount: counted.pages,
    sizeBytes: bytes.byteLength,
    mimeType: canonicalMimeFor(extension),
    extension,
  };
}

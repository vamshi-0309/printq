import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { isShopStoragePath, verifyStoredDocument } from "../orderDocument";
import { MAX_PAGE_COUNT } from "../fileValidation";
import { parsePageRange, pagesToRangeString } from "../pageRange";

/**
 * The order is priced and printed from the stored file, not from the request.
 *
 * THE HOLE
 * /api/upload counted pages correctly and returned the count to the browser.
 * The browser echoed it to /api/orders, which priced from that echoed number
 * and stored the customer's raw page-range text. Submitting a 100-page PDF as
 * `{ pageCount: 1, pageRange: "all" }` produced an order priced at one page
 * and stored as "all" -- which the agent printed as all 100.
 *
 * These tests use real PDFs built with pdf-lib, so the page counts asserted
 * are the counts a real document produces.
 */

const SHOP = "1fc9582b-4624-4075-83ea-8e115ad845d4";
const OTHER_SHOP = "14e694d1-537b-466b-b49e-f10e70205f54";
const PATH = `${SHOP}/1789000000000-abc123/thesis.pdf`;

async function pdfWithPages(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([595, 842]);
  return doc.save();
}

class Missing extends Error {}
const isMissing = (err: unknown) => err instanceof Missing;
const serving = (bytes: Uint8Array) => async () => bytes;

describe("the billed page count comes from the stored file", () => {
  it("counts the real document, whatever the client claimed", async () => {
    const result = await verifyStoredDocument(SHOP, PATH, serving(await pdfWithPages(100)), isMissing);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The exploit sent pageCount: 1. The server's answer is 100.
    expect(result.pageCount).toBe(100);
  });

  it("closes the exploit end to end: 'all' expands to the real page count", async () => {
    const result = await verifyStoredDocument(SHOP, PATH, serving(await pdfWithPages(100)), isMissing);
    if (!result.ok) throw new Error("expected a verified document");

    // Exactly what the order route does with the verified count.
    const range = parsePageRange(`1-${result.pageCount}`, result.pageCount);
    expect(range.ok).toBe(true);
    if (!range.ok) return;
    expect(range.pages.length).toBe(100);
  });

  it("stores the priced range, so the agent can't print more than was paid for", async () => {
    const result = await verifyStoredDocument(SHOP, PATH, serving(await pdfWithPages(20)), isMissing);
    if (!result.ok) throw new Error("expected a verified document");

    const range = parsePageRange("3-5,9", result.pageCount);
    if (!range.ok) throw new Error("expected a valid range");
    // Billed pages and stored range describe the same set.
    const stored = pagesToRangeString(range.pages);
    expect(stored).toBe("3-5,9");
    const reparsed = parsePageRange(stored, result.pageCount);
    expect(reparsed.ok && reparsed.pages).toEqual(range.pages);
  });

  it("rejects a range that runs past the real document", async () => {
    const result = await verifyStoredDocument(SHOP, PATH, serving(await pdfWithPages(3)), isMissing);
    if (!result.ok) throw new Error("expected a verified document");
    // A client claiming 50 pages cannot select page 40 of a 3-page file.
    expect(parsePageRange("1-40", result.pageCount).ok).toBe(false);
  });

  it("measures size and type itself", async () => {
    const bytes = await pdfWithPages(2);
    const result = await verifyStoredDocument(SHOP, PATH, serving(bytes), isMissing);
    if (!result.ok) throw new Error("expected a verified document");
    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(result.mimeType).toBe("application/pdf");
  });
});

describe("the file must be this shop's upload", () => {
  it("accepts the path shape /api/upload writes", () => {
    expect(isShopStoragePath(SHOP, PATH)).toBe(true);
  });

  it("refuses another shop's file", async () => {
    const foreign = `${OTHER_SHOP}/1789000000000-abc123/secret.pdf`;
    expect(isShopStoragePath(SHOP, foreign)).toBe(false);

    let downloaded = false;
    const result = await verifyStoredDocument(
      SHOP,
      foreign,
      async () => {
        downloaded = true;
        return new Uint8Array();
      },
      isMissing
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("bad_path");
    // Refused before storage is even touched.
    expect(downloaded).toBe(false);
  });

  it.each([
    [`${SHOP}/../${OTHER_SHOP}/x/secret.pdf`],
    [`${SHOP}/x/../../${OTHER_SHOP}.pdf`],
    [`/${SHOP}/x/a.pdf`],
    [`${SHOP}\\x\\a.pdf`],
    [`${SHOP}/a.pdf`],
    [`${SHOP}/x/y/a.pdf`],
    [`${SHOP}//a.pdf`],
    [`${SHOP}/./a.pdf`],
    [""],
  ])("refuses a malformed or escaping path: %s", (path) => {
    expect(isShopStoragePath(SHOP, path)).toBe(false);
  });

  it("refuses a shop id that merely prefixes the real one", () => {
    // `startsWith(shopId)` alone would accept this.
    expect(isShopStoragePath(SHOP, `${SHOP}0/x/a.pdf`)).toBe(false);
  });
});

describe("limits", () => {
  it("rejects a document over the page limit", async () => {
    const result = await verifyStoredDocument(
      SHOP,
      PATH,
      serving(await pdfWithPages(MAX_PAGE_COUNT + 1)),
      isMissing
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("too_many_pages");
  });

  it("accepts a document exactly at the limit", async () => {
    const result = await verifyStoredDocument(
      SHOP,
      PATH,
      serving(await pdfWithPages(MAX_PAGE_COUNT)),
      isMissing
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a disallowed extension without downloading it", async () => {
    let downloaded = false;
    const result = await verifyStoredDocument(
      SHOP,
      `${SHOP}/x/run.exe`,
      async () => {
        downloaded = true;
        return new Uint8Array([0x4d, 0x5a]);
      },
      isMissing
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unsupported_type");
    expect(downloaded).toBe(false);
  });

  it("refuses an empty file", async () => {
    const result = await verifyStoredDocument(SHOP, PATH, serving(new Uint8Array()), isMissing);
    expect(result.ok).toBe(false);
  });

  it("refuses a file that is not really a PDF", async () => {
    const result = await verifyStoredDocument(
      SHOP,
      PATH,
      serving(new TextEncoder().encode("not a pdf at all")),
      isMissing
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unreadable");
  });
});

describe("unknown page counts are not replaced with the client's number", () => {
  it("refuses a legacy .doc rather than trusting a claimed count", async () => {
    const result = await verifyStoredDocument(
      SHOP,
      `${SHOP}/x/essay.doc`,
      serving(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])),
      isMissing
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unknown_page_count");
      expect(result.message).toMatch(/PDF/);
    }
  });
});

describe("storage failures", () => {
  it("reports an expired upload clearly", async () => {
    const result = await verifyStoredDocument(
      SHOP,
      PATH,
      async () => {
        throw new Missing("gone");
      },
      isMissing
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing");
  });

  it("lets a transient storage fault propagate for a retryable response", async () => {
    await expect(
      verifyStoredDocument(
        SHOP,
        PATH,
        async () => {
          throw new Error("ECONNRESET");
        },
        isMissing
      )
    ).rejects.toThrow("ECONNRESET");
  });
});

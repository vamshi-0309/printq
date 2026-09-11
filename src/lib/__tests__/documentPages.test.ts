import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";
import {
  countPdfPages,
  countOoxmlPages,
  countDocumentPages,
  extensionOf,
  EncryptedPdfError,
} from "../documentPages";

/**
 * Page count is the input to pricing, so these tests build real files and
 * assert the exact number. The headline case is the regression: the previous
 * byte-scanning implementation returned 1 for every multi-page PDF, which
 * billed a 120-page document as a single page.
 */

async function makePdf(pages: number, useObjectStreams = false) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return doc.save({ useObjectStreams });
}

function makeOoxml(tag: "Pages" | "Slides", value: number | string) {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "docProps/app.xml": strToU8(
      `<?xml version="1.0"?><Properties><${tag}>${value}</${tag}></Properties>`
    ),
  });
}

describe("countPdfPages", () => {
  // The regression. Every one of these used to come back as 1.
  it.each([1, 2, 3, 7, 25, 120, 500])("counts a %i-page PDF exactly", async (n) => {
    expect(await countPdfPages(await makePdf(n))).toBe(n);
  });

  it("counts correctly when the PDF uses object streams", async () => {
    // Modern writers compress the page tree, which defeats naive byte scanning.
    expect(await countPdfPages(await makePdf(42, true))).toBe(42);
  });

  it("rejects a file that is not a PDF", async () => {
    await expect(countPdfPages(strToU8("this is plainly not a pdf"))).rejects.toThrow(
      /damaged|can't be read/i
    );
  });

  it("rejects an empty buffer", async () => {
    await expect(countPdfPages(new Uint8Array())).rejects.toThrow();
  });
});

describe("countOoxmlPages", () => {
  it("reads the page count from a .docx", () => {
    expect(countOoxmlPages(makeOoxml("Pages", 14), "docx")).toBe(14);
  });

  it("reads the slide count from a .pptx", () => {
    expect(countOoxmlPages(makeOoxml("Slides", 9), "pptx")).toBe(9);
  });

  it("returns null when app.xml is absent", () => {
    const zip = zipSync({ "word/document.xml": strToU8("<w:document/>") });
    expect(countOoxmlPages(zip, "docx")).toBeNull();
  });

  it("returns null rather than billing on an absurd value", () => {
    expect(countOoxmlPages(makeOoxml("Pages", 999999), "docx")).toBeNull();
    expect(countOoxmlPages(makeOoxml("Pages", 0), "docx")).toBeNull();
    expect(countOoxmlPages(makeOoxml("Pages", "abc"), "docx")).toBeNull();
  });

  it("returns null for bytes that are not a zip", () => {
    expect(countOoxmlPages(strToU8("not a zip at all"), "docx")).toBeNull();
  });

  it("does not read a docx count out of a pptx tag", () => {
    expect(countOoxmlPages(makeOoxml("Slides", 9), "docx")).toBeNull();
  });
});

describe("countDocumentPages", () => {
  it("counts a PDF", async () => {
    const res = await countDocumentPages(await makePdf(11), "report.pdf");
    expect(res).toEqual({ known: true, pages: 11, source: "pdf" });
  });

  it.each([["photo.jpg"], ["photo.jpeg"], ["scan.PNG"]])("treats %s as one page", async (name) => {
    const res = await countDocumentPages(new Uint8Array([1, 2, 3]), name);
    expect(res).toEqual({ known: true, pages: 1, source: "image" });
  });

  it("counts a .docx from its metadata", async () => {
    const res = await countDocumentPages(makeOoxml("Pages", 6), "essay.docx");
    expect(res).toEqual({ known: true, pages: 6, source: "docx" });
  });

  it("counts a .pptx from its metadata", async () => {
    const res = await countDocumentPages(makeOoxml("Slides", 20), "deck.pptx");
    expect(res).toEqual({ known: true, pages: 20, source: "pptx" });
  });

  // Unknown must stay unknown — guessing 1 is what caused the underbilling.
  it("reports unknown for legacy .doc and .ppt", async () => {
    for (const name of ["old.doc", "old.ppt"]) {
      const res = await countDocumentPages(new Uint8Array([1]), name);
      expect(res.known).toBe(false);
      if (!res.known) expect(res.reason).toMatch(/Save as PDF|page count/i);
    }
  });

  it("reports unknown for a .docx with no metadata instead of guessing", async () => {
    const zip = zipSync({ "word/document.xml": strToU8("<w:document/>") });
    const res = await countDocumentPages(zip, "essay.docx");
    expect(res.known).toBe(false);
  });

  it("surfaces the encrypted-PDF error", async () => {
    // Force the encrypted branch through a doc that declares /Encrypt.
    const bytes = strToU8("%PDF-1.4\n/Encrypt 1 0 R\ntrailer<</Encrypt 1 0 R>>");
    await expect(countDocumentPages(bytes, "locked.pdf")).rejects.toThrow();
  });
});

describe("extensionOf", () => {
  it("lowercases and includes the dot", () => {
    expect(extensionOf("Report.PDF")).toBe(".pdf");
    expect(extensionOf("my.file.name.docx")).toBe(".docx");
  });

  it("returns empty string when there is no extension", () => {
    expect(extensionOf("README")).toBe("");
  });
});

describe("EncryptedPdfError", () => {
  it("explains what the customer should do", () => {
    expect(new EncryptedPdfError().message).toMatch(/password/i);
  });
});

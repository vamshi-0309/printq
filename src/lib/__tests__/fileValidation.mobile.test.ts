import { describe, it, expect } from "vitest";
import {
  validateFile,
  isMimeAcceptableFor,
  ACCEPT_ATTRIBUTE,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE_BYTES,
} from "../fileValidation";

/**
 * Regression tests for the mobile upload failure.
 *
 * The picker opened, a file was chosen, and nothing happened. The cause was
 * the MIME check: it required an exact match against a fixed list, but
 * Android's document picker and cloud providers (Drive, OneDrive) routinely
 * hand over a File whose `type` is the empty string, and some Android builds
 * report the non-standard "image/jpg". Every one of those was rejected
 * client-side before an upload request was ever made.
 */

const KB = 1024;

describe("empty MIME type — the actual mobile failure", () => {
  // These are the exact cases that used to fail.
  it.each([
    ["assignment.pdf"],
    ["photo.jpg"],
    ["photo.jpeg"],
    ["scan.png"],
    ["essay.docx"],
    ["deck.pptx"],
    ["notes.doc"],
    ["slides.ppt"],
  ])("accepts %s when the browser reports no MIME type", (filename) => {
    const result = validateFile(filename, "", 12 * KB);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("accepts a generic binary MIME type", () => {
    expect(validateFile("assignment.pdf", "application/octet-stream", KB).ok).toBe(true);
    expect(validateFile("essay.docx", "binary/octet-stream", KB).ok).toBe(true);
  });

  it("accepts the non-standard image/jpg some Android builds send", () => {
    expect(validateFile("photo.jpg", "image/jpg", KB).ok).toBe(true);
  });

  it("accepts OOXML reported as its zip container", () => {
    // Android pickers commonly fall back to the container type.
    expect(validateFile("essay.docx", "application/zip", KB).ok).toBe(true);
    expect(validateFile("deck.pptx", "application/x-zip-compressed", KB).ok).toBe(true);
  });

  it("is case-insensitive about the extension", () => {
    expect(validateFile("SCAN.PNG", "", KB).ok).toBe(true);
    expect(validateFile("Report.PDF", "APPLICATION/PDF".toLowerCase(), KB).ok).toBe(true);
  });
});

describe("desktop MIME types still work", () => {
  it.each([
    ["doc.pdf", "application/pdf"],
    ["photo.jpg", "image/jpeg"],
    ["scan.png", "image/png"],
    ["old.doc", "application/msword"],
    [
      "essay.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    ["slides.ppt", "application/vnd.ms-powerpoint"],
    [
      "deck.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  ])("accepts %s as %s", (name, mime) => {
    expect(validateFile(name, mime, KB).ok).toBe(true);
  });
});

describe("genuinely wrong files are still refused", () => {
  it("rejects a disallowed extension", () => {
    expect(validateFile("virus.exe", "application/x-msdownload", KB).ok).toBe(false);
    expect(validateFile("archive.zip", "application/zip", KB).ok).toBe(false);
  });

  it("rejects a file with no extension", () => {
    const r = validateFile("README", "", KB);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no extension/i);
  });

  it("rejects a MIME that positively contradicts the extension", () => {
    // Not merely unknown — actively a different, unsupported type.
    const r = validateFile("notreally.pdf", "application/x-msdownload", KB);
    expect(r.ok).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(validateFile("doc.pdf", "application/pdf", 0).ok).toBe(false);
  });

  it("rejects a file over the size limit", () => {
    const r = validateFile("doc.pdf", "application/pdf", MAX_FILE_SIZE_BYTES + 1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too large/i);
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateFile("doc.pdf", "application/pdf", MAX_FILE_SIZE_BYTES).ok).toBe(true);
  });
});

describe("isMimeAcceptableFor", () => {
  it("treats absent and uninformative values as unknown, not wrong", () => {
    for (const mime of ["", "   ", "application/octet-stream", "*/*", null, undefined]) {
      expect(isMimeAcceptableFor(".pdf", mime)).toBe(true);
    }
  });

  it("rejects an unrelated concrete type", () => {
    expect(isMimeAcceptableFor(".pdf", "video/mp4")).toBe(false);
  });

  it("rejects an unknown extension outright", () => {
    expect(isMimeAcceptableFor(".exe", "")).toBe(false);
  });
});

describe("ACCEPT_ATTRIBUTE (mobile picker filter)", () => {
  it("lists every allowed extension", () => {
    for (const ext of ALLOWED_EXTENSIONS) {
      expect(ACCEPT_ATTRIBUTE).toContain(ext);
    }
  });

  // Extensions alone make Android's picker grey out every file.
  it("also lists MIME types so Android can filter", () => {
    expect(ACCEPT_ATTRIBUTE).toContain("application/pdf");
    expect(ACCEPT_ATTRIBUTE).toContain("image/jpeg");
    expect(ACCEPT_ATTRIBUTE).toContain(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  });

  it("contains no duplicates", () => {
    const parts = ACCEPT_ATTRIBUTE.split(",");
    expect(new Set(parts).size).toBe(parts.length);
  });
});

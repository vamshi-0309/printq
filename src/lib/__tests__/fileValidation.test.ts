import { describe, it, expect } from "vitest";
import { validateFile, fileCategory } from "../fileValidation";

describe("validateFile", () => {
  it("accepts a normal PDF", () => {
    expect(validateFile("doc.pdf", "application/pdf", 1024).ok).toBe(true);
  });

  it("accepts a DOCX", () => {
    expect(validateFile("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 5000).ok).toBe(true);
  });

  it("accepts a JPG", () => {
    expect(validateFile("photo.jpg", "image/jpeg", 2000).ok).toBe(true);
  });

  it("rejects an .exe regardless of MIME", () => {
    expect(validateFile("virus.exe", "application/pdf", 1024).ok).toBe(false);
  });

  it("rejects a file over 50MB", () => {
    expect(validateFile("huge.pdf", "application/pdf", 60 * 1024 * 1024).ok).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(validateFile("empty.pdf", "application/pdf", 0).ok).toBe(false);
  });

  it("rejects mismatched MIME (renamed exe to pdf)", () => {
    expect(validateFile("trick.pdf", "application/x-msdos-program", 1024).ok).toBe(false);
  });
});

describe("fileCategory", () => {
  it("classifies correctly", () => {
    expect(fileCategory(".pdf")).toBe("pdf");
    expect(fileCategory(".DOCX")).toBe("office");
    expect(fileCategory(".pptx")).toBe("office");
    expect(fileCategory(".jpg")).toBe("image");
    expect(fileCategory(".zip")).toBe("unknown");
  });
});

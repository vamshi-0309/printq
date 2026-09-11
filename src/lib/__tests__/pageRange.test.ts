import { describe, it, expect } from "vitest";
import { parsePageRange } from "../pageRange";

describe("parsePageRange", () => {
  it("parses a simple range", () => {
    const r = parsePageRange("1-5", 10);
    expect(r).toEqual({ ok: true, pages: [1, 2, 3, 4, 5] });
  });

  it("parses a comma list", () => {
    const r = parsePageRange("3,5,7", 10);
    expect(r).toEqual({ ok: true, pages: [3, 5, 7] });
  });

  it("parses a mix of ranges and singles, de-duplicated and sorted", () => {
    const r = parsePageRange("2-8,10,7,12-14", 20);
    expect(r).toEqual({ ok: true, pages: [2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14] });
  });

  it("rejects a page beyond the document length", () => {
    const r = parsePageRange("1-5", 3);
    expect(r.ok).toBe(false);
  });

  it("rejects a backwards range", () => {
    const r = parsePageRange("8-3", 10);
    expect(r.ok).toBe(false);
  });

  it("rejects zero and negative pages", () => {
    expect(parsePageRange("0-3", 10).ok).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(parsePageRange("abc", 10).ok).toBe(false);
    expect(parsePageRange("", 10).ok).toBe(false);
    expect(parsePageRange("1--3", 10).ok).toBe(false);
  });

  it("rejects a zero-page document", () => {
    expect(parsePageRange("1", 0).ok).toBe(false);
  });
});

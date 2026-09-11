import { describe, it, expect } from "vitest";
import { pagesToRangeString } from "../pdfPreview";
import { parsePageRange } from "../pageRange";

/**
 * `pagesToRangeString` is the inverse of `parsePageRange`: the page picker
 * turns tapped thumbnails into the string the server parses. If the two ever
 * disagree, a customer is charged for pages they did not select, so the
 * round-trip is asserted directly.
 */

describe("pagesToRangeString", () => {
  it("collapses runs into ranges", () => {
    expect(pagesToRangeString([1, 2, 3])).toBe("1-3");
  });

  it("keeps isolated pages separate", () => {
    expect(pagesToRangeString([1, 3, 5])).toBe("1,3,5");
  });

  it("mixes runs and single pages", () => {
    expect(pagesToRangeString([1, 2, 3, 7, 10, 11, 12])).toBe("1-3,7,10-12");
  });

  it("sorts and de-duplicates", () => {
    expect(pagesToRangeString([5, 1, 3, 1, 2])).toBe("1-3,5");
  });

  it("handles a single page", () => {
    expect(pagesToRangeString([4])).toBe("4");
  });

  it("returns empty for no pages", () => {
    expect(pagesToRangeString([])).toBe("");
  });
});

describe("round-trip with parsePageRange", () => {
  const cases: number[][] = [
    [1],
    [1, 2, 3],
    [2, 4, 6, 8],
    [1, 2, 3, 7, 10, 11, 12],
    [9, 8, 7, 1],
    Array.from({ length: 50 }, (_, i) => i + 1),
  ];

  it.each(cases)("survives a round trip: %s", (...pages) => {
    const list = pages.flat();
    const total = Math.max(...list);
    const str = pagesToRangeString(list);
    const parsed = parsePageRange(str, total);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.pages).toEqual([...new Set(list)].sort((a, b) => a - b));
    }
  });
});

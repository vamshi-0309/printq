import { describe, it, expect } from "vitest";
import { calculatePrice, PricingError, type ShopPricingConfig } from "../pricing";
import { resolvePageColors, parsePageRange, MAX_COLOR_RANGES } from "../pageRange";

/**
 * Per-range colour: some pages colour, the rest black & white.
 *
 * The one result from resolvePageColors both prices the order and tells the
 * agent which pages to print in which mode, so these tests check the two
 * agree: the pages billed as colour are exactly the pages the segments print
 * in colour.
 */

const config: ShopPricingConfig = {
  a4BwPerPage: 1,
  a4ColorPerPage: 5,
  a3BwPerPage: 2,
  a3ColorPerPage: 8,
  duplexDiscountPercent: 10,
  minimumOrderAmount: 5,
  enabledPaperSizes: ["A4", "A3"],
};

const all = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("resolvePageColors", () => {
  it("with no overrides, every page is the default mode in one pass", () => {
    const r = resolvePageColors(all(8), 8, "bw", null);
    expect(r.ok && r.segments).toEqual([{ pageRange: "1-8", colorMode: "bw" }]);
    expect(r.ok && r.normalized).toBeNull();
  });

  it("splits into page-ordered passes around a colour section", () => {
    const r = resolvePageColors(all(8), 8, "bw", [{ range: "4-5", mode: "color" }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.colorPages).toEqual([4, 5]);
    expect(r.bwPages).toEqual([1, 2, 3, 6, 7, 8]);
    expect(r.segments).toEqual([
      { pageRange: "1-3", colorMode: "bw" },
      { pageRange: "4-5", colorMode: "color" },
      { pageRange: "6-8", colorMode: "bw" },
    ]);
  });

  it("ignores colour on pages that are not being printed", () => {
    const selected = [1, 2, 3];
    const r = resolvePageColors(selected, 10, "bw", [{ range: "3-9", mode: "color" }]);
    if (!r.ok) throw new Error(r.error);
    expect(r.colorPages).toEqual([3]);
    expect(r.normalized).toEqual([{ range: "3", mode: "color" }]);
  });

  it("validates overrides against the real page count", () => {
    const r = resolvePageColors(all(5), 5, "bw", [{ range: "4-9", mode: "color" }]);
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown mode", () => {
    const r = resolvePageColors(all(5), 5, "bw", [{ range: "1", mode: "sepia" as never }]);
    expect(r.ok).toBe(false);
  });

  it("caps the number of overrides", () => {
    const many = Array.from({ length: MAX_COLOR_RANGES + 1 }, () => ({ range: "1", mode: "color" as const }));
    expect(resolvePageColors(all(5), 5, "bw", many).ok).toBe(false);
  });

  it("stores nothing when an override does not change any page", () => {
    const r = resolvePageColors(all(5), 5, "color", [{ range: "1-5", mode: "color" }]);
    expect(r.ok && r.normalized).toBeNull();
  });

  it("normalises an order that ends up all-colour from a bw default", () => {
    const r = resolvePageColors(all(3), 3, "bw", [{ range: "1-3", mode: "color" }]);
    expect(r.ok && r.normalized).toEqual([{ range: "1-3", mode: "color" }]);
    expect(r.ok && r.segments).toEqual([{ pageRange: "1-3", colorMode: "color" }]);
  });

  it("segments cover each selected page exactly once", () => {
    const selected = [1, 2, 5, 6, 7, 10];
    const r = resolvePageColors(selected, 10, "color", [
      { range: "2", mode: "bw" },
      { range: "6-7", mode: "bw" },
    ]);
    if (!r.ok) throw new Error(r.error);
    const covered = r.segments.flatMap((s) => {
      const p = parsePageRange(s.pageRange, 10);
      return p.ok ? p.pages : [];
    });
    expect(covered.sort((a, b) => a - b)).toEqual(selected);
  });
});

describe("mixed-colour pricing", () => {
  it("bills each page at its own rate", () => {
    // 6 B&W at ₹1 + 2 colour at ₹5 = ₹16 per copy.
    const b = calculatePrice(
      { pageCount: 8, colorPageCount: 2, copies: 1, colorMode: "bw", paperSize: "A4", sides: "single" },
      config
    );
    expect(b.subtotal).toBe(16);
    expect(b.total).toBe(16);
    expect(b.mixed).toEqual({ bwPages: 6, colorPages: 2, bwRate: 1, colorRate: 5 });
  });

  it("multiplies by copies", () => {
    const b = calculatePrice(
      { pageCount: 8, colorPageCount: 2, copies: 3, colorMode: "bw", paperSize: "A4", sides: "single" },
      config
    );
    expect(b.total).toBe(48);
    expect(b.effectivePages).toBe(24);
  });

  it("uses A3 rates on A3", () => {
    const b = calculatePrice(
      { pageCount: 4, colorPageCount: 1, copies: 1, colorMode: "bw", paperSize: "A3", sides: "single" },
      config
    );
    expect(b.total).toBe(3 * 2 + 1 * 8);
  });

  it("applies the duplex discount to the mixed subtotal", () => {
    const b = calculatePrice(
      { pageCount: 10, colorPageCount: 5, copies: 2, colorMode: "bw", paperSize: "A4", sides: "double" },
      config
    );
    // (5×1 + 5×5) × 2 = 60, 10% off = 54
    expect(b.subtotal).toBe(60);
    expect(b.duplexDiscount).toBe(6);
    expect(b.total).toBe(54);
  });

  it("applies the shop minimum", () => {
    const b = calculatePrice(
      { pageCount: 2, colorPageCount: 0, copies: 1, colorMode: "color", paperSize: "A4", sides: "single" },
      config
    );
    // An explicit 0 means all B&W regardless of colorMode: ₹2, raised to ₹5.
    expect(b.total).toBe(5);
    expect(b.minimumApplied).toBe(true);
  });

  it("prices all-colour and all-B&W exactly like a single-mode order", () => {
    const base = { pageCount: 7, copies: 2, paperSize: "A4" as const, sides: "single" as const };
    expect(calculatePrice({ ...base, colorPageCount: 7, colorMode: "bw" }, config).total).toBe(
      calculatePrice({ ...base, colorMode: "color" }, config).total
    );
    expect(calculatePrice({ ...base, colorPageCount: 0, colorMode: "color" }, config).total).toBe(
      calculatePrice({ ...base, colorMode: "bw" }, config).total
    );
  });

  it("rejects a colour count larger than the order", () => {
    expect(() =>
      calculatePrice(
        { pageCount: 3, colorPageCount: 4, copies: 1, colorMode: "bw", paperSize: "A4", sides: "single" },
        config
      )
    ).toThrow(PricingError);
  });

  it("bills exactly the pages the agent will print in colour", () => {
    const r = resolvePageColors(all(12), 12, "bw", [
      { range: "1", mode: "color" },
      { range: "10-12", mode: "color" },
    ]);
    if (!r.ok) throw new Error(r.error);
    const b = calculatePrice(
      {
        pageCount: 12,
        colorPageCount: r.colorPages.length,
        copies: 1,
        colorMode: "bw",
        paperSize: "A4",
        sides: "single",
      },
      config
    );
    const printedInColour = r.segments
      .filter((s) => s.colorMode === "color")
      .flatMap((s) => {
        const p = parsePageRange(s.pageRange, 12);
        return p.ok ? p.pages : [];
      });
    expect(printedInColour.length).toBe(b.mixed?.colorPages);
    expect(b.total).toBe(8 * 1 + 4 * 5);
  });
});

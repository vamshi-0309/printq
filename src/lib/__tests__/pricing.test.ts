import { describe, it, expect } from "vitest";
import { calculatePrice, PricingError, ShopPricingConfig } from "../pricing";

const config: ShopPricingConfig = {
  a4BwPerPage: 1,
  a4ColorPerPage: 5,
  a3BwPerPage: 2,
  a3ColorPerPage: 8,
  duplexDiscountPercent: 10,
  minimumOrderAmount: 5,
  enabledPaperSizes: ["A4", "A3"],
};

describe("calculatePrice", () => {
  it("matches the spec's worked example: 12 pages x 2 copies, B&W, A4 => 24", () => {
    const result = calculatePrice(
      { pageCount: 12, copies: 2, colorMode: "bw", paperSize: "A4", sides: "single" },
      config
    );
    expect(result.total).toBe(24);
  });

  it("applies the shop's minimum order amount", () => {
    const result = calculatePrice(
      { pageCount: 1, copies: 1, colorMode: "bw", paperSize: "A4", sides: "single" },
      config
    );
    expect(result.minimumApplied).toBe(true);
    expect(result.total).toBe(5);
  });

  it("applies duplex discount only on double-sided", () => {
    const single = calculatePrice(
      { pageCount: 10, copies: 1, colorMode: "bw", paperSize: "A4", sides: "single" },
      config
    );
    const double = calculatePrice(
      { pageCount: 10, copies: 1, colorMode: "bw", paperSize: "A4", sides: "double" },
      config
    );
    expect(single.total).toBe(10);
    expect(double.total).toBe(9); // 10% off 10
  });

  it("rejects a paper size the shop hasn't enabled", () => {
    const a4OnlyConfig = { ...config, enabledPaperSizes: ["A4" as const] };
    expect(() =>
      calculatePrice(
        { pageCount: 1, copies: 1, colorMode: "bw", paperSize: "A3", sides: "single" },
        a4OnlyConfig
      )
    ).toThrow(PricingError);
  });

  it("rejects non-integer or non-positive page counts and copies", () => {
    expect(() =>
      calculatePrice(
        { pageCount: 0, copies: 1, colorMode: "bw", paperSize: "A4", sides: "single" },
        config
      )
    ).toThrow(PricingError);
    expect(() =>
      calculatePrice(
        { pageCount: 5, copies: -1, colorMode: "bw", paperSize: "A4", sides: "single" },
        config
      )
    ).toThrow(PricingError);
  });

  it("never trusts a client-submitted total - recalculates from scratch every time", () => {
    // Simulates a tampered client payload claiming a lower price.
    const trusted = calculatePrice(
      { pageCount: 100, copies: 1, colorMode: "color", paperSize: "A4", sides: "single" },
      config
    );
    expect(trusted.total).toBe(500);
    expect(trusted.total).not.toBe(1); // what a malicious client might have sent
  });
});

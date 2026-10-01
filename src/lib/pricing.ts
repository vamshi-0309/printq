/**
 * Price calculation.
 *
 * IMPORTANT: this module runs on the server as the source of truth.
 * The client may call the same function to preview a price, but the
 * order is only ever priced from a server-side call using the shop's
 * stored pricing config and the *actual* page count of the converted
 * file - never from a number the browser sends.
 */

export type ColorMode = "bw" | "color";
export type PaperSize = "A4" | "A3";
export type Sides = "single" | "double";

export interface ShopPricingConfig {
  a4BwPerPage: number; // paise or integer rupees - keep consistent app-wide (this app uses integer rupees)
  a4ColorPerPage: number;
  a3BwPerPage: number;
  a3ColorPerPage: number;
  duplexDiscountPercent: number; // e.g. 10 means double-sided is 10% cheaper per side-page
  minimumOrderAmount: number;
  enabledPaperSizes: PaperSize[];
}

export interface PriceLineInput {
  pageCount: number;
  copies: number;
  colorMode: ColorMode;
  paperSize: PaperSize;
  sides: Sides;
  /**
   * How many of `pageCount` print in colour, when the order mixes colour and
   * black & white (orders.color_ranges). The rest are black & white, and
   * `colorMode` is ignored. Omitted for a single-mode order, which prices
   * exactly as before.
   */
  colorPageCount?: number;
}

export interface PriceBreakdown {
  perPageRate: number;
  effectivePages: number; // pageCount * copies, adjusted for duplex counting
  subtotal: number;
  duplexDiscount: number;
  total: number;
  minimumApplied: boolean;
  /** Present only on a mixed order: the split that was priced. */
  mixed?: {
    bwPages: number;
    colorPages: number;
    bwRate: number;
    colorRate: number;
  };
}

export class PricingError extends Error {}

export function calculatePrice(
  input: PriceLineInput,
  config: ShopPricingConfig
): PriceBreakdown {
  const { pageCount, copies, colorMode, paperSize, sides } = input;

  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new PricingError("Page count must be a positive integer.");
  }
  if (!Number.isInteger(copies) || copies < 1) {
    throw new PricingError("Copies must be a positive integer.");
  }
  if (!config.enabledPaperSizes.includes(paperSize)) {
    throw new PricingError(`${paperSize} is not offered by this shop.`);
  }

  const rateFor = (mode: ColorMode) => {
    const rate =
      paperSize === "A4"
        ? mode === "bw"
          ? config.a4BwPerPage
          : config.a4ColorPerPage
        : mode === "bw"
        ? config.a3BwPerPage
        : config.a3ColorPerPage;
    if (rate == null || rate < 0 || !Number.isFinite(rate)) {
      throw new PricingError("This shop hasn't configured a price for that option.");
    }
    return rate;
  };

  const totalSheets = pageCount * copies;

  let perPageRate: number;
  let subtotalBeforeDuplex: number;
  let mixed: PriceBreakdown["mixed"];

  const colorPages = input.colorPageCount;
  if (colorPages !== undefined && colorPages > 0 && colorPages < pageCount) {
    if (!Number.isInteger(colorPages)) {
      throw new PricingError("Colour page count must be a whole number.");
    }
    const bwRate = rateFor("bw");
    const colorRate = rateFor("color");
    const bwPages = pageCount - colorPages;
    subtotalBeforeDuplex = (bwPages * bwRate + colorPages * colorRate) * copies;
    // The blended figure, for displays that show one rate.
    perPageRate = subtotalBeforeDuplex / totalSheets;
    mixed = { bwPages, colorPages, bwRate, colorRate };
  } else {
    if (colorPages !== undefined && (colorPages < 0 || colorPages > pageCount)) {
      throw new PricingError("Colour page count is out of range.");
    }
    // Every page one mode: an explicit count of 0 or all pages decides it.
    const mode: ColorMode =
      colorPages === undefined ? colorMode : colorPages === 0 ? "bw" : "color";
    perPageRate = rateFor(mode);
    subtotalBeforeDuplex = totalSheets * perPageRate;
  }

  let duplexDiscount = 0;
  if (sides === "double" && config.duplexDiscountPercent > 0) {
    duplexDiscount = Math.round(
      subtotalBeforeDuplex * (config.duplexDiscountPercent / 100)
    );
  }

  const subtotal = subtotalBeforeDuplex;
  let total = subtotal - duplexDiscount;

  let minimumApplied = false;
  if (total < config.minimumOrderAmount) {
    total = config.minimumOrderAmount;
    minimumApplied = true;
  }

  return {
    perPageRate,
    effectivePages: totalSheets,
    subtotal,
    duplexDiscount,
    total,
    minimumApplied,
    ...(mixed ? { mixed } : {}),
  };
}

/**
 * Recompute and verify a price the client claims, for use right before
 * creating a payment request. Returns the trusted breakdown regardless
 * of what the client sent - callers should always use this return value,
 * never the client-submitted amount, when creating the payment request.
 */
export function verifyOrRecalculate(
  clientClaimedTotal: number,
  input: PriceLineInput,
  config: ShopPricingConfig
): { trusted: PriceBreakdown; matchedClientAmount: boolean } {
  const trusted = calculatePrice(input, config);
  return {
    trusted,
    matchedClientAmount: trusted.total === clientClaimedTotal,
  };
}

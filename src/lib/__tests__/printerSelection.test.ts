import { describe, it, expect } from "vitest";
import { selectPrinterForShop, printerBelongsToShop, type ShopPrinterRow } from "../printerSelection";

/**
 * The shop owner's printer choice must be the one that gets used, and when
 * there is no usable choice nothing may be substituted for it.
 *
 * The bug: the dashboard let an owner mark a printer as the PrintQ default,
 * and that choice reached nothing. The agent called
 * win32print.GetDefaultPrinter() — the machine's own default, a different
 * setting entirely — so a shop that selected "Export to WPS PDF" had its jobs
 * sent to whatever Windows preferred, silently.
 */

const SHOP_A = "shop-a";
const SHOP_B = "shop-b";

function printer(overrides: Partial<ShopPrinterRow> = {}): ShopPrinterRow {
  return {
    id: "p1",
    shop_id: SHOP_A,
    system_name: "Microsoft Print to PDF",
    display_name: "Microsoft Print to PDF",
    is_default: false,
    is_enabled: true,
    supports_color: false,
    supports_duplex: false,
    ...overrides,
  };
}

/** The real rows from this machine, as the agent reported them. */
const REAL_PRINTERS: ShopPrinterRow[] = [
  printer({ id: "a1", system_name: "OneNote (Desktop) - Protected", display_name: "OneNote (Desktop) - Protected" }),
  printer({ id: "a2", system_name: "OneNote (Desktop)", display_name: "OneNote (Desktop)" }),
  printer({ id: "a3", system_name: "Microsoft Print to PDF", display_name: "Microsoft Print to PDF" }),
  printer({ id: "a4", system_name: "Export to WPS PDF", display_name: "Export to WPS PDF", is_default: true }),
];

describe("the owner's selection is what gets returned", () => {
  it("returns the printer marked default", () => {
    const result = selectPrinterForShop(REAL_PRINTERS, SHOP_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.printer.id).toBe("a4");
    expect(result.printer.systemName).toBe("Export to WPS PDF");
  });

  it("does NOT return the printer Windows would consider default", () => {
    // "Microsoft Print to PDF" is this machine's Windows default. The shop
    // chose something else, and the shop's choice must win.
    const result = selectPrinterForShop(REAL_PRINTERS, SHOP_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.printer.systemName).not.toBe("Microsoft Print to PDF");
  });

  it("carries the exact Windows name and the persisted id", () => {
    const result = selectPrinterForShop(REAL_PRINTERS, SHOP_A);
    if (!result.ok) throw new Error("expected a selection");
    expect(result.printer.systemName).toBe("Export to WPS PDF");
    expect(result.printer.id).toBe("a4");
    expect(result.printer.displayName).toBe("Export to WPS PDF");
  });

  it("passes capabilities through as booleans", () => {
    const result = selectPrinterForShop(
      [printer({ is_default: true, supports_color: true, supports_duplex: true })],
      SHOP_A
    );
    if (!result.ok) throw new Error("expected a selection");
    expect(result.printer.supportsColor).toBe(true);
    expect(result.printer.supportsDuplex).toBe(true);
  });

  it("follows the owner when they change the default", () => {
    const moved = REAL_PRINTERS.map((p) => ({ ...p, is_default: p.id === "a2" }));
    const result = selectPrinterForShop(moved, SHOP_A);
    if (!result.ok) throw new Error("expected a selection");
    expect(result.printer.systemName).toBe("OneNote (Desktop)");
  });
});

describe("shop isolation", () => {
  it("never selects another shop's printer", () => {
    // Shop A has nothing; shop B has a perfectly good default. A must get
    // nothing rather than B's device.
    const rows = [printer({ id: "b1", shop_id: SHOP_B, is_default: true })];
    const result = selectPrinterForShop(rows, SHOP_A);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_printer_detected");
  });

  it("ignores foreign rows mixed into the list", () => {
    const rows = [
      printer({ id: "b1", shop_id: SHOP_B, is_default: true, system_name: "SHOP B PRINTER" }),
      printer({ id: "a4", is_default: true, system_name: "Export to WPS PDF" }),
    ];
    const result = selectPrinterForShop(rows, SHOP_A);
    if (!result.ok) throw new Error("expected a selection");
    expect(result.printer.id).toBe("a4");
    expect(result.printer.systemName).toBe("Export to WPS PDF");
  });

  it("does not fall back to a foreign default when the shop's own is disabled", () => {
    const rows = [
      printer({ id: "b1", shop_id: SHOP_B, is_default: true, system_name: "SHOP B PRINTER" }),
      printer({ id: "a4", is_default: true, is_enabled: false }),
    ];
    const result = selectPrinterForShop(rows, SHOP_A);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("default_printer_disabled");
  });
});

describe("no usable printer is never papered over", () => {
  it("reports no_printer_detected when the shop has none at all", () => {
    const result = selectPrinterForShop([], SHOP_A);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_printer_detected");
    expect(result.message).toMatch(/agent is running/i);
  });

  it("reports no_printer_configured when printers exist but none is chosen", () => {
    const none = REAL_PRINTERS.map((p) => ({ ...p, is_default: false }));
    const result = selectPrinterForShop(none, SHOP_A);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("no_printer_configured");
    expect(result.message).toMatch(/Dashboard/);
  });

  it("never silently picks an enabled printer when none is the default", () => {
    // Four perfectly usable printers, none chosen: still nothing.
    const none = REAL_PRINTERS.map((p) => ({ ...p, is_default: false }));
    const result = selectPrinterForShop(none, SHOP_A);
    expect(result.ok).toBe(false);
  });

  it("reports default_printer_disabled when the chosen one is switched off", () => {
    const disabled = REAL_PRINTERS.map((p) => (p.id === "a4" ? { ...p, is_enabled: false } : p));
    const result = selectPrinterForShop(disabled, SHOP_A);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("default_printer_disabled");
  });

  it("does not switch to another enabled printer when the default is off", () => {
    // Three other printers are enabled and ready. None may be substituted.
    const disabled = REAL_PRINTERS.map((p) => (p.id === "a4" ? { ...p, is_enabled: false } : p));
    const result = selectPrinterForShop(disabled, SHOP_A);
    expect(result.ok).toBe(false);
  });

  it("gives every failure a message aimed at the owner", () => {
    for (const rows of [[], REAL_PRINTERS.map((p) => ({ ...p, is_default: false }))]) {
      const result = selectPrinterForShop(rows, SHOP_A);
      if (result.ok) continue;
      expect(result.message.length).toBeGreaterThan(20);
    }
  });
});

describe("printerBelongsToShop", () => {
  it("accepts a printer the shop owns", () => {
    expect(printerBelongsToShop(REAL_PRINTERS, "a4", SHOP_A)).toBe(true);
  });

  it("rejects a printer belonging to another shop", () => {
    const rows = [{ id: "b1", shop_id: SHOP_B }];
    expect(printerBelongsToShop(rows, "b1", SHOP_A)).toBe(false);
  });

  it("rejects an unknown id", () => {
    expect(printerBelongsToShop(REAL_PRINTERS, "does-not-exist", SHOP_A)).toBe(false);
  });

  it("rejects against an empty list", () => {
    expect(printerBelongsToShop([], "a4", SHOP_A)).toBe(false);
  });
});

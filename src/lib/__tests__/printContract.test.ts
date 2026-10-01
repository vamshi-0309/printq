import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  agentVersionOutdated,
  missingCapabilities,
  parseCapabilities,
  printSettingsFor,
  requiredCapabilities,
  type OrderPrintFields,
} from "../printSettings";
import { priceSpec } from "../orderEdit";

/**
 * The web half of the print-settings contract. The agent half is
 * agent/test_print_contract.py, reading the same file: together they pin
 * that what the server sends is what the agent prints, and what is printed
 * is what was billed.
 */

const contract = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../../agent/print_settings_contract.json"), "utf8")
) as {
  knownSettingKeys: string[];
  cases: {
    name: string;
    documentPages: number;
    order: OrderPrintFields;
    printSettings: Record<string, unknown>;
    requiredCapabilities: string[];
    billedPages: number;
  }[];
};

const config = {
  a4BwPerPage: 1,
  a4ColorPerPage: 5,
  a3BwPerPage: 2,
  a3ColorPerPage: 8,
  duplexDiscountPercent: 0,
  minimumOrderAmount: 0,
  enabledPaperSizes: ["A4", "A3"] as ("A4" | "A3")[],
};

describe.each(contract.cases)("$name", (c) => {
  it("the server sends exactly the contracted settings", () => {
    expect(printSettingsFor(c.order)).toEqual(c.printSettings);
  });

  it("sends no setting the agent doesn't know", () => {
    for (const key of Object.keys(printSettingsFor(c.order))) {
      expect(contract.knownSettingKeys, key).toContain(key);
    }
  });

  it("requires exactly the contracted capabilities", () => {
    expect(requiredCapabilities(printSettingsFor(c.order)).sort()).toEqual([...c.requiredCapabilities].sort());
  });

  it("bills the pages the agent prints", () => {
    const priced = priceSpec(
      {
        copies: c.order.copies,
        colorMode: c.order.color_mode as "bw" | "color",
        paperSize: c.order.paper_size as "A4" | "A3",
        sides: c.order.sides as "single" | "double",
        orientation: (c.order.orientation ?? "auto") as "auto",
        pageRange: c.order.page_range ?? "all",
        colorRanges: c.order.color_ranges,
        fitMode: (c.order.fit_mode ?? "fit") as "fit",
      },
      c.documentPages,
      config
    );
    if (!priced.ok) throw new Error(priced.error);
    expect(priced.breakdown.effectivePages).toBe(c.billedPages);
    // And it stores the same selection the agent is sent.
    expect(priced.storedRange).toBe(c.printSettings.pageRange);
  });

  it("a v1.0.0 agent (no capabilities) is never given it", () => {
    expect(missingCapabilities(printSettingsFor(c.order), parseCapabilities(null)).length).toBeGreaterThan(0);
  });

  it("a v1.1.0 agent can print it", () => {
    const v110 = parseCapabilities("color-segments,fit-mode,orientation");
    expect(missingCapabilities(printSettingsFor(c.order), v110)).toEqual([]);
  });
});

describe("agent versions", () => {
  it.each([
    ["1.0.0", true],
    ["1.0.9", true],
    ["1.1.0", false],
    ["1.2.0", false],
    ["2.0.0", false],
    ["unknown", true],
    [null, true],
  ])("%s outdated: %s", (v, expected) => {
    expect(agentVersionOutdated(v)).toBe(expected);
  });
});

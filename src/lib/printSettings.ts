import { parsePageRange, resolvePageColors, type ColorRange, type PrintSegment } from "./pageRange";

/**
 * The print settings sent to the agent, and what an agent must be able to do
 * to honour them.
 *
 * One definition, used by the claim route and checked against the agent by
 * a shared contract (agent/print_settings_contract.json, read by both the
 * Vitest and the Python test suites), so the web app and the agent cannot
 * drift apart on what a setting means.
 *
 * WHY CAPABILITIES
 * PrintQ Agent 1.0.0 knows copies, page range, sides, colour and paper. It
 * ignores orientation, fit/actual size and per-range colour: it would print
 * such a job with SumatraPDF's defaults (automatic orientation, "shrink"
 * scaling, one colour mode for every page) — silently different from what
 * the customer chose and was billed for. Agents from 1.1.0 announce what they
 * support in the X-PrintQ-Capabilities header; a job is only ever handed to
 * an agent that announces everything the job needs. Otherwise it stays in
 * the queue and the agent is told to update.
 */

export const CAPABILITY = {
  colorSegments: "color-segments",
  fitMode: "fit-mode",
  orientation: "orientation",
} as const;

/** The first agent version that announces every capability above. */
export const MIN_AGENT_VERSION = "1.1.0";

export interface OrderPrintFields {
  color_mode: string;
  paper_size: string;
  orientation: string | null;
  sides: string;
  copies: number;
  page_range: string | null;
  page_count: number | null;
  color_ranges: ColorRange[] | null;
  fit_mode: string | null;
}

export interface PrintSettings {
  colorMode: string;
  paperSize: string;
  orientation: string;
  sides: string;
  copies: number;
  pageRange: string;
  pageCount: number | null;
  /** "fit" scales each page to the paper; "actual" prints at 100%. */
  fitMode: "fit" | "actual";
  /** Mixed colour only: print these passes in order instead of one. */
  colorSegments: PrintSegment[] | null;
}

/**
 * The passes the agent makes for a mixed-colour order: each page range with
 * its own colour setting, in page order. Null for a single-mode order.
 * Derived from the same resolvePageColors that priced the order, so what
 * prints in colour is what was billed as colour.
 */
export function colorSegmentsFor(order: OrderPrintFields): PrintSegment[] | null {
  if (!order.color_ranges || order.color_ranges.length === 0) return null;
  const range = order.page_range ?? "all";
  const numbers = (range.match(/\d+/g) ?? []).map(Number);
  const documentPages =
    range === "all" ? (order.page_count ?? 0) : Math.max(order.page_count ?? 0, ...numbers);
  const selected = parsePageRange(range === "all" ? `1-${documentPages}` : range, documentPages);
  if (!selected.ok) return null;
  const colors = resolvePageColors(
    selected.pages,
    documentPages,
    order.color_mode === "color" ? "color" : "bw",
    order.color_ranges
  );
  if (!colors.ok || colors.segments.length < 2) return null;
  return colors.segments;
}

export function printSettingsFor(order: OrderPrintFields): PrintSettings {
  return {
    colorMode: order.color_mode,
    paperSize: order.paper_size,
    orientation: order.orientation ?? "auto",
    sides: order.sides,
    copies: order.copies,
    pageRange: order.page_range ?? "all",
    pageCount: order.page_count,
    fitMode: order.fit_mode === "actual" ? "actual" : "fit",
    colorSegments: colorSegmentsFor(order),
  };
}

/**
 * What an agent must support to print these settings exactly.
 *
 * Scaling is always required: every order states fit-to-page or actual
 * size, and an agent without fit-mode applies neither (it shrinks oversized
 * pages and leaves smaller ones as they are).
 */
export function requiredCapabilities(settings: PrintSettings): string[] {
  const needed: string[] = [CAPABILITY.fitMode];
  if (settings.orientation === "portrait" || settings.orientation === "landscape") {
    needed.push(CAPABILITY.orientation);
  }
  if (settings.colorSegments && settings.colorSegments.length > 0) {
    needed.push(CAPABILITY.colorSegments);
  }
  return needed;
}

export function parseCapabilities(header: string | null | undefined): Set<string> {
  return new Set(
    (header ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
  );
}

export function missingCapabilities(settings: PrintSettings, announced: Set<string>): string[] {
  return requiredCapabilities(settings).filter((c) => !announced.has(c));
}

/** "1.0.0" < "1.1.0"; unknown or malformed versions count as outdated. */
export function agentVersionOutdated(version: string | null | undefined): boolean {
  const parse = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10));
  if (!version || !/^\d+\.\d+\.\d+/.test(version)) return true;
  const a = parse(version);
  const b = parse(MIN_AGENT_VERSION);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/**
 * Page range parsing for print jobs.
 *
 * Accepts strings like "1-5", "3,5,7", "2-8,10,12-14".
 * Always validated against the real page count of the converted PDF —
 * never trust a page list a client hands you without this check.
 */

export type PageRangeResult =
  | { ok: true; pages: number[] }
  | { ok: false; error: string };

const SEGMENT_RE = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/;

export function parsePageRange(input: string, totalPages: number): PageRangeResult {
  if (totalPages <= 0) {
    return { ok: false, error: "Document has no pages to print." };
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Enter a page range, e.g. 1-5 or 2,4,9." };
  }

  const segments = trimmed.split(",");
  const pages = new Set<number>();

  for (const rawSegment of segments) {
    const match = SEGMENT_RE.exec(rawSegment);
    if (!match) {
      return { ok: false, error: `"${rawSegment.trim()}" isn't a valid page or range.` };
    }

    const start = parseInt(match[1], 10);
    const end = match[2] !== undefined ? parseInt(match[2], 10) : start;

    if (start < 1 || end < 1) {
      return { ok: false, error: "Page numbers must be 1 or higher." };
    }
    if (start > totalPages || end > totalPages) {
      return {
        ok: false,
        error: `This document only has ${totalPages} page${totalPages === 1 ? "" : "s"}.`,
      };
    }
    if (end < start) {
      return { ok: false, error: `"${rawSegment.trim()}" has the range backwards.` };
    }

    for (let p = start; p <= end; p++) pages.add(p);
  }

  if (pages.size === 0) {
    return { ok: false, error: "No pages selected." };
  }

  return { ok: true, pages: Array.from(pages).sort((a, b) => a - b) };
}

/** All pages of the document, in order. */
export function allPages(totalPages: number): number[] {
  return Array.from({ length: totalPages }, (_, i) => i + 1);
}

/** Compact "1-3, 7, 10-12" for a set of page numbers. */
export function pagesToRangeString(pages: number[]): string {
  if (pages.length === 0) return "";
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    if (current !== prev + 1) {
      parts.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = current;
    }
    prev = current;
  }
  return parts.join(",");
}

/* ── Per-range colour ────────────────────────────────────────────── */

export type PageColorMode = "bw" | "color";

/** One override as stored in orders.color_ranges. */
export interface ColorRange {
  range: string;
  mode: PageColorMode;
}

/** A run of pages the agent prints in one pass with one colour setting. */
export interface PrintSegment {
  pageRange: string;
  colorMode: PageColorMode;
}

export type PageColorResult =
  | {
      ok: true;
      colorPages: number[];
      bwPages: number[];
      /** In page order. One segment when the whole order is one mode. */
      segments: PrintSegment[];
      /**
       * The overrides restricted to pages actually being printed, or null when
       * every page uses `defaultMode` — so a mixed order and a plain one are
       * stored differently only when they print differently.
       */
      normalized: ColorRange[] | null;
    }
  | { ok: false; error: string };

export const MAX_COLOR_RANGES = 50;

/**
 * Which selected pages print in colour and which in black & white.
 *
 * `defaultMode` covers every selected page; each override then sets its own
 * pages, later overrides winning. Overrides are validated against the real
 * page count like any other range. Pages an override names that are not
 * selected are ignored rather than rejected: unticking a page in the preview
 * should not make an earlier colour choice an error.
 *
 * The same result prices the order and tells the agent how to print it, so
 * the two cannot disagree.
 */
export function resolvePageColors(
  selectedPages: number[],
  totalPages: number,
  defaultMode: PageColorMode,
  colorRanges: ColorRange[] | null | undefined
): PageColorResult {
  const selected = [...new Set(selectedPages)].sort((a, b) => a - b);
  const modeOf = new Map<number, PageColorMode>(selected.map((p) => [p, defaultMode]));

  const overrides = colorRanges ?? [];
  if (overrides.length > MAX_COLOR_RANGES) {
    return { ok: false, error: `Use at most ${MAX_COLOR_RANGES} colour ranges.` };
  }

  for (const override of overrides) {
    if (override.mode !== "bw" && override.mode !== "color") {
      return { ok: false, error: "Each colour range must be black & white or colour." };
    }
    const parsed = parsePageRange(String(override.range ?? ""), totalPages);
    if (!parsed.ok) return { ok: false, error: `Colour range: ${parsed.error}` };
    for (const p of parsed.pages) {
      if (modeOf.has(p)) modeOf.set(p, override.mode);
    }
  }

  const colorPages = selected.filter((p) => modeOf.get(p) === "color");
  const bwPages = selected.filter((p) => modeOf.get(p) === "bw");

  // Consecutive selected pages sharing a mode print in one pass.
  const segments: PrintSegment[] = [];
  let run: number[] = [];
  let runMode: PageColorMode | null = null;
  for (const p of selected) {
    const mode = modeOf.get(p)!;
    if (runMode !== null && mode !== runMode) {
      segments.push({ pageRange: pagesToRangeString(run), colorMode: runMode });
      run = [];
    }
    run.push(p);
    runMode = mode;
  }
  if (runMode !== null) segments.push({ pageRange: pagesToRangeString(run), colorMode: runMode });

  const mixed = colorPages.length > 0 && bwPages.length > 0;
  const allOtherMode =
    !mixed && selected.length > 0 && modeOf.get(selected[0]) !== defaultMode;

  let normalized: ColorRange[] | null = null;
  if (mixed || allOtherMode) {
    const otherMode: PageColorMode = defaultMode === "bw" ? "color" : "bw";
    const otherPages = otherMode === "color" ? colorPages : bwPages;
    normalized = [{ range: pagesToRangeString(otherPages), mode: otherMode }];
  }

  return { ok: true, colorPages, bwPages, segments, normalized };
}

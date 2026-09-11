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

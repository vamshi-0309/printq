"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * Browser-side PDF rendering for the customer preview.
 *
 * Everything here runs on the File the customer picked, before it is uploaded.
 * That makes the preview instant, keeps the document on the device until they
 * commit to it, and gives us a page count that matches what they can see.
 *
 * The worker is served from /public rather than resolved through the bundler,
 * so its URL is the same in dev and in a production build.
 */

let pdfjs: typeof import("pdfjs-dist") | null = null;

async function getPdfjs() {
  if (pdfjs) return pdfjs;
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  pdfjs = lib;
  return lib;
}

export type LoadedPdf = {
  doc: PDFDocumentProxy;
  pageCount: number;
};

export async function loadPdf(data: ArrayBuffer): Promise<LoadedPdf> {
  const lib = await getPdfjs();
  // `data` is transferred to the worker, so hand over a copy — the caller may
  // still need the original bytes to upload.
  const doc = await lib.getDocument({ data: data.slice(0) }).promise;
  return { doc, pageCount: doc.numPages };
}

/**
 * Render one page to a data URL.
 *
 * `targetWidth` is in CSS pixels; the canvas is drawn at device resolution so
 * thumbnails stay sharp on phone screens.
 */
export async function renderPageToDataUrl(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetWidth: number,
  dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1
): Promise<{ dataUrl: string; width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = (targetWidth / base.width) * Math.min(dpr, 2);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not get a 2D canvas context.");

  // White background: PDF pages are transparent where nothing is drawn, which
  // would otherwise show as black once encoded to JPEG.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: context, viewport }).promise;

  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  const aspect = base.height / base.width;

  // Free the backing store immediately; a long document renders many of these.
  canvas.width = 0;
  canvas.height = 0;
  page.cleanup();

  return { dataUrl, width: targetWidth, height: Math.round(targetWidth * aspect) };
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

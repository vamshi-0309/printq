"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdf, renderPageToDataUrl } from "@/lib/pdfPreview";
import { extensionOf } from "@/lib/fileExtension";

/**
 * Shows the customer exactly what they are about to pay to print.
 *
 * Rendering happens in the browser, from the file they picked, before it is
 * uploaded — so the preview appears immediately and the document does not
 * leave the device to produce it.
 *
 * The thumbnails are also the page picker: tapping one includes or excludes
 * that page. Selecting pages visually is far less error-prone on a phone than
 * typing "2,4,9-11" into a box, and it is impossible to name a page that isn't
 * there.
 *
 * Long documents render lazily through an IntersectionObserver, so a 300-page
 * file doesn't rasterise 300 canvases up front.
 */

const THUMB_WIDTH = 150;

type Props = {
  file: File;
  /** null while unknown (legacy Office formats). */
  pageCount: number | null;
  selectedPages: Set<number>;
  onTogglePage: (page: number) => void;
  onSelectAll: () => void;
  onClear: () => void;
  /** Reports the true count once the PDF is parsed in the browser. */
  onPageCountDetected?: (pages: number) => void;
  selectable: boolean;
};

export function DocumentPreview({
  file,
  pageCount,
  selectedPages,
  onTogglePage,
  onSelectAll,
  onClear,
  onPageCountDetected,
  selectable,
}: Props) {
  const ext = extensionOf(file.name);
  const isPdf = ext === ".pdf";
  const isImage = [".jpg", ".jpeg", ".png"].includes(ext);

  if (isPdf) {
    return (
      <PdfPreview
        file={file}
        selectedPages={selectedPages}
        onTogglePage={onTogglePage}
        onSelectAll={onSelectAll}
        onClear={onClear}
        onPageCountDetected={onPageCountDetected}
        selectable={selectable}
      />
    );
  }

  if (isImage) return <ImagePreview file={file} />;

  return <UnpreviewableDocument file={file} pageCount={pageCount} />;
}

/* ── PDF ──────────────────────────────────────────────────────────── */

function PdfPreview({
  file,
  selectedPages,
  onTogglePage,
  onSelectAll,
  onClear,
  onPageCountDetected,
  selectable,
}: Omit<Props, "pageCount">) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;

    (async () => {
      try {
        const buf = await file.arrayBuffer();
        const res = await loadPdf(buf);
        if (cancelled) {
          res.doc.destroy();
          return;
        }
        loaded = res.doc;
        setDoc(res.doc);
        setPages(res.pageCount);
        setLoading(false);
        onPageCountDetected?.(res.pageCount);
      } catch {
        if (!cancelled) {
          setError("This PDF couldn't be previewed, but it can still be printed.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      loaded?.destroy();
    };
    // onPageCountDetected is intentionally excluded: it is a reporting callback
    // and re-running this effect would re-parse the whole document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  if (loading) return <PreviewSkeleton />;
  if (error || !doc) return <PreviewNotice message={error ?? "Preview unavailable."} />;

  const allSelected = selectedPages.size === pages;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-soft">
          {selectable ? (
            <>
              <span className="font-semibold text-ink">{selectedPages.size}</span> of {pages}{" "}
              {pages === 1 ? "page" : "pages"} selected
            </>
          ) : (
            <>
              {pages} {pages === 1 ? "page" : "pages"}
            </>
          )}
        </p>
        {selectable && pages > 1 && (
          <div className="flex items-center gap-1">
            <MiniButton onClick={onSelectAll} disabled={allSelected}>
              All
            </MiniButton>
            <MiniButton onClick={onClear} disabled={selectedPages.size === 0}>
              None
            </MiniButton>
          </div>
        )}
      </div>

      <div
        className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-4"
        role={selectable ? "group" : undefined}
        aria-label={selectable ? "Choose pages to print" : undefined}
      >
        {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
          <PageThumb
            key={n}
            doc={doc}
            pageNumber={n}
            selected={selectedPages.has(n)}
            onToggle={() => onTogglePage(n)}
            selectable={selectable}
          />
        ))}
      </div>
    </div>
  );
}

function PageThumb({
  doc,
  pageNumber,
  selected,
  onToggle,
  selectable,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  selected: boolean;
  onToggle: () => void;
  selectable: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const reduced = useReducedMotion();

  // Only rasterise once the thumbnail is near the viewport.
  useEffect(() => {
    const node = ref.current;
    if (!node || src || failed) return;

    let cancelled = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        renderPageToDataUrl(doc, pageNumber, THUMB_WIDTH)
          .then((r) => !cancelled && setSrc(r.dataUrl))
          .catch(() => !cancelled && setFailed(true));
      },
      { rootMargin: "400px" }
    );
    io.observe(node);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [doc, pageNumber, src, failed]);

  const body = (
    <>
      {/* Fixed A4 aspect box reserves the space before the render lands, so
          the grid never reflows as thumbnails stream in. */}
      <div className="relative w-full overflow-hidden bg-paper-grey" style={{ aspectRatio: "1 / 1.414" }}>
        {src ? (
          <motion.img
            src={src}
            alt=""
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {failed ? (
              <span className="font-data text-[10px] text-ink-soft/60">p{pageNumber}</span>
            ) : (
              <span className="h-4 w-4 animate-pulse rounded-full bg-line" />
            )}
          </div>
        )}

        {selectable && (
          <span
            aria-hidden="true"
            className={`absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center border transition-colors ${
              selected
                ? "border-cyan bg-cyan text-paper"
                : "border-line-strong bg-paper/85 text-transparent"
            }`}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path
                d="M4.5 12.5l5 5 10-11"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
      </div>
      <span className="mt-1 block text-center font-data text-[10px] text-ink-soft">
        {pageNumber}
      </span>
    </>
  );

  if (!selectable) {
    return (
      <div ref={ref} className="border border-line bg-paper p-1">
        {body}
      </div>
    );
  }

  return (
    <div ref={ref}>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={`Page ${pageNumber}${selected ? ", selected" : ", not selected"}`}
        className={`w-full border p-1 text-left transition-all duration-150 active:scale-[0.97] motion-reduce:active:scale-100 ${
          selected
            ? "border-cyan bg-cyan/[0.06] shadow-sm shadow-cyan/20"
            : "border-line bg-paper opacity-55 hover:opacity-90"
        }`}
      >
        {body}
      </button>
    </div>
  );
}

/* ── Image ────────────────────────────────────────────────────────── */

function ImagePreview({ file }: { file: File }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  // Created during render and revoked on unmount — writing it from an effect
  // would mean an extra render before the image could paint.
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  return (
    <div>
      <p className="text-[12.5px] text-ink-soft">1 page &middot; prints as a single sheet</p>
      <div className="mt-3 flex justify-center border border-line bg-paper-grey p-3">
        {(
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={`Preview of ${file.name}`}
            className="max-h-[320px] w-auto object-contain"
            onLoad={(e) =>
              setDims({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
          />
        )}
      </div>
      {dims && (
        <p className="mt-2 text-center font-data text-[10.5px] text-ink-soft">
          {dims.w} &times; {dims.h} px
        </p>
      )}
    </div>
  );
}

/* ── Office / unpreviewable ──────────────────────────────────────── */

function UnpreviewableDocument({ file, pageCount }: { file: File; pageCount: number | null }) {
  const ext = extensionOf(file.name).replace(".", "").toUpperCase();
  return (
    <div className="border border-line bg-paper-grey/60 p-6 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center border border-line bg-paper text-ink-soft">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      </span>
      <p className="mt-3 text-[13.5px] font-medium text-ink">{ext} document</p>
      <p className="mx-auto mt-1.5 max-w-xs text-[12.5px] leading-relaxed text-ink-soft">
        {pageCount !== null ? (
          <>
            {pageCount} {pageCount === 1 ? "page" : "pages"}, read from the file&apos;s own
            properties. A visual preview isn&apos;t available for this format — the shop
            converts it to PDF before printing.
          </>
        ) : (
          <>
            A preview isn&apos;t available for this format, and it doesn&apos;t record its
            page count. Save it as a PDF to see it here and get an exact price.
          </>
        )}
      </p>
    </div>
  );
}

/* ── Shared bits ─────────────────────────────────────────────────── */

function PreviewSkeleton() {
  return (
    <div>
      <div className="h-3 w-28 animate-pulse bg-line" />
      <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border border-line bg-paper p-1">
            <div
              className="w-full animate-pulse bg-paper-grey"
              style={{ aspectRatio: "1 / 1.414" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewNotice({ message }: { message: string }) {
  return (
    <div className="border-l-2 border-toner-yellow bg-toner-yellow/[0.07] px-4 py-3">
      <p className="text-[12.5px] leading-relaxed text-ink-soft">{message}</p>
    </div>
  );
}

function MiniButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="border border-line px-2.5 py-1 font-data text-[10.5px] uppercase tracking-[0.1em] text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-soft"
    >
      {children}
    </button>
  );
}

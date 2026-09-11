"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useMemo, useRef, useState } from "react";
import { DocumentPreview } from "@/components/customer/DocumentPreview";
import { PrintOptions, type Options, type PaperSize } from "@/components/customer/PrintOptions";
import { UploadStep } from "@/components/customer/UploadStep";
import { OrderStatusPanel } from "@/components/customer/OrderStatusPanel";
import { usePriceQuote } from "@/hooks/usePriceQuote";
import { pagesToRangeString } from "@/lib/pdfPreview";
import { formatBytes, uploadWithProgress, type UploadHandle } from "@/lib/uploadWithProgress";
import { openCashfreeCheckout } from "@/lib/cashfreeCheckout";

/**
 * The customer journey: choose a document, see it, set options, watch the
 * price update, then order.
 *
 * The price on screen is always the server's number for the current selection
 * — never a client-side estimate — so what the customer agrees to is exactly
 * what the order is created with.
 */

type Step = "upload" | "configure" | "order";

type Uploaded = {
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  pageCountKnown: boolean;
  pageCountNote: string | null;
};

type OrderResult = {
  orderId: string;
  orderUuid: string;
  customerSessionToken: string;
  amount: number;
  upiLink: string | null;
  gateway?: "none" | "cashfree" | "razorpay";
  paymentSessionId?: string | null;
};

/**
 * Where a placed order is remembered across the gateway redirect.
 *
 * The customer leaves the site for Cashfree's hosted page and comes back to
 * `?cf_return=1`. The status endpoint needs the customer_session_token, and
 * that must not travel in the URL — it would end up in browser history and
 * any Referer header. Keeping it in localStorage returns them to the live
 * status screen without leaking the capability token.
 */
const RESUME_KEY = "printq.pendingOrder.v1";

function saveResume(order: OrderResult, shopId: string) {
  try {
    window.localStorage.setItem(RESUME_KEY, JSON.stringify({ ...order, shopId }));
  } catch {
    // Private mode: the customer just lands back on the upload screen.
  }
}

function loadResume(shopId: string): OrderResult | null {
  try {
    const raw = window.localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrderResult & { shopId?: string };
    if (parsed.shopId !== shopId || !parsed.orderUuid) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearResume() {
  try {
    window.localStorage.removeItem(RESUME_KEY);
  } catch {
    // Nothing to do.
  }
}

const EASE = [0.22, 1, 0.36, 1] as const;

export function CustomerFlow({
  shopId,
  shopName,
  shopOnline,
  enabledPaperSizes = ["A4"],
}: {
  shopId: string;
  shopName: string;
  shopOnline: boolean;
  enabledPaperSizes?: PaperSize[];
}) {
  const reduced = useReducedMotion();

  // Returning from the gateway redirect: restore the placed order so the
  // customer lands back on their live status screen, not an empty form.
  const resumed = useMemo(() => {
    if (typeof window === "undefined") return null;
    if (!new URLSearchParams(window.location.search).has("cf_return")) return null;
    return loadResume(shopId);
    // Read once on mount; the URL and shop do not change within a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [step, setStep] = useState<Step>(resumed ? "order" : "upload");

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const uploadRef = useRef<UploadHandle<Uploaded> | null>(null);

  // The browser's own parse of the PDF wins for page selection, because it is
  // what the customer is actually looking at in the preview.
  const [previewPages, setPreviewPages] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [options, setOptions] = useState<Options>({
    copies: 1,
    colorMode: "bw",
    paperSize: enabledPaperSizes[0] ?? "A4",
    sides: "single",
  });

  const [order, setOrder] = useState<OrderResult | null>(resumed);
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const totalPages = previewPages ?? uploaded?.pageCount ?? null;
  const pageCountKnown = totalPages !== null;
  const selectedCount = selected.size;

  const pageRange = useMemo(() => {
    if (!pageCountKnown) return "all";
    if (selectedCount === 0) return "";
    if (selectedCount === totalPages) return `1-${totalPages}`;
    return pagesToRangeString([...selected]);
  }, [selected, selectedCount, totalPages, pageCountKnown]);

  const quoteInput = useMemo(() => {
    if (!uploaded || !pageCountKnown || selectedCount === 0) return null;
    return {
      shopId,
      // `pageCount` is the document's total; `pageRange` is what the customer
      // actually ticked. The server prices on the parsed range's length, and
      // the agent prints exactly that range — so both must be the real values.
      pageCount: totalPages,
      copies: options.copies,
      colorMode: options.colorMode,
      paperSize: options.paperSize,
      sides: options.sides,
      pageRange,
    };
  }, [uploaded, pageCountKnown, selectedCount, totalPages, pageRange, shopId, options]);

  const { breakdown, loading: priceLoading, error: priceError } = usePriceQuote(quoteInput);

  /* ── Upload ─────────────────────────────────────────────────────── */

  const startUpload = useCallback(
    (picked: File) => {
      setFile(picked);
      setUploadError(null);
      setUploading(true);
      setProgress(0);
      setPreviewPages(null);
      setSelected(new Set());

      const form = new FormData();
      form.append("file", picked);
      form.append("shopId", shopId);

      const handle = uploadWithProgress<Uploaded>("/api/upload", form, (p) =>
        setProgress(p.percent)
      );
      uploadRef.current = handle;

      handle.promise
        .then((data) => {
          setUploaded(data);
          setUploading(false);
          if (data.pageCount !== null) {
            setSelected(new Set(Array.from({ length: data.pageCount }, (_, i) => i + 1)));
          }
          setStep("configure");
        })
        .catch((err: Error) => {
          setUploading(false);
          setFile(null);
          if (err.message !== "Upload cancelled.") setUploadError(err.message);
        });
    },
    [shopId]
  );

  const cancelUpload = useCallback(() => {
    uploadRef.current?.abort();
    setUploading(false);
    setFile(null);
    setProgress(0);
  }, []);

  // The browser may find a different count than the server's parse; trust the
  // browser, since that is what the customer sees, and reselect accordingly.
  const onPageCountDetected = useCallback((pages: number) => {
    setPreviewPages(pages);
    setSelected(new Set(Array.from({ length: pages }, (_, i) => i + 1)));
  }, []);

  const togglePage = useCallback((n: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (totalPages) setSelected(new Set(Array.from({ length: totalPages }, (_, i) => i + 1)));
  }, [totalPages]);

  const clearAll = useCallback(() => setSelected(new Set()), []);

  /* ── Order ──────────────────────────────────────────────────────── */

  const createOrder = useCallback(async () => {
    if (!uploaded || !breakdown) return;
    setOrdering(true);
    setOrderError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId,
          fileStoragePath: uploaded.storagePath,
          originalFilename: uploaded.originalFilename,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
          pageCount: totalPages,
          copies: options.copies,
          colorMode: options.colorMode,
          paperSize: options.paperSize,
          orientation: "auto",
          sides: options.sides,
          pageRange,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOrderError(data.error ?? "Could not place the order.");
        return;
      }
      setOrder(data);
      setStep("order");

      // Cashfree shops go straight to hosted checkout. The order row already
      // exists and is pending, so an abandoned checkout leaves a recoverable
      // order rather than a lost one.
      if (data.gateway === "cashfree" && data.paymentSessionId) {
        saveResume(data, shopId);
        try {
          await openCashfreeCheckout(
            data.paymentSessionId,
            (process.env.NEXT_PUBLIC_CASHFREE_ENV as "sandbox" | "production") ?? "sandbox"
          );
        } catch (err) {
          // Staying on the status screen is the right fallback: the order is
          // live, and the customer can pay at the counter instead.
          setOrderError(
            err instanceof Error ? err.message : "Could not open the payment page."
          );
        }
      }
    } catch {
      setOrderError("Couldn't reach the shop. Check your connection and try again.");
    } finally {
      setOrdering(false);
    }
  }, [uploaded, breakdown, shopId, totalPages, options, pageRange]);

  const retryCheckout = useCallback(async () => {
    if (!order?.paymentSessionId) return;
    try {
      await openCashfreeCheckout(
        order.paymentSessionId,
        (process.env.NEXT_PUBLIC_CASHFREE_ENV as "sandbox" | "production") ?? "sandbox"
      );
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "Could not open the payment page.");
    }
  }, [order]);

  const startOver = useCallback(() => {
    clearResume();
    setStep("upload");
    setFile(null);
    setUploaded(null);
    setPreviewPages(null);
    setSelected(new Set());
    setOrder(null);
    setOrderError(null);
    setUploadError(null);
  }, []);

  /* ── Shop offline ───────────────────────────────────────────────── */

  if (!shopOnline && step === "upload") {
    return (
      <div className="border border-line bg-paper-grey/70 p-6 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center border border-line bg-paper text-ink-soft">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M7 9V3.5h10V9M3 9h18v8H3z" />
            <path d="M5.5 5.5 18.5 18.5" />
          </svg>
        </span>
        <p className="mt-3 text-[14.5px] font-semibold text-ink">
          {shopName} isn&apos;t accepting orders right now
        </p>
        <p className="mx-auto mt-2 max-w-xs text-[12.5px] leading-relaxed text-ink-soft">
          Their print counter is offline. Please try again shortly, or ask at the counter.
        </p>
      </div>
    );
  }

  const canOrder = Boolean(breakdown) && selectedCount > 0 && !priceLoading;

  return (
    <div className="pb-28">
      <StepRail step={step} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: EASE }}
          className="mt-5"
        >
          {step === "upload" && (
            <UploadStep
              onFile={startUpload}
              uploading={uploading}
              progress={progress}
              error={uploadError}
              fileName={file?.name ?? null}
              fileSize={file?.size ?? null}
              onCancel={cancelUpload}
            />
          )}

          {step === "configure" && file && uploaded && (
            <div className="space-y-7">
              <FileHeader
                name={uploaded.originalFilename}
                sizeBytes={uploaded.sizeBytes}
                onReplace={startOver}
              />

              {uploaded.pageCountNote && !pageCountKnown && (
                <p className="border-l-2 border-toner-yellow bg-toner-yellow/[0.07] px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-soft">
                  {uploaded.pageCountNote}
                </p>
              )}

              <DocumentPreview
                file={file}
                pageCount={totalPages}
                selectedPages={selected}
                onTogglePage={togglePage}
                onSelectAll={selectAll}
                onClear={clearAll}
                onPageCountDetected={onPageCountDetected}
                selectable={pageCountKnown}
              />

              <PrintOptions
                value={options}
                onChange={setOptions}
                enabledPaperSizes={enabledPaperSizes}
              />

              {orderError && (
                <p role="alert" className="border-l-2 border-magenta bg-magenta/[0.05] px-3 py-2.5 text-[12.5px] text-magenta">
                  {orderError}
                </p>
              )}
            </div>
          )}

          {step === "order" && order && (
            <OrderStatusPanel
              orderUuid={order.orderUuid}
              customerSessionToken={order.customerSessionToken}
              publicOrderId={order.orderId}
              amount={order.amount}
              upiLink={order.upiLink}
              gateway={order.gateway}
              onRetryPayment={
                order.gateway === "cashfree" && order.paymentSessionId
                  ? retryCheckout
                  : undefined
              }
              shopName={shopName}
              onStartOver={startOver}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {step === "configure" && (
        <PriceBar
          total={breakdown?.total ?? null}
          loading={priceLoading}
          error={priceError ?? (selectedCount === 0 ? "Select at least one page." : null)}
          detail={
            pageCountKnown
              ? `${selectedCount} ${selectedCount === 1 ? "page" : "pages"} × ${options.copies} ${options.copies === 1 ? "copy" : "copies"}`
              : "Page count confirmed at the shop"
          }
          minimumApplied={breakdown?.minimumApplied ?? false}
          duplexDiscount={breakdown?.duplexDiscount ?? 0}
          disabled={!canOrder}
          busy={ordering}
          onSubmit={createOrder}
        />
      )}
    </div>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────── */

function StepRail({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "upload", label: "Document" },
    { id: "configure", label: "Options" },
    { id: "order", label: "Collect" },
  ];
  const index = steps.findIndex((s) => s.id === step);

  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => (
        <li key={s.id} className="flex flex-1 flex-col gap-1.5">
          <span className="h-[3px] w-full overflow-hidden bg-line">
            <motion.span
              className="block h-full bg-cyan"
              initial={false}
              animate={{ width: i <= index ? "100%" : "0%" }}
              transition={{ duration: 0.35, ease: EASE }}
            />
          </span>
          <span
            className={`font-data text-[10px] uppercase tracking-[0.12em] transition-colors ${
              i <= index ? "text-cyan" : "text-ink-soft/50"
            }`}
          >
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function FileHeader({
  name,
  sizeBytes,
  onReplace,
}: {
  name: string;
  sizeBytes: number;
  onReplace: () => void;
}) {
  return (
    <div className="flex items-start gap-3 border border-line bg-paper p-3.5">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-cyan/25 bg-cyan/[0.07] text-cyan">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-ink">{name}</p>
        <p className="mt-0.5 font-data text-[11px] text-ink-soft">
          {formatBytes(sizeBytes)}
        </p>
      </div>
      <button
        type="button"
        onClick={onReplace}
        className="shrink-0 font-data text-[10.5px] uppercase tracking-[0.1em] text-cyan transition-colors hover:text-ink"
      >
        Change
      </button>
    </div>
  );
}

/**
 * Sticky total. On a phone the options list is longer than the screen, so the
 * price and the action stay in reach instead of living at the bottom of a
 * scroll.
 */
function PriceBar({
  total,
  loading,
  error,
  detail,
  minimumApplied,
  duplexDiscount,
  disabled,
  busy,
  onSubmit,
}: {
  total: number | null;
  loading: boolean;
  error: string | null;
  detail: string;
  minimumApplied: boolean;
  duplexDiscount: number;
  disabled: boolean;
  busy: boolean;
  onSubmit: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { y: 80 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-md items-center gap-3 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            {loading ? (
              <span className="inline-block h-7 w-20 animate-pulse bg-line" />
            ) : total !== null ? (
              <motion.span
                key={total}
                initial={reduced ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="font-data text-[26px] font-bold leading-none tracking-[-0.02em] text-ink"
              >
                &#8377;{total}
              </motion.span>
            ) : (
              <span className="font-data text-[26px] font-bold leading-none text-ink-soft/40">
                &#8377;—
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-[11px] leading-tight text-ink-soft">
            {error ?? detail}
            {!error && duplexDiscount > 0 && ` · ₹${duplexDiscount} duplex off`}
            {!error && minimumApplied && " · shop minimum"}
          </p>
        </div>

        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || busy}
          className="shrink-0 border border-ink bg-ink px-6 py-3 text-[14px] font-medium text-paper transition-all hover:bg-ink-deep active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:active:scale-100"
        >
          {busy ? "Placing…" : "Continue"}
        </button>
      </div>
    </motion.div>
  );
}

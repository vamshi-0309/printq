"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useMemo, useRef, useState } from "react";
import { DocumentPreview } from "@/components/customer/DocumentPreview";
import { PrintOptions, type Options, type PaperSize } from "@/components/customer/PrintOptions";
import { UploadStep } from "@/components/customer/UploadStep";
import { OrderStatusPanel } from "@/components/customer/OrderStatusPanel";
import { ImageEditor, type ImageEdit } from "@/components/customer/ImageEditor";
import { usePriceQuote, type PriceBreakdown } from "@/hooks/usePriceQuote";
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

type Step = "upload" | "edit-image" | "configure" | "review" | "order";

/** The owner's switches, as the shop page read them. */
export type CustomerControls = {
  shopOpen: boolean;
  acceptingOrders: boolean;
  printingMode: "automatic" | "approval_required";
};

const CLOSED_MESSAGE = "This shop is currently closed. Please try again later.";
const PAUSED_MESSAGE = "Not accepting new print orders right now";

const isEditableImage = (f: File) =>
  /^image\/(jpe?g|png)$/i.test(f.type) || /\.(jpe?g|png)$/i.test(f.name);

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
  status?: string;
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

/**
 * How long a placed order is brought back on a plain reload. Long enough to
 * cover waiting for the shop's approval or the queue; the status endpoint
 * says "expired" once the order is long finished anyway.
 */
const RESUME_WINDOW_MS = 6 * 3600 * 1000;

function saveResume(order: OrderResult, shopId: string) {
  try {
    window.localStorage.setItem(RESUME_KEY, JSON.stringify({ ...order, shopId, savedAt: Date.now() }));
  } catch {
    // Private mode: the customer just lands back on the upload screen.
  }
}

function loadResume(shopId: string, returningFromGateway: boolean): OrderResult | null {
  try {
    const raw = window.localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrderResult & { shopId?: string; savedAt?: number };
    if (parsed.shopId !== shopId || !parsed.orderUuid) return null;
    const fresh = typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt < RESUME_WINDOW_MS;
    if (!returningFromGateway && !fresh) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** One key per checkout attempt; the same choices resubmitted reuse it. */
function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)
      );
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
  controls = { shopOpen: true, acceptingOrders: true, printingMode: "automatic" },
  duplexAvailable = true,
}: {
  shopId: string;
  shopName: string;
  shopOnline: boolean;
  enabledPaperSizes?: PaperSize[];
  controls?: CustomerControls;
  /** False when the shop's chosen printer can't print double-sided. */
  duplexAvailable?: boolean;
}) {
  const reduced = useReducedMotion();

  // Returning from the gateway redirect, or reloading while waiting for the
  // shop: restore the placed order so the customer lands back on their live
  // status screen, not an empty form.
  const resumed = useMemo(() => {
    if (typeof window === "undefined") return null;
    return loadResume(shopId, new URLSearchParams(window.location.search).has("cf_return"));
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
    orientation: "auto",
    fitMode: "fit",
    otherModePages: "",
  });

  // A photo waiting in the editor, before it is uploaded.
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  // An edited photo is one page, chosen in the editor; no per-page colour.
  const [fromEditor, setFromEditor] = useState(false);

  // The checkout attempt's idempotency key, tied to the exact choices it was
  // made for: going Back and paying again with the same choices reuses it
  // (the server returns the same order), changing anything starts a new one.
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

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

  const colorRanges = useMemo(() => {
    const pages = options.otherModePages.replace(/\s+/g, "").replace(/^,+|,+$/g, "");
    if (!pages) return null;
    return [{ range: pages, mode: options.colorMode === "bw" ? ("color" as const) : ("bw" as const) }];
  }, [options.otherModePages, options.colorMode]);

  const sides = duplexAvailable ? options.sides : "single";

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
      sides,
      pageRange,
      colorRanges,
    };
  }, [uploaded, pageCountKnown, selectedCount, totalPages, pageRange, shopId, options, sides, colorRanges]);

  const { breakdown, loading: priceLoading, error: priceError } = usePriceQuote(quoteInput);

  /* ── Upload ─────────────────────────────────────────────────────── */

  const startUpload = useCallback(
    (picked: File, edited = false) => {
      // Photos are adjusted first, and the adjusted image is what uploads.
      if (!edited && isEditableImage(picked)) {
        setPendingImage(picked);
        setUploadError(null);
        setStep("edit-image");
        return;
      }
      setFromEditor(edited);
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

  const onImageEdited = useCallback(
    (edit: ImageEdit) => {
      setOptions((o) => ({
        ...o,
        colorMode: edit.colorMode,
        fitMode: edit.fitMode,
        paperSize: edit.paperSize,
        copies: edit.copies,
        orientation: edit.orientation,
        otherModePages: "",
      }));
      setPendingImage(null);
      setStep("upload");
      startUpload(edit.file, true);
    },
    [startUpload]
  );

  const toReview = useCallback(() => {
    const fingerprint = JSON.stringify({ quoteInput, path: uploaded?.storagePath, o: options.orientation, f: options.fitMode });
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: newKey() };
    setOrderError(null);
    setStep("review");
  }, [quoteInput, uploaded, options.orientation, options.fitMode]);

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
          orientation: options.orientation,
          sides,
          pageRange,
          colorRanges,
          fitMode: options.fitMode,
          idempotencyKey: attempt.current?.key,
        }),
      });
      const data = await res.json().catch(() => ({}));
      // The order exists even when the payment gateway was unreachable; its
      // status page offers "Pay now", which retries.
      if (!res.ok && !data.orderUuid) {
        setOrderError(data.error ?? "Could not place the order.");
        return;
      }
      setOrder(data);
      setStep("order");
      saveResume(data, shopId);

      // Cashfree shops go straight to hosted checkout. The order row already
      // exists and is pending, so an abandoned checkout leaves a recoverable
      // order rather than a lost one. Not in approval mode: nothing is
      // payable until the shop approves.
      if (data.gateway === "cashfree" && data.paymentSessionId && data.status !== "pending_approval") {
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
  }, [uploaded, breakdown, shopId, totalPages, options, pageRange, sides, colorRanges]);

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
    setPendingImage(null);
    setFromEditor(false);
    attempt.current = null;
  }, []);

  /* ── Shop closed / offline ──────────────────────────────────────── */

  if (!controls.shopOpen && step !== "order") {
    return (
      <div className="border border-line bg-paper-grey/70 p-6 text-center">
        <p className="text-[14.5px] font-semibold text-ink">{CLOSED_MESSAGE}</p>
        <p className="mx-auto mt-2 max-w-xs text-[12.5px] leading-relaxed text-ink-soft">
          {shopName} has closed online orders for now.
        </p>
      </div>
    );
  }

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

  const paused = !controls.acceptingOrders;
  const canOrder = Boolean(breakdown) && selectedCount > 0 && !priceLoading;
  const approval = controls.printingMode === "approval_required";

  return (
    <div className="pb-28">
      <StepRail step={step} />

      {paused && step !== "order" && (
        <p role="status" className="mt-4 border-l-2 border-toner-yellow bg-toner-yellow/[0.08] px-3.5 py-3 text-[13px] font-medium text-ink">
          {PAUSED_MESSAGE}
          <span className="block text-[12px] font-normal text-ink-soft">
            You can still upload and preview your document. Ordering opens again when {shopName} is ready.
          </span>
        </p>
      )}

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

          {step === "edit-image" && pendingImage && (
            <ImageEditor
              file={pendingImage}
              enabledPaperSizes={enabledPaperSizes}
              initial={{ colorMode: options.colorMode, paperSize: options.paperSize, copies: options.copies }}
              onDone={onImageEdited}
              onCancel={startOver}
            />
          )}

          {step === "review" && uploaded && breakdown && (
            <ReviewStep
              filename={uploaded.originalFilename}
              pageCount={selectedCount}
              pageRange={selectedCount === totalPages ? "all" : pageRange}
              options={{ ...options, sides }}
              colorRanges={colorRanges}
              breakdown={breakdown}
              approval={approval}
              shopName={shopName}
              error={orderError}
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
                duplexAvailable={duplexAvailable}
                multiPage={!fromEditor && (totalPages ?? 1) > 1}
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
          actionLabel="Review"
          detail={
            pageCountKnown
              ? `${selectedCount} ${selectedCount === 1 ? "page" : "pages"} × ${options.copies} ${options.copies === 1 ? "copy" : "copies"}`
              : "Page count confirmed at the shop"
          }
          minimumApplied={breakdown?.minimumApplied ?? false}
          duplexDiscount={breakdown?.duplexDiscount ?? 0}
          disabled={!canOrder}
          busy={false}
          onSubmit={toReview}
        />
      )}

      {step === "review" && (
        <PriceBar
          total={breakdown?.total ?? null}
          loading={false}
          error={paused ? PAUSED_MESSAGE : null}
          detail={approval ? "The shop checks it before you pay" : "This is exactly what you'll be charged"}
          minimumApplied={false}
          duplexDiscount={0}
          actionLabel={approval ? "Send for approval" : `Pay ₹${breakdown?.total ?? ""}`}
          secondaryLabel="Back"
          onSecondary={() => setStep("configure")}
          disabled={!canOrder || paused}
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
    { id: "review", label: "Review" },
    { id: "order", label: "Collect" },
  ];
  const index = steps.findIndex((s) => s.id === (step === "edit-image" ? "upload" : step));

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
  actionLabel = "Continue",
  secondaryLabel,
  onSecondary,
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
  actionLabel?: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
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

        {secondaryLabel && onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            disabled={busy}
            className="shrink-0 border border-line px-4 py-3 text-[14px] text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
          >
            {secondaryLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || busy}
          className="shrink-0 border border-ink bg-ink px-6 py-3 text-[14px] font-medium text-paper transition-all hover:bg-ink-deep active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:active:scale-100"
        >
          {busy ? "Placing…" : actionLabel}
        </button>
      </div>
    </motion.div>
  );
}

/**
 * The last screen before paying: every choice, and the price exactly as the
 * server computed it for those choices. The order route prices the same
 * choices with the same function against the stored file, and the agent is
 * sent exactly these settings, so what is shown here is what is charged and
 * what prints.
 */
function ReviewStep({
  filename,
  pageCount,
  pageRange,
  options,
  colorRanges,
  breakdown,
  approval,
  shopName,
  error,
}: {
  filename: string;
  pageCount: number;
  pageRange: string;
  options: Options;
  colorRanges: { range: string; mode: "bw" | "color" }[] | null;
  breakdown: PriceBreakdown;
  approval: boolean;
  shopName: string;
  error: string | null;
}) {
  const mixed = breakdown.mixed;
  const colour = colorRanges
    ? `${options.colorMode === "bw" ? "Black & white" : "Colour"}, pages ${colorRanges[0].range} in ${colorRanges[0].mode === "color" ? "colour" : "black & white"}`
    : options.colorMode === "bw"
      ? "Black & white"
      : "Colour";

  return (
    <div className="space-y-5">
      <div className="border border-line bg-paper">
        <p className="border-b border-line px-4 py-2.5 font-data text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          Check your order
        </p>
        <dl className="divide-y divide-line text-[13px]">
          <ReviewRow label="Document" value={filename} />
          <ReviewRow label="Pages" value={`${pageCount}${pageRange !== "all" ? ` (${pageRange})` : " (all)"}`} />
          <ReviewRow label="Copies" value={String(options.copies)} />
          <ReviewRow label="Colour" value={colour} />
          <ReviewRow label="Paper" value={options.paperSize} />
          <ReviewRow label="Sides" value={options.sides === "double" ? "Double-sided" : "Single-sided"} />
          <ReviewRow label="Orientation" value={options.orientation === "auto" ? "Automatic" : options.orientation === "portrait" ? "Portrait" : "Landscape"} />
          <ReviewRow label="Size on paper" value={options.fitMode === "actual" ? "Actual size" : "Fit to page"} />
        </dl>
      </div>

      <div className="border border-line bg-paper-grey/50 p-4">
        <p className="font-data text-[10.5px] uppercase tracking-[0.14em] text-ink-soft">Price</p>
        <dl className="mt-2.5 space-y-1.5 text-[12.5px]">
          {mixed ? (
            <>
              <PriceRow label={`${mixed.bwPages} B&W × ₹${mixed.bwRate}`} value={mixed.bwPages * mixed.bwRate} />
              <PriceRow label={`${mixed.colorPages} colour × ₹${mixed.colorRate}`} value={mixed.colorPages * mixed.colorRate} />
              {options.copies > 1 && <PriceRow label={`× ${options.copies} copies`} value={breakdown.subtotal} />}
            </>
          ) : (
            <PriceRow
              label={`${breakdown.effectivePages} ${breakdown.effectivePages === 1 ? "page" : "pages"} × ₹${breakdown.perPageRate}`}
              value={breakdown.subtotal}
            />
          )}
          {breakdown.duplexDiscount > 0 && <PriceRow label="Double-sided discount" value={-breakdown.duplexDiscount} />}
          {breakdown.minimumApplied && <PriceRow label="Shop minimum applies" value={breakdown.total} />}
          <div className="flex items-baseline justify-between border-t border-line pt-2">
            <dt className="text-[13px] font-semibold text-ink">Total</dt>
            <dd className="font-data text-[18px] font-bold text-ink">&#8377;{breakdown.total}</dd>
          </div>
        </dl>
      </div>

      {approval && (
        <p className="border-l-2 border-cyan bg-cyan/[0.05] px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-soft">
          {shopName} checks each order before printing. You&apos;ll be asked to pay once they approve it — nothing
          is charged now.
        </p>
      )}

      {error && (
        <p role="alert" className="border-l-2 border-magenta bg-magenta/[0.05] px-3 py-2.5 text-[12.5px] text-magenta">
          {error}
        </p>
      )}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className="min-w-0 break-words text-right text-ink">{value}</dd>
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="font-data text-ink">{value < 0 ? `−₹${-value}` : `₹${value}`}</dd>
    </div>
  );
}

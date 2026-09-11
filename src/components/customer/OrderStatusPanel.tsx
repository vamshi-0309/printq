"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useOrderStatus } from "@/hooks/useOrderStatus";

/**
 * Everything after the order is placed: pay the shop, then watch the job move
 * through the queue to the printer.
 *
 * The payment step matches the rail the shop actually uses:
 *   "cashfree" — hosted checkout; the token appears by itself once the signed
 *                webhook confirms the payment, with no owner action.
 *   UPI / cash  — the customer pays the shop's own UPI ID or pays at the
 *                counter, and the owner confirms receipt. The copy says
 *                "waiting for the shop to confirm" rather than implying
 *                anything was automatically verified.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

type Stage = {
  key: string;
  label: string;
  hint: string;
};

const STAGES: Stage[] = [
  { key: "payment_pending", label: "Payment", hint: "Pay the shop to join the queue" },
  { key: "queued", label: "In queue", hint: "Waiting for the printer" },
  { key: "printing", label: "Printing", hint: "Your pages are being printed" },
  { key: "completed", label: "Ready", hint: "Collect from the counter" },
];

/** Where each print_status sits on the four-stage rail. */
function stageIndex(printStatus: string): number {
  switch (printStatus) {
    case "created":
    case "payment_pending":
      return 0;
    case "paid":
    case "queued":
      return 1;
    case "claimed":
    case "print_attempted":
    case "printing":
      return 2;
    case "completed":
      return 3;
    default:
      return 0;
  }
}

export function OrderStatusPanel({
  orderUuid,
  customerSessionToken,
  publicOrderId,
  amount,
  upiLink,
  gateway,
  onRetryPayment,
  shopName,
  onStartOver,
}: {
  orderUuid: string;
  customerSessionToken: string;
  publicOrderId: string;
  amount: number;
  upiLink: string | null;
  gateway?: "none" | "cashfree" | "razorpay";
  onRetryPayment?: () => void;
  shopName: string;
  onStartOver: () => void;
}) {
  const reduced = useReducedMotion();
  const { status } = useOrderStatus(orderUuid, customerSessionToken);

  const printStatus = status?.printStatus ?? "payment_pending";
  const paid = status?.paymentStatus === "paid";
  const token = status?.tokenNumber ?? null;
  const failed = printStatus === "failed";
  const done = printStatus === "completed";
  const index = stageIndex(printStatus);

  return (
    <div className="space-y-6">
      {/* ── Token, once the shop has confirmed payment ── */}
      <AnimatePresence mode="wait" initial={false}>
        {token ? (
          <motion.div
            key="token"
            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: EASE }}
            className={`border-2 p-7 text-center ${
              done ? "border-emerald-500 bg-emerald-50/60" : "border-cyan bg-cyan/[0.04]"
            }`}
          >
            <p className="font-data text-[10.5px] uppercase tracking-[0.18em] text-ink-soft">
              Your token
            </p>
            <p className="mt-2 font-data text-[52px] font-bold leading-none tracking-[-0.02em] text-ink">
              {token}
            </p>
            <p className="mt-3 text-[12.5px] text-ink-soft">
              Show this at the counter to collect
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="pay"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            className="border border-line bg-paper p-6 text-center"
          >
            <p className="font-data text-[10.5px] uppercase tracking-[0.18em] text-ink-soft">
              Amount to pay
            </p>
            <p className="mt-2 font-data text-[40px] font-bold leading-none tracking-[-0.02em] text-ink">
              &#8377;{amount}
            </p>
            <p className="mt-2 text-[12.5px] text-ink-soft">
              Paid directly to {shopName}
            </p>

            {gateway === "cashfree" ? (
              <>
                {onRetryPayment && (
                  <button
                    type="button"
                    onClick={onRetryPayment}
                    className="mt-5 flex w-full items-center justify-center gap-2 border border-ink bg-ink px-6 py-3.5 text-[14.5px] font-medium text-paper transition-all hover:bg-ink-deep active:scale-[0.98] motion-reduce:active:scale-100"
                  >
                    Pay online
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 12h15M13.5 6.5 19 12l-5.5 5.5" />
                    </svg>
                  </button>
                )}
                <p className="mt-4 text-[11.5px] leading-relaxed text-ink-soft">
                  Pay by UPI, card or netbanking. Your token appears here
                  automatically once the payment is confirmed — usually within a
                  few seconds.
                </p>
              </>
            ) : upiLink ? (
              <>
                <a
                  href={upiLink}
                  className="mt-5 flex w-full items-center justify-center gap-2 border border-ink bg-ink px-6 py-3.5 text-[14.5px] font-medium text-paper transition-all hover:bg-ink-deep active:scale-[0.98] motion-reduce:active:scale-100"
                >
                  Open UPI app
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12h15M13.5 6.5 19 12l-5.5 5.5" />
                  </svg>
                </a>
                <p className="mt-4 text-[11.5px] leading-relaxed text-ink-soft">
                  Your token appears here as soon as {shopName} confirms the payment.
                  Keep this page open.
                </p>
              </>
            ) : (
              <>
                <p className="mt-5 border border-line bg-paper-grey px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft">
                  Pay at the counter and mention order{" "}
                  <span className="font-data text-ink">{publicOrderId}</span>.
                </p>
                <p className="mt-4 text-[11.5px] leading-relaxed text-ink-soft">
                  Your token appears here as soon as {shopName} confirms the payment.
                  Keep this page open.
                </p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Progress rail ── */}
      <div>
        <ol className="space-y-0">
          {STAGES.map((stage, i) => {
            const state = failed && i >= index ? "failed" : i < index ? "done" : i === index ? "current" : "todo";
            return (
              <li key={stage.key} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <StageDot state={state} pulse={state === "current" && paid && !done} />
                  {i < STAGES.length - 1 && (
                    <span
                      className={`w-px flex-1 transition-colors ${
                        i < index ? "bg-cyan" : "bg-line"
                      }`}
                      style={{ minHeight: 26 }}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className={`pb-5 ${i === STAGES.length - 1 ? "pb-0" : ""}`}>
                  <p
                    className={`text-[13.5px] font-semibold tracking-[-0.01em] ${
                      state === "todo" ? "text-ink-soft/50" : "text-ink"
                    }`}
                  >
                    {stage.label}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">
                    {state === "current" && status?.queuePosition && stage.key === "queued"
                      ? `Position ${status.queuePosition} in the queue`
                      : stage.hint}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {failed && (
        <div className="border-l-2 border-magenta bg-magenta/[0.05] px-4 py-3">
          <p className="text-[13px] font-medium text-magenta">Printing didn&apos;t complete</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
            {status?.failureReason ?? "The shop has been notified. Please ask at the counter."}
          </p>
        </div>
      )}

      {done && (
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="border border-emerald-500/40 bg-emerald-50/60 px-4 py-3.5 text-center"
        >
          <p className="text-[13.5px] font-semibold text-emerald-800">
            Your print is ready to collect
          </p>
          <p className="mt-1 text-[12px] text-emerald-800/80">
            Your file has been deleted from the shop&apos;s computer.
          </p>
        </motion.div>
      )}

      {/* ── Receipt ── */}
      <div className="border border-line bg-paper-grey/50 p-4">
        <p className="font-data text-[10.5px] uppercase tracking-[0.14em] text-ink-soft">
          Order details
        </p>
        <dl className="mt-3 space-y-1.5">
          <Row label="Order" value={publicOrderId} mono />
          {status && (
            <>
              <Row
                label="Print"
                value={`${status.pageCount ?? "—"} ${status.pageCount === 1 ? "page" : "pages"} · ${status.copies} ${status.copies === 1 ? "copy" : "copies"}`}
              />
              <Row
                label="Format"
                value={`${status.paperSize} · ${status.colorMode === "bw" ? "B&W" : "Colour"} · ${status.sides === "double" ? "Double" : "Single"} sided`}
              />
            </>
          )}
          <Row label="Amount" value={`₹${amount}`} mono />
        </dl>
      </div>

      <button
        type="button"
        onClick={onStartOver}
        className="w-full border border-line py-3 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
      >
        Print another document
      </button>
    </div>
  );
}

function StageDot({ state, pulse }: { state: string; pulse: boolean }) {
  const base = "relative flex h-6 w-6 shrink-0 items-center justify-center border";
  if (state === "done") {
    return (
      <span className={`${base} border-cyan bg-cyan text-paper`}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 12.5l5 5 10-11" />
        </svg>
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className={`${base} border-magenta bg-magenta text-paper`}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className={`${base} border-cyan bg-paper`}>
        <span className="h-2 w-2 bg-cyan" />
        {pulse && (
          <motion.span
            className="absolute inset-0 border border-cyan"
            animate={{ opacity: [0.7, 0], scale: [1, 1.5] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
            aria-hidden="true"
          />
        )}
      </span>
    );
  }
  return <span className={`${base} border-line bg-paper`} />;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[12px] text-ink-soft">{label}</dt>
      <dd className={`text-right text-[12.5px] text-ink ${mono ? "font-data" : ""}`}>{value}</dd>
    </div>
  );
}

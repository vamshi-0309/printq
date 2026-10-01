"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOrderStatus, type OrderStatus } from "@/hooks/useOrderStatus";
import { openCashfreeCheckout } from "@/lib/cashfreeCheckout";

/**
 * Everything after the order is placed: wait for the shop's approval if it
 * asks for one, pay, then watch the job move through the queue to the
 * printer.
 *
 * The payment step matches the rail the shop actually uses:
 *   "cashfree" — hosted checkout; the token appears by itself once the signed
 *                webhook confirms the payment, with no owner action.
 *   UPI / cash  — the customer pays the shop's own UPI ID or pays at the
 *                counter, and the owner confirms receipt. The copy says
 *                "waiting for the shop to confirm" rather than implying
 *                anything was automatically verified.
 *
 * Everything shown comes from /api/orders/status, which tells this customer
 * about their own order and nothing about anyone else's except the token now
 * at the printer.
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
    case "pending_approval":
    case "awaiting_topup":
      return 0;
    case "paid":
    case "queued":
    case "held":
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

const cashfreeEnv = () => (process.env.NEXT_PUBLIC_CASHFREE_ENV as "sandbox" | "production") ?? "sandbox";

export function OrderStatusPanel({
  orderUuid,
  customerSessionToken,
  publicOrderId,
  amount: initialAmount,
  shopName,
  onStartOver,
}: {
  orderUuid: string;
  customerSessionToken: string;
  publicOrderId: string;
  amount: number;
  shopName: string;
  onStartOver: () => void;
}) {
  const reduced = useReducedMotion();
  const { status, expired, refresh } = useOrderStatus(orderUuid, customerSessionToken);
  const ready = useReadyAlert(status);

  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const printStatus = status?.printStatus ?? "payment_pending";
  const token = status?.tokenNumber ?? null;
  const failed = printStatus === "failed";
  const done = printStatus === "completed";
  const index = stageIndex(printStatus);
  const amount = status?.amount ?? initialAmount;

  // "Pay now": fetch (or create) the checkout for whatever is owed now.
  const payNow = useCallback(async () => {
    setPaying(true);
    setPayError(null);
    try {
      const res = await fetch("/api/orders/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: orderUuid, customerSessionToken }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.paymentSessionId) {
        setPayError(body.error ?? "Couldn't start the payment. Try again in a moment.");
        return;
      }
      await openCashfreeCheckout(body.paymentSessionId, cashfreeEnv());
      refresh();
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Could not open the payment page.");
    } finally {
      setPaying(false);
    }
  }, [orderUuid, customerSessionToken, refresh]);

  if (expired) {
    return (
      <div className="space-y-4">
        <div className="border border-line bg-paper-grey/60 p-6 text-center">
          <p className="text-[14.5px] font-semibold text-ink">This order link has expired</p>
          <p className="mx-auto mt-2 max-w-xs text-[12.5px] leading-relaxed text-ink-soft">
            Order <span className="font-data text-ink">{publicOrderId}</span> is finished, or its file was
            deleted before it was paid for. If you still need help, ask at the counter.
          </p>
        </div>
        <StartOver onClick={onStartOver} />
      </div>
    );
  }

  if (printStatus === "rejected") {
    return (
      <div className="space-y-4">
        <div className="border-l-2 border-magenta bg-magenta/[0.05] px-4 py-4">
          <p className="text-[14px] font-semibold text-magenta">{shopName} couldn&apos;t accept this order</p>
          {status?.rejectionReason && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink">&ldquo;{status.rejectionReason}&rdquo;</p>
          )}
          <p className="mt-2 text-[12px] text-ink-soft">
            You haven&apos;t been charged, and your file has been deleted.
          </p>
        </div>
        <StartOver onClick={onStartOver} label="Upload a new document" />
      </div>
    );
  }

  const payment = status?.payment ?? null;
  const topup = payment?.kind === "topup";

  return (
    <div className="space-y-6">
      <AnimatePresence mode="wait" initial={false}>
        {printStatus === "pending_approval" ? (
          <motion.div key="approval" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="border border-line bg-paper p-6 text-center">
            <p className="font-data text-[10.5px] uppercase tracking-[0.18em] text-ink-soft">Waiting for the shop</p>
            <p className="mt-2 text-[15px] font-semibold text-ink">{shopName} is checking your order</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">
              Nothing has been charged. Once they approve it you&apos;ll be asked to pay{" "}
              <span className="font-data text-ink">&#8377;{amount}</span> here. Keep this page open.
            </p>
          </motion.div>
        ) : topup && payment ? (
          <motion.div key="topup" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="border-2 border-toner-yellow bg-toner-yellow/[0.07] p-6 text-center">
            <p className="text-[14px] font-semibold leading-snug text-ink">
              Your order total changed to &#8377;{amount} — pay &#8377;{payment.amount} more to continue
            </p>
            <p className="mt-2 text-[12px] text-ink-soft">
              {shopName} changed your order. It will print once the difference is paid.
            </p>
            <PayButtons payment={payment} upiLink={status?.upiLink ?? null} paying={paying} onPay={payNow} shopName={shopName} publicOrderId={publicOrderId} />
          </motion.div>
        ) : token ? (
          <motion.div
            key="token"
            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: EASE }}
            className={`border-2 p-7 text-center ${done ? "border-emerald-500 bg-emerald-50/60" : "border-cyan bg-cyan/[0.04]"}`}
          >
            <p className="font-data text-[10.5px] uppercase tracking-[0.18em] text-ink-soft">Your token</p>
            <p className="mt-2 font-data text-[52px] font-bold leading-none tracking-[-0.02em] text-ink">{token}</p>
            <p className="mt-3 text-[12.5px] text-ink-soft">Show this at the counter to collect</p>
          </motion.div>
        ) : (
          <motion.div key="pay" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="border border-line bg-paper p-6 text-center">
            <p className="font-data text-[10.5px] uppercase tracking-[0.18em] text-ink-soft">Amount to pay</p>
            <p className="mt-2 font-data text-[40px] font-bold leading-none tracking-[-0.02em] text-ink">&#8377;{amount}</p>
            <p className="mt-2 text-[12.5px] text-ink-soft">Paid directly to {shopName}</p>
            <PayButtons payment={payment} upiLink={status?.upiLink ?? null} paying={paying} onPay={payNow} shopName={shopName} publicOrderId={publicOrderId} />
          </motion.div>
        )}
      </AnimatePresence>

      {payError && (
        <p role="alert" className="border-l-2 border-magenta bg-magenta/[0.05] px-3 py-2.5 text-[12.5px] text-magenta">
          {payError}
        </p>
      )}

      {/* ── Where you are in the line ── */}
      {token && !done && !failed && !topup && (status?.queuePosition || status?.currentlyPrinting) && (
        <dl className="grid grid-cols-2 gap-px border border-line bg-line text-center">
          <div className="bg-paper px-3 py-3">
            <dt className="font-data text-[10px] uppercase tracking-[0.14em] text-ink-soft">Your position</dt>
            <dd className="mt-1 font-data text-[24px] font-bold text-ink">{status?.queuePosition ?? "—"}</dd>
          </div>
          <div className="bg-paper px-3 py-3">
            <dt className="font-data text-[10px] uppercase tracking-[0.14em] text-ink-soft">Currently printing</dt>
            <dd className="mt-1 font-data text-[24px] font-bold text-ink">
              {status?.queuePosition === 1 && !status.currentlyPrinting ? token : (status?.currentlyPrinting ?? "—")}
            </dd>
          </div>
          {status?.estimatedWaitMinutes != null && (
            <div className="col-span-2 bg-paper px-3 py-2 text-[12px] text-ink-soft">
              {status.estimatedWaitMinutes === 0
                ? "You're next."
                : `Roughly ${status.estimatedWaitMinutes} min — an estimate, not a promise.`}
            </div>
          )}
        </dl>
      )}

      {token && !done && !failed && <ReadyAlertOptIn alert={ready} />}

      {/* ── Progress rail ── */}
      <div>
        <ol className="space-y-0">
          {STAGES.map((stage, i) => {
            const state = failed && i >= index ? "failed" : i < index ? "done" : i === index ? "current" : "todo";
            return (
              <li key={stage.key} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <StageDot state={state} pulse={state === "current" && Boolean(token) && !done} />
                  {i < STAGES.length - 1 && (
                    <span className={`w-px flex-1 transition-colors ${i < index ? "bg-cyan" : "bg-line"}`} style={{ minHeight: 26 }} aria-hidden="true" />
                  )}
                </div>
                <div className={`pb-5 ${i === STAGES.length - 1 ? "pb-0" : ""}`}>
                  <p className={`text-[13.5px] font-semibold tracking-[-0.01em] ${state === "todo" ? "text-ink-soft/50" : "text-ink"}`}>
                    {stage.label}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-ink-soft">{stage.hint}</p>
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
        <motion.div initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="border border-emerald-500/40 bg-emerald-50/60 px-4 py-3.5 text-center">
          <p className="text-[13.5px] font-semibold text-emerald-800">Your print is ready to collect</p>
          <p className="mt-1 text-[12px] text-emerald-800/80">Your file has been deleted from the shop&apos;s computer.</p>
        </motion.div>
      )}

      <Receipt status={status} publicOrderId={publicOrderId} amount={amount} />

      <StartOver onClick={onStartOver} />
    </div>
  );
}

function PayButtons({
  payment,
  upiLink,
  paying,
  onPay,
  shopName,
  publicOrderId,
}: {
  payment: OrderStatus["payment"];
  upiLink: string | null;
  paying: boolean;
  onPay: () => void;
  shopName: string;
  publicOrderId: string;
}) {
  const primary =
    "mt-5 flex w-full items-center justify-center gap-2 border border-ink bg-ink px-6 py-3.5 text-[14.5px] font-medium text-paper transition-all hover:bg-ink-deep active:scale-[0.98] disabled:opacity-50 motion-reduce:active:scale-100";

  if (payment?.gateway === "cashfree") {
    return (
      <>
        <button type="button" onClick={onPay} disabled={paying} className={primary}>
          {paying ? "Opening…" : `Pay now · ₹${payment.amount}`}
        </button>
        <p className="mt-4 text-[11.5px] leading-relaxed text-ink-soft">
          Pay by UPI, card or netbanking. This page updates by itself once the payment is confirmed —
          usually within a few seconds.
        </p>
      </>
    );
  }
  if (upiLink) {
    return (
      <>
        <a href={upiLink} className={primary}>
          Open UPI app{payment ? ` · ₹${payment.amount}` : ""}
        </a>
        <p className="mt-4 text-[11.5px] leading-relaxed text-ink-soft">
          This page updates as soon as {shopName} confirms the payment. Keep it open.
        </p>
      </>
    );
  }
  return (
    <>
      <p className="mt-5 border border-line bg-paper-grey px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft">
        Pay at the counter and mention order <span className="font-data text-ink">{publicOrderId}</span>.
      </p>
      <p className="mt-4 text-[11.5px] leading-relaxed text-ink-soft">
        This page updates as soon as {shopName} confirms the payment. Keep it open.
      </p>
    </>
  );
}

function Receipt({ status, publicOrderId, amount }: { status: OrderStatus | null; publicOrderId: string; amount: number }) {
  const colour = !status
    ? ""
    : status.colorRanges && status.colorRanges.length > 0
      ? `${status.colorMode === "bw" ? "B&W" : "Colour"}, pages ${status.colorRanges.map((r) => r.range).join(",")} in ${status.colorRanges[0].mode === "bw" ? "B&W" : "colour"}`
      : status.colorMode === "bw"
        ? "B&W"
        : "Colour";
  return (
    <div className="border border-line bg-paper-grey/50 p-4">
      <p className="font-data text-[10.5px] uppercase tracking-[0.14em] text-ink-soft">Order details</p>
      <dl className="mt-3 space-y-1.5">
        <Row label="Order" value={publicOrderId} mono />
        {status && (
          <>
            <Row
              label="Print"
              value={`${status.pageCount ?? "—"} ${status.pageCount === 1 ? "page" : "pages"}${status.pageRange && status.pageRange !== "all" ? ` (${status.pageRange})` : ""} · ${status.copies} ${status.copies === 1 ? "copy" : "copies"}`}
            />
            <Row label="Colour" value={colour} />
            <Row
              label="Format"
              value={`${status.paperSize} · ${status.sides === "double" ? "Double" : "Single"} sided · ${status.orientation === "auto" ? "auto" : status.orientation} · ${status.fitMode === "actual" ? "actual size" : "fit to page"}`}
            />
          </>
        )}
        <Row label="Amount" value={`₹${amount}`} mono />
        {status && status.amountPaid > 0 && status.amountPaid !== amount && (
          <Row label="Paid so far" value={`₹${status.amountPaid}`} mono />
        )}
      </dl>
    </div>
  );
}

function StartOver({ onClick, label = "Print another document" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full border border-line py-3 text-[13.5px] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
    >
      {label}
    </button>
  );
}

/* ── "Tell me when it's ready" ───────────────────────────────────── */

type ReadyAlert = {
  supported: boolean;
  enabled: boolean;
  denied: boolean;
  enable: () => Promise<void>;
};

/**
 * A browser notification, a vibration and a short chime when the print is
 * ready. Opt-in: the permission prompt only appears when the customer taps
 * the button, which is also the user gesture that lets the chime play later.
 * No SMS or WhatsApp — this works only while the page is open in a tab.
 */
function useReadyAlert(status: OrderStatus | null): ReadyAlert {
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [permission, setPermission] = useState<string>(() =>
    supported ? Notification.permission : "unsupported"
  );
  const [wanted, setWanted] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef<string | null>(null);

  const enable = useCallback(async () => {
    setWanted(true);
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx && !audio.current) audio.current = new Ctx();
    } catch {
      // Sound is a nicety.
    }
    if (supported && Notification.permission === "default") {
      setPermission(await Notification.requestPermission());
    }
  }, [supported]);

  useEffect(() => {
    const now = status?.printStatus ?? null;
    const before = previous.current;
    previous.current = now;
    if (!wanted || now !== "completed" || before === null || before === "completed") return;

    if (supported && Notification.permission === "granted") {
      try {
        new Notification("Your print is ready", {
          body: status?.tokenNumber ? `Token ${status.tokenNumber} — collect it from the counter.` : "Collect it from the counter.",
          tag: `printq-${status?.orderId}`,
        });
      } catch {
        // Some mobile browsers only allow notifications from a service worker.
      }
    }
    navigator.vibrate?.([250, 120, 250]);
    chime(audio.current);
  }, [status, wanted, supported]);

  return { supported, enabled: wanted, denied: permission === "denied", enable };
}

function chime(ctx: AudioContext | null) {
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.25, t + i * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.22 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.22);
      osc.stop(t + i * 0.22 + 0.22);
    }
  } catch {
    // Ignore: the visual change and vibration still happen.
  }
}

function ReadyAlertOptIn({ alert }: { alert: ReadyAlert }) {
  if (alert.enabled) {
    return (
      <p className="text-center text-[12px] text-ink-soft">
        {alert.denied
          ? "Notifications are blocked, but this page will still buzz and chime when your print is ready."
          : "We'll alert you here when it's ready. Keep this tab open."}
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={alert.enable}
      className="w-full border border-cyan/40 bg-cyan/[0.05] py-3 text-[13.5px] font-medium text-cyan-deep transition-colors hover:bg-cyan/[0.1]"
    >
      🔔 Alert me when it&apos;s ready
    </button>
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

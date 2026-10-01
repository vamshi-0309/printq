"use client";

import { useState } from "react";
import type { OrderAction } from "@/lib/dashboardTypes";
import { confirmationFor } from "@/lib/orderActions";
import { formatRupees } from "@/components/dashboard/primitives";

/**
 * The owner's buttons for one order, used by the live queue and the order
 * page alike, so both offer exactly what the server will accept.
 *
 * The list comes from the server (availableActions). Anything irreversible
 * is behind a confirmation that says exactly what will happen, in rupees and
 * with the token the counter uses — e.g. "Cancel order A047? The customer has
 * already paid ₹24 — you'll need to refund them separately." Rejection asks
 * for the reason the customer will read. Editing a paid order down to a lower
 * price stops to confirm the exact refund before anything is changed.
 */

export interface OrderActionSubject {
  id: string;
  /** Token if issued, else the order id: what the counter calls it. */
  label: string;
  amount: number;
  moneyHeld: number;
  refundable: number;
  jobState: string | null;
  gateway: string | null;
  copies: number;
  colorMode: string;
  paperSize: string;
  sides: string;
  orientation: string;
  fitMode: string;
  pageRange: string;
  colorRanges: { range: string; mode: "bw" | "color" }[] | null;
}

type Panel =
  | { kind: "confirm"; action: OrderAction; message: string }
  | { kind: "reject" }
  | { kind: "edit" }
  | null;

export function OrderActions({
  order,
  actions,
  onDone,
  compact = false,
}: {
  order: OrderActionSubject;
  actions: OrderAction[];
  onDone: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  const printing = order.jobState === "PRINT_ATTEMPTED" || order.jobState === "PRINTING";

  const send = async (payload: Record<string, unknown>) => {
    setBusy(String(payload.action));
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/shop/orders/${order.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body };
    } catch {
      setError("Couldn't reach the server.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const run = async (action: OrderAction, extra: Record<string, unknown> = {}) => {
    const result = await send({ action: action.action, ...extra });
    if (!result) return;
    if (!result.ok) {
      setError(result.body.error ?? "That didn't work.");
      return;
    }
    setPanel(null);
    if (result.body.paymentWarning) {
      setNotice(`Approved. The payment link couldn't be created yet (${result.body.paymentWarning}); the customer can retry from their page.`);
    }
    onDone();
  };

  const click = (action: OrderAction) => {
    setError(null);
    if (action.action === "edit") return setPanel({ kind: "edit" });
    if (action.action === "reject") return setPanel({ kind: "reject" });
    const message = confirmationFor(action.action, {
      label: order.label,
      paidAmount: action.action === "refund" ? order.refundable : order.moneyHeld,
      gateway: order.gateway,
    });
    if (message) return setPanel({ kind: "confirm", action, message });
    void run(action);
  };

  if (actions.length === 0) {
    if (!printing) return null;
    return (
      <p
        className="border border-line bg-paper-grey/60 px-3 py-2 text-[12px] text-ink-soft"
        aria-disabled="true"
      >
        Printing — cannot be cancelled
      </p>
    );
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <button
            key={action.action}
            type="button"
            title={action.description}
            onClick={() => click(action)}
            disabled={busy !== null}
            className={`border px-3 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${
              action.destructive
                ? "border-magenta/40 bg-paper text-magenta hover:bg-magenta/[0.06]"
                : action.action === "approve" || action.action === "confirm_payment"
                  ? "border-cyan bg-cyan text-paper hover:bg-cyan-deep"
                  : "border-ink bg-paper text-ink hover:bg-paper-grey"
            }`}
          >
            {busy === action.action ? "Working…" : action.label}
          </button>
        ))}
      </div>

      {panel?.kind === "confirm" && (
        <ConfirmBox
          message={panel.message}
          confirmLabel={
            panel.action.action === "refund"
              ? `Yes, refund ${formatRupees(order.refundable)}`
              : `Yes, ${panel.action.label.toLowerCase()}`
          }
          busy={busy !== null}
          onConfirm={() =>
            run(panel.action, panel.action.action === "refund" ? { amount: order.refundable } : {})
          }
          onCancel={() => setPanel(null)}
        />
      )}

      {panel?.kind === "reject" && (
        <RejectBox
          label={order.label}
          busy={busy !== null}
          onReject={(reason) => run({ action: "reject", label: "Reject", description: "" }, { reason })}
          onCancel={() => setPanel(null)}
        />
      )}

      {panel?.kind === "edit" && (
        <EditPanel
          order={order}
          send={send}
          onSaved={(message) => {
            setPanel(null);
            setNotice(message);
            onDone();
          }}
          onCancel={() => setPanel(null)}
        />
      )}

      {notice && <p className="text-[12.5px] text-ink">{notice}</p>}
      {error && (
        <p role="alert" className="text-[12.5px] text-magenta">
          {error}
        </p>
      )}
    </div>
  );
}

function ConfirmBox({
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alertdialog" aria-label="Confirm" className="border border-magenta/30 bg-magenta/[0.04] px-3.5 py-3">
      <p className="text-[13px] leading-relaxed text-ink">{message}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="border border-magenta bg-magenta px-3 py-1.5 text-[12.5px] font-medium text-paper disabled:opacity-50"
        >
          {busy ? "Working…" : confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border border-line px-3 py-1.5 text-[12.5px] text-ink-soft hover:border-ink hover:text-ink"
        >
          Go back
        </button>
      </div>
    </div>
  );
}

function RejectBox({
  label,
  busy,
  onReject,
  onCancel,
}: {
  label: string;
  busy: boolean;
  onReject: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div role="alertdialog" aria-label="Reject order" className="border border-magenta/30 bg-magenta/[0.04] px-3.5 py-3">
      <p className="text-[13px] leading-relaxed text-ink">
        Reject order {label}? The customer will see your reason, and their file will be deleted now.
        They have not paid anything.
      </p>
      <label className="mt-2.5 block text-[12px] text-ink-soft">
        Reason the customer will read
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={2}
          className="mt-1 block w-full border border-line bg-paper px-2.5 py-2 text-[13px] text-ink focus:border-ink focus:outline-none"
          placeholder="e.g. The scan is too blurry to print — please upload a clearer copy."
        />
      </label>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onReject(reason.trim())}
          disabled={busy || reason.trim().length === 0}
          className="border border-magenta bg-magenta px-3 py-1.5 text-[12.5px] font-medium text-paper disabled:opacity-50"
        >
          {busy ? "Working…" : "Yes, reject"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="border border-line px-3 py-1.5 text-[12.5px] text-ink-soft hover:border-ink hover:text-ink"
        >
          Go back
        </button>
      </div>
    </div>
  );
}

type SendFn = (payload: Record<string, unknown>) => Promise<{ ok: boolean; status: number; body: Record<string, unknown> } | null>;

function EditPanel({
  order,
  send,
  onSaved,
  onCancel,
}: {
  order: OrderActionSubject;
  send: SendFn;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const colourPagesOf = (ranges: OrderActionSubject["colorRanges"], mode: string) =>
    (ranges ?? []).filter((r) => r.mode !== mode).map((r) => r.range).join(",");

  const [copies, setCopies] = useState(order.copies);
  const [colorMode, setColorMode] = useState(order.colorMode);
  const [paperSize, setPaperSize] = useState(order.paperSize);
  const [sides, setSides] = useState(order.sides);
  const [orientation, setOrientation] = useState(order.orientation || "auto");
  const [fitMode, setFitMode] = useState(order.fitMode || "fit");
  const [pageRange, setPageRange] = useState(order.pageRange || "all");
  const [otherPages, setOtherPages] = useState(colourPagesOf(order.colorRanges, order.colorMode));
  const [refundAsk, setRefundAsk] = useState<{ amount: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const changes = () => ({
    copies,
    colorMode,
    paperSize,
    sides,
    orientation,
    fitMode,
    pageRange: pageRange.trim() || "all",
    colorRanges: otherPages.trim()
      ? [{ range: otherPages.trim(), mode: colorMode === "bw" ? "color" : "bw" }]
      : null,
  });

  const save = async (confirmRefund = false) => {
    setSaving(true);
    setError(null);
    const result = await send({ action: "edit", changes: changes(), confirmRefund });
    setSaving(false);
    if (!result) return;
    const b = result.body as Record<string, unknown>;
    if (!result.ok) {
      if (b.code === "needs_refund_confirmation") {
        setRefundAsk({ amount: Number(b.refundAmount), message: String(b.error) });
        return;
      }
      setError(String(b.error ?? "Couldn't save the change."));
      return;
    }
    const amount = formatRupees(Number(b.amount));
    const warning = b.warning ? ` ${b.warning}` : "";
    switch (b.outcome) {
      case "unchanged":
        return onSaved("Nothing changed.");
      case "topup": {
        const topup = b.topup as { amount: number } | null;
        return onSaved(
          `Saved. New total ${amount}. The customer has been asked to pay ${formatRupees(topup?.amount ?? 0)} more — it won't print until they do.${warning}`
        );
      }
      case "refunded": {
        const refund = b.refund as { amount: number; ok: boolean } | null;
        return onSaved(
          refund?.ok
            ? `Saved. New total ${amount}. Refund of ${formatRupees(refund.amount)} started.`
            : `Saved. New total ${amount}.${warning}`
        );
      }
      case "reissued":
        return onSaved(`Saved. New total ${amount}. The customer's payment link now asks for ${amount}.${warning}`);
      default:
        return onSaved(`Saved. New total ${amount}.${warning}`);
    }
  };

  const field = "mt-1 block w-full border border-line bg-paper px-2 py-1.5 text-[13px] text-ink focus:border-ink focus:outline-none";
  const claimedNote = order.jobState === "CLAIMED";

  return (
    <div className="border border-line bg-paper-grey/40 px-3.5 py-3">
      <p className="text-[13px] font-medium text-ink">Edit order {order.label}</p>
      {claimedNote && (
        <p className="mt-1 text-[12px] text-ink-soft">
          The agent has picked this up but not started printing. Saving takes it back and it prints with the new settings.
        </p>
      )}
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
        <label className="text-[12px] text-ink-soft">
          Copies
          <input type="number" min={1} max={500} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} className={field} />
        </label>
        <label className="text-[12px] text-ink-soft">
          Colour
          <select value={colorMode} onChange={(e) => setColorMode(e.target.value)} className={field}>
            <option value="bw">Black &amp; white</option>
            <option value="color">Colour</option>
          </select>
        </label>
        <label className="text-[12px] text-ink-soft">
          Paper
          <select value={paperSize} onChange={(e) => setPaperSize(e.target.value)} className={field}>
            <option value="A4">A4</option>
            <option value="A3">A3</option>
          </select>
        </label>
        <label className="text-[12px] text-ink-soft">
          Sides
          <select value={sides} onChange={(e) => setSides(e.target.value)} className={field}>
            <option value="single">Single</option>
            <option value="double">Double</option>
          </select>
        </label>
        <label className="text-[12px] text-ink-soft">
          Orientation
          <select value={orientation} onChange={(e) => setOrientation(e.target.value)} className={field}>
            <option value="auto">Auto</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        <label className="text-[12px] text-ink-soft">
          Scaling
          <select value={fitMode} onChange={(e) => setFitMode(e.target.value)} className={field}>
            <option value="fit">Fit to page</option>
            <option value="actual">Actual size</option>
          </select>
        </label>
        <label className="col-span-2 text-[12px] text-ink-soft">
          Pages (all, or e.g. 1-5,8)
          <input value={pageRange} onChange={(e) => setPageRange(e.target.value)} className={field} />
        </label>
        <label className="col-span-2 text-[12px] text-ink-soft sm:col-span-4">
          {colorMode === "bw" ? "Pages to print in colour (optional)" : "Pages to print in black & white (optional)"}
          <input value={otherPages} onChange={(e) => setOtherPages(e.target.value)} placeholder="e.g. 3-4" className={field} />
        </label>
      </div>

      {refundAsk ? (
        <div role="alertdialog" className="mt-3 border border-magenta/30 bg-magenta/[0.04] px-3 py-2.5">
          <p className="text-[13px] text-ink">{refundAsk.message}</p>
          <p className="mt-1 text-[12px] text-ink-soft">
            {order.gateway === "cashfree"
              ? "It goes back through Cashfree to how they paid."
              : "PrintQ can't send this money — pay them back yourself; this records that you did."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => save(true)} disabled={saving} className="border border-magenta bg-magenta px-3 py-1.5 text-[12.5px] font-medium text-paper disabled:opacity-50">
              {saving ? "Working…" : `Yes, refund ${formatRupees(refundAsk.amount)}`}
            </button>
            <button type="button" onClick={() => setRefundAsk(null)} className="border border-line px-3 py-1.5 text-[12.5px] text-ink-soft hover:border-ink hover:text-ink">
              Go back
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => save(false)} disabled={saving} className="border border-ink bg-ink px-3 py-1.5 text-[12.5px] font-medium text-paper disabled:opacity-50">
            {saving ? "Saving…" : "Save and reprice"}
          </button>
          <button type="button" onClick={onCancel} className="border border-line px-3 py-1.5 text-[12.5px] text-ink-soft hover:border-ink hover:text-ink">
            Cancel
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[12.5px] text-magenta">{error}</p>}
    </div>
  );
}

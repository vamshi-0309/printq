"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OrderActions } from "@/components/dashboard/OrderActions";
import { useDashboardResource } from "@/hooks/useDashboardResource";
import type { OverviewResponse, QueueItem } from "@/lib/dashboardTypes";
import {
  PageHeader,
  StatCard,
  StatusPill,
  SectionHeading,
  ErrorNote,
  formatRupees,
  relativeTime,
  absoluteTime,
} from "@/components/dashboard/primitives";

/**
 * The screen a shop owner leaves open all day.
 *
 * It answers three questions in the order they matter:
 *
 *   1. Is anything wrong right now? Blockers come first, above the numbers,
 *      because a stalled queue is worth more of the owner's attention than
 *      today's takings.
 *   2. What is waiting? The live queue, with each job's real state.
 *   3. How is today going? Money and volume, on the shop's own day boundary.
 *
 * The three health signals are shown separately and never merged into one
 * light. "Open" is about whether customers can order; "Agent" is about whether
 * the counter PC is connected; "Printer" is about whether there is anything to
 * print with. A shop can be open, taking money, with a dead agent — and that
 * is precisely the situation this page exists to make obvious.
 */

export default function DashboardPage() {
  const { data, error, loading, refreshing, updatedAt, refresh } =
    useDashboardResource<OverviewResponse>("/api/shop/overview", {
      // The shop id arrives with the first response; the subscription starts
      // as soon as it does.
      realtimeShopIdFrom: (d) => d.shop.id,
    });

  // A one-second tick for the live order ages.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (loading) {
    return <OverviewSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Today" onRefresh={refresh} refreshing={refreshing} />
        <ErrorNote>{error ?? "Could not load your shop."}</ErrorNote>
      </div>
    );
  }

  const { readiness, today, queue, counts, shop, settings, controls, printerIssue, agentUpdate } = data;
  // The server's clock, advanced locally so order ages tick between refreshes.
  const now = Date.parse(data.serverTime) + Math.max(0, clock - (updatedAt ?? clock));

  return (
    <div className="space-y-7">
      <PageHeader
        title="Today"
        description={`${shop.name}${shop.city ? ` · ${shop.city}` : ""}`}
        updatedAt={updatedAt}
        refreshing={refreshing}
        onRefresh={refresh}
      />

      <ShopSwitches controls={controls} onChanged={refresh} />

      {!readiness.agentOnline && readiness.agents.length > 0 && (
        <section
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-2 border-magenta bg-magenta/[0.06] px-4 py-3"
        >
          <div>
            <p className="text-[15px] font-semibold text-magenta">Agent offline</p>
            <p className="text-[12.5px] text-ink-soft">
              Orders keep coming in and wait safely in the queue. They print, in order, as soon as the
              PrintQ agent on your counter PC reconnects.
            </p>
          </div>
          <Link href="/dashboard/agent" className="shrink-0 border border-ink bg-ink px-3 py-1.5 text-[12.5px] font-medium text-paper">
            Check the agent
          </Link>
        </section>
      )}

      {agentUpdate && (
        <section role="alert" className="flex flex-wrap items-center justify-between gap-3 border-2 border-magenta bg-magenta/[0.06] px-4 py-3">
          <div>
            <p className="text-[15px] font-semibold text-magenta">Update the PrintQ agent</p>
            <p className="text-[12.5px] text-ink-soft">
              Your counter PC runs version {agentUpdate.installed}. Orders now carry orientation, fit-to-page and
              mixed colour settings that need version {agentUpdate.required} or later, so they wait in the queue
              instead of printing wrongly. Install the new version and they print straight away.
            </p>
          </div>
          <Link href="/downloads/windows" className="shrink-0 border border-ink bg-ink px-3 py-1.5 text-[12.5px] font-medium text-paper">
            Download the agent
          </Link>
        </section>
      )}

      {printerIssue && (
        <section role="alert" className="border-2 border-toner-yellow bg-toner-yellow/[0.08] px-4 py-3">
          <p className="text-[15px] font-semibold text-ink">
            ⚠ Printer issue
            {printerIssue.waitingOrder ? ` — Order ${printerIssue.waitingOrder} is waiting` : ""}
          </p>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            {printerIssue.printer}: {printerIssue.problem}.{" "}
            {printerIssue.waitingCount > 0
              ? `${printerIssue.waitingCount} order${printerIssue.waitingCount === 1 ? " is" : "s are"} held in the queue and will print once it's fixed. Nothing is sent to another printer.`
              : "Nothing will print until it's fixed."}
          </p>
        </section>
      )}

      {/* Three signals, kept apart on purpose. */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={readiness.acceptingOrders ? "success" : "danger"}>
          {readiness.acceptingOrders ? "Open for orders" : "Not accepting orders"}
        </StatusPill>
        <StatusPill tone={readiness.agentOnline ? "success" : "danger"}>
          {readiness.agentOnline ? "Agent online" : "Agent offline"}
        </StatusPill>
        {/*
          "Ready" means a job sent now would print. Enabled printers behind a
          dead agent are not ready, however many there are — saying otherwise
          would put a reassuring green pill next to a queue that cannot move.
        */}
        <StatusPill
          tone={
            !readiness.printerAvailable
              ? "danger"
              : readiness.agentOnline
                ? "success"
                : "warning"
          }
        >
          {!readiness.printerAvailable
            ? "No printer ready"
            : readiness.agentOnline
              ? `${readiness.enabledPrinterCount} printer${readiness.enabledPrinterCount === 1 ? "" : "s"} ready`
              : `${readiness.enabledPrinterCount} printer${readiness.enabledPrinterCount === 1 ? "" : "s"}, unreachable`}
        </StatusPill>
        {readiness.activeAgent && (
          <span className="font-data text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
            {readiness.activeAgent.hostname ?? "agent"} · last seen{" "}
            {relativeTime(readiness.activeAgent.last_heartbeat_at, now)}
          </span>
        )}
      </div>

      {readiness.blockers.length > 0 && (
        <section className="border border-magenta/30 bg-magenta/[0.03]">
          <div className="border-b border-magenta/20 px-4 py-2.5">
            <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.12em] text-magenta">
              {readiness.blockers.length === 1
                ? "Something needs your attention"
                : `${readiness.blockers.length} things need your attention`}
            </p>
          </div>
          <ul className="divide-y divide-magenta/15">
            {readiness.blockers.map((b) => (
              <li key={b.code} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-ink">{b.title}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">{b.detail}</p>
                </div>
                {b.href && (
                  <Link
                    href={b.href}
                    className="shrink-0 border border-ink bg-ink px-3 py-1.5 text-[12.5px] font-medium text-paper transition-colors hover:bg-ink-soft"
                  >
                    {b.action ?? "Fix this"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <SetupChecklist data={data} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Paid today"
          value={today.paidOrders}
          hint={
            today.unpaidOrders > 0
              ? `${today.unpaidOrders} more not paid for yet`
              : "orders paid for today"
          }
        />
        <StatCard label="Earned today" value={formatRupees(today.revenue)} hint="from paid orders" />
        <StatCard
          label="Pages printed"
          value={today.pagesPrinted}
          hint={
            today.pagesOrdered > today.pagesPrinted
              ? `${today.pagesOrdered - today.pagesPrinted} more paid for, not printed yet`
              : "confirmed by the agent"
          }
        />
        <StatCard
          label="Waiting"
          value={counts.active}
          tone={counts.blocked > 0 ? "danger" : counts.active > 0 ? "warning" : "neutral"}
          hint={
            counts.blocked > 0
              ? `${counts.blocked} stuck · ${formatRupees(counts.unprintedValue)} paid, unprinted`
              : counts.unprintedValue > 0
                ? `${formatRupees(counts.unprintedValue)} paid, not printed yet`
                : counts.awaitingPayment > 0
                  // Saying "₹0 paid, not printed" next to an unpaid order is
                  // technically true and useless. Describe what is actually there.
                  ? `${counts.awaitingPayment} waiting to be paid for`
                  : "nothing in the queue"
          }
        />
      </div>

      <section className="space-y-3">
        <SectionHeading
          eyebrow="Live"
          title="Queue"
          action={
            <Link
              href="/dashboard/orders"
              className="font-data text-[10.5px] uppercase tracking-[0.1em] text-cyan hover:text-cyan-deep"
            >
              All orders →
            </Link>
          }
        />

        {queue.length === 0 ? (
          <div className="border border-line bg-paper px-6 py-12 text-center">
            <p className="text-[14px] font-medium text-ink">Nothing waiting</p>
            <p className="mt-1 text-[12.5px] text-ink-soft">
              {today.paidOrders > 0
                ? "Everything paid for today has been dealt with."
                : "New orders appear here the moment a customer pays."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line border border-line bg-paper">
            {queue.map((order) => (
              <QueueRow
                key={order.id}
                order={order}
                now={now}
                gateway={settings.paymentGateway}
                onChanged={refresh}
              />
            ))}
          </ul>
        )}
      </section>

      <p className="pt-2 font-data text-[10.5px] uppercase tracking-[0.1em] text-ink-soft">
        Files are deleted automatically after {settings.fileRetentionHours} hours
      </p>
    </div>
  );
}

function QueueRow({
  order,
  now,
  gateway,
  onChanged,
}: {
  order: QueueItem;
  now: number;
  gateway: string | null;
  onChanged: () => void;
}) {
  const colour =
    order.colorRanges && order.colorRanges.length > 0
      ? `Mixed (${order.colorMode === "bw" ? "colour" : "B&W"} ${order.colorRanges.map((r) => r.range).join(",")})`
      : order.colorMode === "bw"
        ? "B&W"
        : "Colour";

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <span className="w-14 shrink-0 font-data text-[19px] font-semibold leading-none tracking-[-0.02em] text-ink">
          {order.tokenNumber ?? <span className="text-ink-soft/50">—</span>}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/orders/${order.id}`}
              className="font-data text-[12px] text-ink-soft underline-offset-2 hover:text-ink hover:underline"
            >
              {order.publicOrderId}
            </Link>
            <StatusPill tone={order.state.tone}>{order.state.label}</StatusPill>
            <PaymentPill status={order.paymentStatus} jobState={order.jobState} />
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">{order.state.detail}</p>
          <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-data text-[10.5px] uppercase tracking-[0.06em] text-ink-soft">
            <Spec label="pages">
              {order.pageCount ?? "?"}
              {order.pageRange && order.pageRange !== "all" ? ` (${order.pageRange})` : ""}
            </Spec>
            <Spec label="copies">{order.copies}</Spec>
            <Spec label="colour">{colour}</Spec>
            <Spec label="paper">{order.paperSize}</Spec>
            <Spec label="orient.">{order.orientation}</Spec>
            <Spec label="sides">{order.sides === "double" ? "duplex" : "single"}</Spec>
            <Spec label="scale">{order.fitMode === "actual" ? "actual" : "fit"}</Spec>
            <Spec label="printer">{order.printerName ?? "none chosen"}</Spec>
          </dl>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-data text-[13px] text-ink">{formatRupees(order.amount)}</p>
          <p className="font-data text-[10.5px] uppercase tracking-[0.08em] text-ink-soft" title={absoluteTime(order.createdAt)}>
            age {orderAge(order.createdAt, now)}
          </p>
        </div>
      </div>

      <div className="mt-2.5 sm:pl-[4.5rem]">
        <OrderActions
          compact
          order={{
            id: order.id,
            label: order.tokenNumber ?? order.publicOrderId,
            amount: order.amount,
            moneyHeld: order.moneyHeld,
            refundable: order.refundable,
            jobState: order.jobState,
            gateway,
            copies: order.copies,
            colorMode: order.colorMode,
            paperSize: order.paperSize,
            sides: order.sides,
            orientation: order.orientation,
            fitMode: order.fitMode,
            pageRange: order.pageRange,
            colorRanges: order.colorRanges,
          }}
          actions={order.actions}
          onDone={onChanged}
        />
      </div>
    </li>
  );
}

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1">
      <dt className="text-ink-soft/70">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function PaymentPill({ status, jobState }: { status: string; jobState: string | null }) {
  if (jobState === "AWAITING_TOPUP") return <StatusPill tone="warning">Owes more</StatusPill>;
  if (status === "paid") return <StatusPill tone="success">Paid</StatusPill>;
  if (jobState === "PENDING_APPROVAL") return <StatusPill tone="neutral">Not charged</StatusPill>;
  if (status === "failed") return <StatusPill tone="danger">Payment failed</StatusPill>;
  return <StatusPill tone="warning">Unpaid</StatusPill>;
}

/** "4m 12s", "1h 03m" — how long the customer has been waiting. */
function orderAge(createdAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * The owner's two switches, at the top of the screen, plus how orders print.
 * Each flip is saved at once and takes effect on the customer page and in the
 * order route on the next request.
 */
function ShopSwitches({
  controls,
  onChanged,
}: {
  controls: OverviewResponse["controls"];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (key: string, patch: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/shop/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controls: patch }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Couldn't save that.");
        return;
      }
      onChanged();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-wrap items-stretch gap-2">
      <Switch
        label="Shop"
        on={controls.shopOpen}
        onText="Open"
        offText="Closed"
        hint={controls.shopOpen ? "Customers can upload" : "Customers see “closed”"}
        busy={busy === "open"}
        onToggle={() => save("open", { shopOpen: !controls.shopOpen })}
      />
      <Switch
        label="New orders"
        on={controls.acceptingOrders}
        onText="Accepting"
        offText="Paused"
        hint={controls.acceptingOrders ? "Customers can order" : "Browse & preview only"}
        busy={busy === "accepting"}
        disabled={!controls.shopOpen}
        onToggle={() => save("accepting", { acceptingOrders: !controls.acceptingOrders })}
      />
      <div className="flex min-w-[12rem] flex-1 flex-col justify-center border border-line bg-paper px-3 py-2">
        <p className="font-data text-[10px] uppercase tracking-[0.12em] text-ink-soft">Printing</p>
        <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Printing mode">
          {(
            [
              ["automatic", "Automatic"],
              ["approval_required", "Approve first"],
            ] as const
          ).map(([mode, text]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={controls.printingMode === mode}
              disabled={busy !== null}
              onClick={() => controls.printingMode !== mode && save("mode", { printingMode: mode })}
              className={`border px-2.5 py-1 text-[12px] font-medium transition-colors ${
                controls.printingMode === mode
                  ? "border-ink bg-ink text-paper"
                  : "border-line text-ink-soft hover:border-ink hover:text-ink"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="w-full text-[12.5px] text-magenta">
          {error}
        </p>
      )}
    </section>
  );
}

function Switch({
  label,
  on,
  onText,
  offText,
  hint,
  busy,
  disabled,
  onToggle,
}: {
  label: string;
  on: boolean;
  onText: string;
  offText: string;
  hint: string;
  busy: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label}: ${on ? onText : offText}`}
      onClick={onToggle}
      disabled={busy || disabled}
      className={`flex min-w-[10rem] flex-1 items-center justify-between gap-3 border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
        on ? "border-emerald-500/40 bg-emerald-50/60" : "border-magenta/40 bg-magenta/[0.05]"
      }`}
    >
      <span>
        <span className="block font-data text-[10px] uppercase tracking-[0.12em] text-ink-soft">{label}</span>
        <span className={`block text-[14px] font-semibold ${on ? "text-emerald-800" : "text-magenta"}`}>
          {busy ? "Saving…" : on ? onText : offText}
        </span>
        <span className="block text-[11px] text-ink-soft">{hint}</span>
      </span>
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-ink-soft/40"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-paper transition-all ${on ? "left-[1.125rem]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

/** Only shows steps that are genuinely incomplete. */
function SetupChecklist({ data }: { data: OverviewResponse }) {
  const steps = [
    {
      done: data.settings.pricingConfigured,
      label: "Set your per-page rates",
      href: "/dashboard/pricing",
    },
    {
      done: Boolean(data.settings.paymentGateway) || data.settings.hasUpiId,
      label: "Add a way for customers to pay you",
      href: "/dashboard/settings",
    },
    {
      done: data.readiness.agents.length > 0,
      label: "Pair the PrintQ agent on your counter PC",
      href: "/dashboard/agent",
    },
    {
      done: data.readiness.printerCount > 0,
      label: "Get your printers detected",
      href: "/dashboard/printers",
    },
  ];

  const remaining = steps.filter((s) => !s.done);
  if (remaining.length === 0) return null;

  return (
    <section className="border border-cyan/25 bg-cyan/[0.04] px-4 py-3.5">
      <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.12em] text-cyan-deep">
        Finish setting up · {steps.length - remaining.length} of {steps.length} done
      </p>
      <ul className="mt-2.5 space-y-1.5">
        {remaining.map((step) => (
          <li key={step.href} className="flex items-center gap-2 text-[13px]">
            <span className="h-3 w-3 shrink-0 border border-cyan/50" aria-hidden="true" />
            <Link href={step.href} className="text-ink underline-offset-2 hover:underline">
              {step.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-7">
      <div className="h-8 w-40 animate-pulse bg-line/60" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse border border-line bg-paper" />
        ))}
      </div>
      <div className="h-48 animate-pulse border border-line bg-paper" />
    </div>
  );
}

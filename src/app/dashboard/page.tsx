"use client";

import Link from "next/link";
import { useState } from "react";
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

  const { readiness, today, queue, counts, shop, settings } = data;
  const now = Date.parse(data.serverTime);

  return (
    <div className="space-y-7">
      <PageHeader
        title="Today"
        description={`${shop.name}${shop.city ? ` · ${shop.city}` : ""}`}
        updatedAt={updatedAt}
        refreshing={refreshing}
        onRefresh={refresh}
      />

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
              <QueueRow key={order.id} order={order} now={now} onChanged={refresh} />
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
  onChanged,
}: {
  order: QueueItem;
  now: number;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmPayment = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shop/orders/${order.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm_payment" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not confirm this payment.");
        return;
      }
      onChanged();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">{order.state.detail}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-data text-[13px] text-ink">{formatRupees(order.amount)}</p>
          <p className="font-data text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
            {order.pageCount ?? "?"}p × {order.copies} · {order.colorMode === "bw" ? "B&W" : "Colour"}{" "}
            · {order.paperSize}
          </p>
        </div>

        {order.state.key === "awaiting_payment" ? (
          <button
            type="button"
            onClick={confirmPayment}
            disabled={busy}
            className="shrink-0 border border-cyan bg-cyan px-3 py-1.5 text-[12.5px] font-medium text-paper transition-colors hover:bg-cyan-deep disabled:opacity-50"
          >
            {busy ? "Confirming…" : "Mark as paid"}
          </button>
        ) : (
          <Link
            href={`/dashboard/orders/${order.id}`}
            className="shrink-0 border border-line px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink"
          >
            Open
          </Link>
        )}
      </div>

      <p className="mt-1.5 font-data text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
        {order.paidAt ? `paid ${relativeTime(order.paidAt, now)}` : `uploaded ${relativeTime(order.createdAt, now)}`}
        {" · "}
        {absoluteTime(order.createdAt)}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-[12.5px] text-magenta">
          {error}
        </p>
      )}
    </li>
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

"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useDashboardResource } from "@/hooks/useDashboardResource";
import type { OrderDetailResponse } from "@/lib/dashboardTypes";
import { OrderActions } from "@/components/dashboard/OrderActions";
import {
  PageHeader,
  StatusPill,
  SectionHeading,
  ErrorNote,
  InfoNote,
  formatRupees,
  absoluteTime,
  relativeTime,
} from "@/components/dashboard/primitives";

/**
 * One order, and everything the owner can do about it.
 *
 * The screen is built around a distinction the dashboard has to keep straight:
 * what the customer paid for, versus what the agent actually did. The timeline
 * shows both, in the order they happened, and never fills a gap with a guess —
 * if the agent has not reported an attempt, the attempt section says so rather
 * than implying the job is on its way to a printer.
 *
 * The file is reached through a deliberate click that mints a two-minute
 * signed URL. There is no permanent link on the page, because there is no
 * permanent link to the file: the bucket is private.
 */

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const { data, error, loading, refreshing, updatedAt, refresh } =
    useDashboardResource<OrderDetailResponse>(`/api/shop/orders/${orderId}`);

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="h-8 w-48 animate-pulse bg-line/60" />
        <div className="h-64 animate-pulse border border-line bg-paper" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorNote>{error ?? "This order could not be loaded."}</ErrorNote>
      </div>
    );
  }

  const { order, file, payment, job, attempts, actions, queuePosition, payments, printer } = data;
  const now = Date.parse(data.serverTime);

  return (
    <div className="space-y-6">
      <BackLink />

      <PageHeader
        title={order.tokenNumber ? `Token ${order.tokenNumber}` : "Order"}
        description={`${order.publicOrderId} · placed ${absoluteTime(order.createdAt)}`}
        updatedAt={updatedAt}
        refreshing={refreshing}
        onRefresh={refresh}
      >
        <StatusPill tone={order.state.tone}>{order.state.label}</StatusPill>
      </PageHeader>

      <p className="text-[13.5px] leading-relaxed text-ink-soft">{order.state.detail}</p>

      <section className="border border-line bg-paper px-4 py-3.5">
        <p className="mb-3 font-data text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
          What do you want to do
        </p>
        <OrderActions
          order={{
            id: order.id,
            label: order.tokenNumber ?? order.publicOrderId,
            amount: order.amount,
            moneyHeld: data.moneyHeld,
            refundable: data.refundable,
            jobState: job?.state ?? null,
            gateway: data.shopGateway,
            copies: order.copies,
            colorMode: order.colorMode,
            paperSize: order.paperSize,
            sides: order.sides,
            orientation: order.orientation,
            fitMode: order.fitMode,
            pageRange: order.pageRange,
            colorRanges: order.colorRanges,
          }}
          actions={actions}
          onDone={refresh}
        />
        {actions.length === 0 && job?.state !== "PRINT_ATTEMPTED" && job?.state !== "PRINTING" && (
          <p className="text-[12.5px] text-ink-soft">Nothing to do on this order.</p>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-5">
          <section className="border border-line bg-paper">
            <div className="border-b border-line px-4 py-2.5">
              <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                What was ordered
              </p>
            </div>
            <dl className="divide-y divide-line text-[13px]">
              <Row label="Pages">
                {order.pageCount ?? "unknown"}
                {order.pageRange && order.pageRange !== "all" ? ` (range ${order.pageRange})` : ""}
              </Row>
              <Row label="Copies">{order.copies}</Row>
              <Row label="Colour">
                {order.colorMode === "bw" ? "Black & white" : "Colour"}
                {order.colorRanges && order.colorRanges.length > 0 &&
                  ` · ${order.colorRanges.map((r) => `${r.range} in ${r.mode === "bw" ? "B&W" : "colour"}`).join(", ")}`}
              </Row>
              <Row label="Paper">{order.paperSize}</Row>
              <Row label="Sides">{order.sides === "double" ? "Double-sided" : "Single-sided"}</Row>
              <Row label="Orientation">{order.orientation}</Row>
              <Row label="Scaling">{order.fitMode === "actual" ? "Actual size" : "Fit to page"}</Row>
              <Row label="Printer">
                {printer ? (
                  <>
                    {printer.displayName}
                    {printer.displayName !== printer.systemName && (
                      <span className="block font-data text-[10.5px] text-ink-soft">{printer.systemName}</span>
                    )}
                  </>
                ) : (
                  "none chosen"
                )}
              </Row>
            </dl>
          </section>

          <FileCard orderId={order.id} file={file} />
        </div>

        <div className="space-y-5">
          <section className="border border-line bg-paper">
            <div className="border-b border-line px-4 py-2.5">
              <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                Payment
              </p>
            </div>
            <dl className="divide-y divide-line text-[13px]">
              <Row label="Total">
                <span className="font-data text-[15px] font-semibold text-ink">
                  {formatRupees(order.amount)}
                </span>
              </Row>
              {order.priceBreakdown && (
                <>
                  <Row label="Rate">
                    {formatRupees(order.priceBreakdown.perPageRate)} × {order.priceBreakdown.effectivePages} pages
                  </Row>
                  {order.priceBreakdown.duplexDiscount > 0 && (
                    <Row label="Double-sided discount">
                      −{formatRupees(order.priceBreakdown.duplexDiscount)}
                    </Row>
                  )}
                  {order.priceBreakdown.minimumApplied && (
                    <Row label="Minimum charge">applied</Row>
                  )}
                </>
              )}
              <Row label="Status">{order.paymentStatus}</Row>
              <Row label="Customer has paid">{formatRupees(data.moneyHeld)}</Row>
              {data.refundable > 0 && (
                <Row label="Refund due">
                  <span className="font-semibold text-magenta">{formatRupees(data.refundable)}</span>
                </Row>
              )}
              {payment && (
                <>
                  <Row label="Method">
                    {payment.method === "gateway"
                      ? `${payment.gateway ?? "gateway"} (verified automatically)`
                      : "UPI, confirmed by you"}
                  </Row>
                  {payment.reference && (
                    <Row label="Reference">
                      <span className="font-data text-[11.5px] break-all">{payment.reference}</span>
                    </Row>
                  )}
                  <Row label="Paid at">{absoluteTime(payment.verifiedAt ?? order.paidAt)}</Row>
                </>
              )}
            </dl>
          </section>

          {payments.length > 1 && (
            <section className="border border-line bg-paper">
              <div className="border-b border-line px-4 py-2.5">
                <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
                  Every charge on this order
                </p>
              </div>
              <ul className="divide-y divide-line text-[12.5px]">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                    <span className="text-ink">
                      {p.purpose === "topup" ? "Extra payment" : "Payment"} {formatRupees(p.amount)}
                      <span className="ml-1.5 font-data text-[10.5px] uppercase text-ink-soft">{p.status}</span>
                    </span>
                    <span className="font-data text-[10.5px] text-ink-soft">
                      {p.refundAmount
                        ? `refund ${formatRupees(p.refundAmount)} ${p.refundStatus ?? ""}`
                        : absoluteTime(p.verifiedAt ?? p.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3">
            <SectionHeading eyebrow="Evidence" title="What actually happened" />
            <Timeline data={data} now={now} />
            {attempts.length === 0 && job && job.state !== "CREATED" && (
              <InfoNote>
                The agent has not reported a print attempt for this job yet.
                {queuePosition !== null && ` It is number ${queuePosition} in the queue.`}
              </InfoNote>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/orders"
      className="inline-flex items-center gap-1.5 font-data text-[10.5px] uppercase tracking-[0.1em] text-ink-soft transition-colors hover:text-ink"
    >
      ← All orders
    </Link>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

/**
 * The timeline is assembled only from timestamps that exist. A missing one
 * means the step has not happened, and the row is simply absent — never shown
 * as pending-with-a-spinner, which would imply progress nobody has observed.
 */
function Timeline({ data, now }: { data: OrderDetailResponse; now: number }) {
  const { order, job, attempts } = data;

  const events: { at: string; label: string; detail?: string }[] = [
    { at: order.createdAt, label: "Customer uploaded the file" },
  ];

  if (order.paidAt) events.push({ at: order.paidAt, label: "Payment confirmed, token issued" });
  if (job?.claimedAt)
    events.push({ at: job.claimedAt, label: "Agent picked up the job" });

  for (const attempt of attempts) {
    events.push({
      at: attempt.attempted_at,
      label: `Attempt ${attempt.attempt_number}: ${attempt.result ?? "sent to printer"}`,
      detail: attempt.error_label
        ? `${attempt.error_label}${attempt.error_message ? ` — ${attempt.error_message}` : ""}`
        : (attempt.error_message ?? undefined),
    });
  }

  if (order.completedAt) events.push({ at: order.completedAt, label: "Printed successfully" });

  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <ol className="border border-line bg-paper">
      {events.map((event, i) => (
        <li key={`${event.at}-${i}`} className="flex gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[13px] text-ink">{event.label}</p>
            {event.detail && (
              <p className="mt-0.5 text-[12px] leading-relaxed text-magenta">{event.detail}</p>
            )}
            <p className="font-data text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
              {absoluteTime(event.at)} · {relativeTime(event.at, now)}
            </p>
          </div>
        </li>
      ))}
      {order.failureReason && (
        <li className="border-t border-line bg-magenta/[0.04] px-4 py-2.5">
          <p className="text-[12.5px] leading-relaxed text-magenta">{order.failureReason}</p>
        </li>
      )}
    </ol>
  );
}

function FileCard({
  orderId,
  file,
}: {
  orderId: string;
  file: OrderDetailResponse["file"];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shop/orders/${orderId}/file`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not open the file.");
        return;
      }
      // noopener: the signed URL must not hand the storage origin a reference
      // back to this page.
      window.open(body.url, "_blank", "noopener,noreferrer");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (!file) {
    return (
      <section className="border border-line bg-paper px-4 py-4">
        <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
          Document
        </p>
        <p className="mt-2 text-[13px] text-ink-soft">No file is attached to this order.</p>
      </section>
    );
  }

  return (
    <section className="border border-line bg-paper">
      <div className="border-b border-line px-4 py-2.5">
        <p className="font-data text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
          Document
        </p>
      </div>
      <div className="px-4 py-3.5">
        <p className="break-all text-[13.5px] font-medium text-ink">{file.filename}</p>
        <p className="mt-0.5 font-data text-[11px] uppercase tracking-[0.08em] text-ink-soft">
          {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB · {file.mimeType}
        </p>

        {file.deletedAt ? (
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-soft">
            This file was deleted on {absoluteTime(file.deletedAt)} under your retention
            setting. Ask the customer to upload it again if it still needs printing.
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={open}
              disabled={busy}
              className="mt-3 border border-ink bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-colors hover:bg-ink-soft disabled:opacity-50"
            >
              {busy ? "Opening…" : "Open the document"}
            </button>
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-soft">
              Opens a link that works for two minutes. The file itself stays private.
            </p>
          </>
        )}

        {error && (
          <p role="alert" className="mt-2 text-[12.5px] text-magenta">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

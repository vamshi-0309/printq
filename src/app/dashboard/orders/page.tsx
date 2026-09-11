"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDashboardResource } from "@/hooks/useDashboardResource";
import { ORDER_FILTERS } from "@/lib/orderStatus";
import type { OrderListResponse, OrderListItem } from "@/lib/dashboardTypes";
import {
  PageHeader,
  StatusPill,
  ErrorNote,
  formatRupees,
  relativeTime,
  absoluteTime,
} from "@/components/dashboard/primitives";

/**
 * Every order this shop has taken.
 *
 * The old version listed the raw print_status column, which meant a job could
 * read "queued" whether the agent was about to print it or had been dead for a
 * day. Rows now carry the derived state, which folds in the agent's own record
 * and its liveness — so "Waiting — agent offline" appears where it is true.
 *
 * Filters, search and paging are all server-side. The previous page pulled 100
 * rows and filtered them in the browser, so "no orders match that filter"
 * could mean "none in the last hundred", and one of its own filter values
 * ("pending") was unreachable because it was never rendered as a button.
 */

const FILTER_ORDER = [
  "all",
  "needs_attention",
  "awaiting_payment",
  "in_queue",
  "printing",
  "completed",
  "closed",
] as const;

export default function OrdersPage() {
  const [filter, setFilter] = useState<string>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  /**
   * Older pages the owner asked for, tagged with the query they belong to.
   *
   * Keeping the query alongside the rows means changing a filter needs no
   * effect to clear them — a page from the previous query simply stops
   * matching and is ignored. Resetting from an effect would be a render
   * cascade, and would briefly show the old rows under the new filter.
   */
  const [paged, setPaged] = useState<{
    url: string;
    items: OrderListItem[];
    exhausted: boolean;
    error: string | null;
  } | null>(null);

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const url = useMemo(() => {
    const params = new URLSearchParams({ filter });
    if (search) params.set("q", search);
    return `/api/shop/orders?${params.toString()}`;
  }, [filter, search]);

  const { data, error, loading, refreshing, updatedAt, refresh } =
    useDashboardResource<OrderListResponse>(url);

  // Anything paged in under a different query no longer applies.
  const current = paged?.url === url ? paged : null;
  const moreError = current?.error ?? null;

  const loadMore = useCallback(async () => {
    const previous = paged?.url === url ? paged.items : [];
    const cursor =
      previous.length > 0 ? previous[previous.length - 1].createdAt : data?.nextCursor;
    if (!cursor) return;

    setLoadingMore(true);
    try {
      const res = await fetch(`${url}&before=${encodeURIComponent(cursor)}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as OrderListResponse & { error?: string };
      if (!res.ok) {
        setPaged({
          url,
          items: previous,
          exhausted: false,
          error: body.error ?? "Could not load more orders.",
        });
        return;
      }
      setPaged({
        url,
        items: [...previous, ...body.orders],
        exhausted: !body.nextCursor,
        error: null,
      });
    } catch {
      setPaged({ url, items: previous, exhausted: false, error: "Couldn't reach the server." });
    } finally {
      setLoadingMore(false);
    }
  }, [url, data?.nextCursor, paged]);

  const orders = useMemo(() => {
    const older = paged?.url === url ? paged.items : [];
    return [...(data?.orders ?? []), ...older];
  }, [data?.orders, paged, url]);
  const now = data ? Date.parse(data.serverTime) : 0;
  const hasMore = Boolean(data?.nextCursor) && !(current?.exhausted ?? false);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        description="Everything customers have sent to this shop."
        updatedAt={updatedAt}
        refreshing={refreshing}
        onRefresh={refresh}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTER_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                filter === key
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper text-ink-soft hover:border-ink hover:text-ink"
              }`}
            >
              {ORDER_FILTERS[key].label}
            </button>
          ))}
        </div>

        <label className="relative sm:w-64">
          <span className="sr-only">Search by token or order number</span>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Token or order no."
            className="font-data w-full border border-line bg-paper px-3 py-1.5 text-[12.5px] text-ink placeholder:text-ink-soft/60 focus:border-cyan focus:outline-none"
          />
        </label>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <div className="divide-y divide-line border border-line bg-paper">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="border border-line bg-paper px-6 py-14 text-center">
          <p className="text-[14px] font-medium text-ink">
            {search ? "Nothing matched that search" : "No orders here"}
          </p>
          <p className="mt-1 text-[12.5px] text-ink-soft">
            {search
              ? "Check the token or order number and try again."
              : filter === "all"
                ? "Orders appear here as soon as a customer scans your QR code."
                : "Try a different filter."}
          </p>
        </div>
      ) : (
        <>
          {/* Table on wide screens, cards on a phone — same data either way. */}
          <div className="hidden overflow-x-auto border border-line bg-paper md:block">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line bg-paper-grey font-data text-[10.5px] uppercase tracking-[0.1em] text-ink-soft">
                  <th className="px-4 py-2.5 font-medium">Token</th>
                  <th className="px-4 py-2.5 font-medium">Order</th>
                  <th className="px-4 py-2.5 font-medium">Job</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((o) => (
                  <tr key={o.id} className="transition-colors hover:bg-paper-grey/60">
                    <td className="px-4 py-3 font-data text-[15px] font-semibold text-ink">
                      {o.tokenNumber ?? <span className="text-ink-soft/50">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/orders/${o.id}`}
                        className="font-data text-[12px] text-cyan underline-offset-2 hover:underline"
                      >
                        {o.publicOrderId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-ink-soft">
                      {o.pageCount ?? "?"}p × {o.copies} ·{" "}
                      {o.colorMode === "bw" ? "B&W" : "Colour"} · {o.paperSize} ·{" "}
                      {o.sides === "double" ? "2-sided" : "1-sided"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={o.state.tone}>{o.state.label}</StatusPill>
                    </td>
                    <td className="px-4 py-3 text-right font-data text-ink">
                      {formatRupees(o.amount)}
                    </td>
                    <td className="px-4 py-3 font-data text-[11px] text-ink-soft">
                      {relativeTime(o.createdAt, now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-line border border-line bg-paper md:hidden">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/dashboard/orders/${o.id}`} className="block px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-data text-[17px] font-semibold text-ink">
                      {o.tokenNumber ?? "—"}
                    </span>
                    <StatusPill tone={o.state.tone}>{o.state.label}</StatusPill>
                    <span className="ml-auto font-data text-[13px] text-ink">
                      {formatRupees(o.amount)}
                    </span>
                  </div>
                  <p className="mt-1.5 font-data text-[11px] text-ink-soft">
                    {o.publicOrderId} · {o.pageCount ?? "?"}p × {o.copies} ·{" "}
                    {o.colorMode === "bw" ? "B&W" : "Colour"} · {o.paperSize}
                  </p>
                  <p className="font-data text-[11px] text-ink-soft">
                    {absoluteTime(o.createdAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          {moreError && <ErrorNote>{moreError}</ErrorNote>}

          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full border border-line bg-paper py-2.5 font-data text-[11px] uppercase tracking-[0.1em] text-ink-soft transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load older orders"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

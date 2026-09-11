"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps a dashboard screen current without hammering the server.
 *
 * A print counter is a live surface — an order arrives, the agent picks it up,
 * the printer jams — so a page that only loads once is wrong within seconds.
 * Reloading on a short timer is the easy answer and the wrong one: it burns a
 * request every few seconds on a shop that may have had no activity all
 * morning, and it still shows stale data in between.
 *
 * So the refresh is driven by events, in this order of preference:
 *
 *   1. Supabase Realtime on `orders` for this shop. An insert or update is
 *      pushed, so a new order or a status change lands within a moment of
 *      actually happening. Debounced, because one payment writes several rows.
 *   2. The tab becoming visible again. The owner glancing back at the screen
 *      is the moment freshness matters, and nothing was worth fetching while
 *      the laptop lid was shut.
 *   3. A slow interval — and only while the tab is visible.
 *
 * The interval is not redundant with realtime. Agent liveness is derived from
 * how long ago the last heartbeat was, so it changes with the passage of time
 * alone and produces no database event to subscribe to. Without a periodic
 * re-read, an agent that died would keep showing as online until the owner
 * clicked something.
 */

interface Options<T> {
  /** Subscribe to this shop's order changes once the id is known. */
  realtimeShopId?: string | null;
  /**
   * Pulls the shop id out of the response itself, for screens that learn it
   * from the same request they want subscribed. Without this the caller has to
   * fetch once just to discover the id it needs to subscribe with.
   */
  realtimeShopIdFrom?: (data: T) => string | null | undefined;
  /** Safety net for time-derived state. Set to 0 to disable. */
  refreshIntervalMs?: number;
  /** Skip fetching entirely (e.g. a route param isn't ready). */
  enabled?: boolean;
}

export interface DashboardResource<T> {
  data: T | null;
  error: string | null;
  /** First load only — later refreshes keep the previous data on screen. */
  loading: boolean;
  refreshing: boolean;
  /** When the data on screen was fetched. */
  updatedAt: number | null;
  refresh: () => void;
}

const REALTIME_DEBOUNCE_MS = 400;
const DEFAULT_INTERVAL_MS = 60_000;

export function useDashboardResource<T>(
  url: string,
  {
    realtimeShopId = null,
    realtimeShopIdFrom,
    refreshIntervalMs = DEFAULT_INTERVAL_MS,
    enabled = true,
  }: Options<T> = {}
): DashboardResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // A ref, not state: a fetch starting must not itself trigger a render.
  const inFlight = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
    };
  }, []);

  /**
   * The fetch itself. Deliberately touches no state before its first await:
   * the mount effect calls this directly, and updating state synchronously
   * inside an effect is a cascading render. Showing the spinner is the
   * caller's job, in `refresh` below.
   */
  const fetchNow = useCallback(async () => {
    if (!enabled) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      const body = await res.json().catch(() => ({}));

      if (!mounted.current || controller.signal.aborted) return;

      if (!res.ok) {
        setError(
          typeof body?.error === "string" ? body.error : "Could not load this from the server."
        );
        return;
      }

      setData(body as T);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (err) {
      // An abort means a newer request replaced this one — not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!mounted.current) return;
      setError("Couldn't reach the server. Check your connection.");
    }
  }, [url, enabled]);

  /** A refresh the owner asked for, or a scheduled one: shows the spinner. */
  const refresh = useCallback(() => {
    setRefreshing(true);
    void fetchNow().finally(() => {
      if (mounted.current) setRefreshing(false);
    });
  }, [fetchNow]);

  // First load. The skeleton stands in for the spinner on this pass.
  //
  // Queued as a microtask rather than called in the effect body: the request
  // then starts once the effect has finished rather than during it, which is
  // what keeps a mount from turning into a cascading render.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void fetchNow();
    });
    return () => {
      cancelled = true;
    };
  }, [fetchNow]);

  // Realtime: an order changed, so whatever this screen shows may have too.
  const subscribedShopId =
    realtimeShopId ?? (data && realtimeShopIdFrom ? (realtimeShopIdFrom(data) ?? null) : null);

  useEffect(() => {
    if (!subscribedShopId || !enabled) return;

    const supabase = createClient();
    let timer: number | undefined;

    const channel = supabase
      .channel(`dashboard-${subscribedShopId}-${url}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `shop_id=eq.${subscribedShopId}` },
        () => {
          // One payment writes orders, payments, print_jobs and queue_entries
          // in quick succession; coalesce them into a single refetch.
          window.clearTimeout(timer);
          timer = window.setTimeout(() => void fetchNow(), REALTIME_DEBOUNCE_MS);
        }
      )
      .subscribe();

    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [subscribedShopId, url, fetchNow, enabled]);

  // Coming back to the tab, and a slow safety net while it is visible.
  useEffect(() => {
    if (!enabled) return;

    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchNow();
    };
    document.addEventListener("visibilitychange", onVisible);

    let interval: number | undefined;
    if (refreshIntervalMs > 0) {
      interval = window.setInterval(() => {
        if (document.visibilityState === "visible") void fetchNow();
      }, refreshIntervalMs);
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (interval) window.clearInterval(interval);
    };
  }, [fetchNow, refreshIntervalMs, enabled]);

  return {
    data,
    error,
    loading: data === null && error === null,
    refreshing,
    updatedAt,
    refresh,
  };
}

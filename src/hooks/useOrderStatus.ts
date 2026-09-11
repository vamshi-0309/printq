"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live order status for the customer's phone.
 *
 * Customers are never logged in, so this deliberately does NOT use the browser
 * Supabase client: RLS scopes `orders` to shop members, and an anonymous read
 * returns zero rows (verified — the status screen would simply never update).
 * Instead it polls /api/orders/status, which authenticates the request with
 * the customer_session_token minted when the order was created.
 *
 * Polling backs off once the order reaches a state that can no longer change,
 * and pauses entirely while the tab is hidden so a phone in someone's pocket
 * isn't making requests every few seconds.
 */

export type OrderStatus = {
  orderId: string;
  shopName: string | null;
  tokenNumber: string | null;
  paymentStatus: string;
  printStatus: string;
  amount: number;
  copies: number;
  colorMode: string;
  paperSize: string;
  sides: string;
  pageCount: number | null;
  queuePosition: number | null;
  createdAt: string;
  paidAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
};

/** States that will never change again — stop polling once we reach one. */
const TERMINAL = new Set(["completed", "cancelled"]);

const ACTIVE_INTERVAL_MS = 3000;
const IDLE_INTERVAL_MS = 10000;

export function useOrderStatus(
  orderUuid: string | null,
  customerSessionToken: string | null
) {
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);

  const fetchOnce = useCallback(async (): Promise<OrderStatus | null> => {
    if (!orderUuid || !customerSessionToken) return null;
    try {
      const res = await fetch("/api/orders/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: orderUuid, customerSessionToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not load your order.");
        return null;
      }
      setError(null);
      setStatus(data);
      return data as OrderStatus;
    } catch {
      // A dropped request is normal on mobile; keep the last known state and
      // let the next tick retry rather than blanking the screen.
      return null;
    }
  }, [orderUuid, customerSessionToken]);

  useEffect(() => {
    if (!orderUuid || !customerSessionToken) return;
    stoppedRef.current = false;

    const tick = async () => {
      if (stoppedRef.current) return;

      // Don't poll a backgrounded tab; re-check shortly instead.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timerRef.current = window.setTimeout(tick, ACTIVE_INTERVAL_MS);
        return;
      }

      const latest = await fetchOnce();
      if (stoppedRef.current) return;

      if (latest && TERMINAL.has(latest.printStatus)) {
        stoppedRef.current = true;
        return;
      }
      const waiting = latest?.paymentStatus === "paid";
      timerRef.current = window.setTimeout(
        tick,
        waiting ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS
      );
    };

    tick();

    // Refresh immediately when the customer comes back to the tab.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stoppedRef.current) fetchOnce();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stoppedRef.current = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [orderUuid, customerSessionToken, fetchOnce]);

  return { status, error, refresh: fetchOnce };
}

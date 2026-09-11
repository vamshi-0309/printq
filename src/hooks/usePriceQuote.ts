"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Live price for the current selection.
 *
 * The price shown must be the price charged, so it always comes from
 * /api/price — the same server-side calculation the order is created with,
 * using the shop's stored rates. Nothing is computed in the browser.
 *
 * Changing a control re-quotes after a short debounce, and any in-flight
 * request is aborted first: without that, two overlapping quotes can resolve
 * out of order and leave a stale total on screen next to the new options.
 *
 * `loading` is derived by comparing the settled result's key against the
 * current one rather than being written from an effect, which also means the
 * previous total stays on screen while the next one is fetched instead of
 * blinking to empty on every keystroke.
 */

export type PriceBreakdown = {
  perPageRate: number;
  effectivePages: number;
  subtotal: number;
  duplexDiscount: number;
  total: number;
  minimumApplied: boolean;
};

export type QuoteInput = {
  shopId: string;
  pageCount: number;
  copies: number;
  colorMode: string;
  paperSize: string;
  sides: string;
  pageRange: string;
};

type Settled = {
  key: string;
  breakdown: PriceBreakdown | null;
  error: string | null;
};

const DEBOUNCE_MS = 260;

export function usePriceQuote(input: QuoteInput | null): {
  breakdown: PriceBreakdown | null;
  loading: boolean;
  error: string | null;
} {
  const [settled, setSettled] = useState<Settled | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Serialised so the effect keys on values, not object identity.
  const key = input && input.pageCount >= 1 ? JSON.stringify(input) : null;

  useEffect(() => {
    if (!key) return;

    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: key,
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          setSettled({
            key,
            breakdown: null,
            error: data.error ?? "Could not calculate the price.",
          });
          return;
        }
        setSettled({ key, breakdown: data.breakdown, error: null });
      } catch (err) {
        // An abort means a newer quote replaced this one — not an error.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSettled({
          key,
          breakdown: null,
          error: "Couldn't reach the shop. Check your connection.",
        });
      }
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [key]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!key) return { breakdown: null, loading: false, error: null };

  const current = settled?.key === key ? settled : null;
  return {
    // Keep the last known total visible while the next quote is in flight.
    breakdown: current ? current.breakdown : (settled?.breakdown ?? null),
    loading: current === null,
    error: current?.error ?? null,
  };
}

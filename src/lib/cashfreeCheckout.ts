"use client";

/**
 * Loads Cashfree's checkout SDK and opens it.
 *
 * The SDK is fetched only when a shop actually uses Cashfree, so shops on the
 * UPI path never pay the download cost. `redirectTarget: "_self"` sends the
 * customer to Cashfree's hosted page and back to our return_url, which is more
 * reliable on mobile browsers than an embedded modal.
 */

const SDK_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";

type CashfreeInstance = {
  checkout: (opts: { paymentSessionId: string; redirectTarget?: string }) => Promise<unknown>;
};

declare global {
  interface Window {
    Cashfree?: (opts: { mode: "sandbox" | "production" }) => CashfreeInstance;
  }
}

let loader: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Not in a browser."));
  if (window.Cashfree) return Promise.resolve();
  // Reuse a single in-flight load; React can render this twice in dev.
  if (loader) return loader;

  loader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Could not load the payment page.")));
      return;
    }
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loader = null;
      reject(new Error("Could not load the payment page. Check your connection."));
    };
    document.head.appendChild(script);
  });

  return loader;
}

export async function openCashfreeCheckout(
  paymentSessionId: string,
  mode: "sandbox" | "production" = "sandbox"
): Promise<void> {
  await loadSdk();
  if (!window.Cashfree) throw new Error("The payment page failed to start.");
  const cashfree = window.Cashfree({ mode });
  await cashfree.checkout({ paymentSessionId, redirectTarget: "_self" });
}

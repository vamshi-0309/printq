/**
 * The shop owner's own switches: open/closed, accepting/paused, and whether
 * orders print automatically or wait for approval.
 *
 * These are separate from shops.status and the licence, which PrintQ
 * controls (see shopReadiness.ts). A shop can be fully licensed and still
 * closed for lunch.
 *
 *   closed  → the customer page shows "closed" and offers no upload at all
 *   paused  → customers may upload and preview, but cannot place an order
 *
 * The customer page hides what it can, but the order route re-checks both on
 * every request: a page left open from before the owner flipped the switch
 * must not be able to slip an order in.
 */

export type PrintingMode = "automatic" | "approval_required";

export interface ShopControls {
  shopOpen: boolean;
  acceptingOrders: boolean;
  printingMode: PrintingMode;
}

export const DEFAULT_CONTROLS: ShopControls = {
  shopOpen: true,
  acceptingOrders: true,
  printingMode: "automatic",
};

export const SHOP_CLOSED_MESSAGE = "This shop is currently closed. Please try again later.";
export const ORDERS_PAUSED_MESSAGE = "Not accepting new print orders right now";

export function controlsFrom(
  row: { shop_open?: boolean | null; accepting_orders?: boolean | null; printing_mode?: string | null } | null | undefined
): ShopControls {
  return {
    // A missing row or column means the defaults the migration set.
    shopOpen: row?.shop_open !== false,
    acceptingOrders: row?.accepting_orders !== false,
    printingMode: row?.printing_mode === "approval_required" ? "approval_required" : "automatic",
  };
}

export type OrderingBlock = { code: "shop_closed" | "orders_paused"; message: string };

/** Why a new order can't be placed right now, or null if it can. */
export function orderingBlock(c: ShopControls): OrderingBlock | null {
  if (!c.shopOpen) return { code: "shop_closed", message: SHOP_CLOSED_MESSAGE };
  if (!c.acceptingOrders) return { code: "orders_paused", message: ORDERS_PAUSED_MESSAGE };
  return null;
}

/** Uploads are allowed while paused (browse and preview), not while closed. */
export function uploadBlock(c: ShopControls): OrderingBlock | null {
  if (!c.shopOpen) return { code: "shop_closed", message: SHOP_CLOSED_MESSAGE };
  return null;
}

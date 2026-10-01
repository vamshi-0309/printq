import type { SupabaseClient } from "@supabase/supabase-js";
import { calculatePrice, PricingError, type PriceBreakdown, type ShopPricingConfig } from "./pricing";
import {
  parsePageRange,
  pagesToRangeString,
  resolvePageColors,
  type ColorRange,
} from "./pageRange";
import {
  ensureCheckoutSession,
  issueRefund,
  loadPayments,
  moneyHeld,
  openCharge,
  outstandingPayment,
  retirePendingCharges,
  rupees,
  type CheckoutUrls,
  type GatewayClient,
} from "./orderMoney";
import { settleBalance } from "./orderPayment";

/**
 * The shop owner changing an order's print settings, and what that does to
 * the money.
 *
 * WHICH ORDERS
 * Only ones nothing has printed yet: pending approval, awaiting payment, paid
 * and queued, claimed by the agent (settings only), or already waiting on a
 * top-up. A claimed job is first released back to QUEUED with a compare-and-
 * swap; the agent's in-flight "attempted" report then fails and it prints
 * nothing, picking the job up again later with the new settings. If the agent
 * has already reported the attempt, the swap fails and the edit is refused.
 *
 * THE PRICE
 * Recomputed with the same calculatePrice the customer's order used, from the
 * shop's stored rates and the document's real page count. Never a number the
 * browser sends.
 *
 * THE MONEY — compared with what the customer has actually paid (moneyHeld),
 * not with the order's previous price, so editing twice in a row is right too:
 *
 *   not paid yet       update the order; if a Cashfree checkout session
 *                      exists at the old amount it is retired and a new one
 *                      issued ("<uuid>-r<n>")
 *   paid, now higher   the job moves to AWAITING_TOPUP (unclaimable) with a
 *                      top-up charge for the difference ("<uuid>-t<n>");
 *                      paying it returns the job to the queue
 *   paid, now lower    refused until the owner confirms the exact refund;
 *                      then the order is updated and the difference refunded
 *                      (Cashfree, or recorded as paid back at the counter)
 *   same amount        update the order; a top-up no longer needed is retired
 *
 * Every edit is written to audit_logs with the before and after.
 */

export interface EditChanges {
  copies?: number;
  colorMode?: "bw" | "color";
  paperSize?: "A4" | "A3";
  sides?: "single" | "double";
  orientation?: "portrait" | "landscape" | "auto";
  /** "all" or a range like "1-5,8". */
  pageRange?: string;
  /** null clears per-range colour. */
  colorRanges?: ColorRange[] | null;
  fitMode?: "fit" | "actual";
}

export interface EditDeps {
  gateway: GatewayClient | null;
  urls: CheckoutUrls;
  /**
   * The document's real page count, read from storage. Only consulted when
   * the page selection changes on an order that doesn't already record it.
   */
  documentPages: (storagePath: string) => Promise<number | null>;
}

export type EditOutcome = "unchanged" | "updated" | "reissued" | "topup" | "refunded";

export type EditResult =
  | {
      ok: true;
      outcome: EditOutcome;
      previousAmount: number;
      amount: number;
      /** What the customer had paid before this edit. */
      held: number;
      topup?: { amount: number; paymentSessionId: string | null } | null;
      refund?: { amount: number; ok: boolean; error?: string } | null;
      warning?: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      code?: "needs_refund_confirmation" | "not_editable" | "conflict";
      /** With needs_refund_confirmation: exactly what would be refunded. */
      refundAmount?: number;
      amount?: number;
    };

/** Job states an owner may still edit. Everything later is at the printer. */
export const EDITABLE_JOB_STATES = new Set([
  "PENDING_APPROVAL",
  "CREATED",
  "PAYMENT_PENDING",
  "PAID",
  "QUEUED",
  "CLAIMED",
  "AWAITING_TOPUP",
]);

export function pricingConfigFrom(pricing: Record<string, unknown>): ShopPricingConfig {
  return {
    a4BwPerPage: Number(pricing.a4_bw_per_page),
    a4ColorPerPage: Number(pricing.a4_color_per_page),
    a3BwPerPage: Number(pricing.a3_bw_per_page),
    a3ColorPerPage: Number(pricing.a3_color_per_page),
    duplexDiscountPercent: Number(pricing.duplex_discount_percent),
    minimumOrderAmount: Number(pricing.minimum_order_amount),
    enabledPaperSizes: pricing.enabled_paper_sizes as ShopPricingConfig["enabledPaperSizes"],
  };
}

/** The settings that decide what is printed and what it costs. */
export interface PrintSpec {
  copies: number;
  colorMode: "bw" | "color";
  paperSize: "A4" | "A3";
  sides: "single" | "double";
  orientation: "portrait" | "landscape" | "auto";
  pageRange: string;
  colorRanges: ColorRange[] | null;
  fitMode: "fit" | "actual";
}

export type PricedSpec =
  | {
      ok: true;
      breakdown: PriceBreakdown & { documentPages: number };
      selectedPages: number[];
      storedRange: string;
      colorRanges: ColorRange[] | null;
    }
  | { ok: false; error: string };

/**
 * Price a spec against a document of `documentPages` pages. Shared by order
 * creation and editing so the two can never price the same choice twice.
 */
export function priceSpec(
  spec: PrintSpec,
  documentPages: number,
  config: ShopPricingConfig
): PricedSpec {
  const range = parsePageRange(
    spec.pageRange === "all" ? `1-${documentPages}` : spec.pageRange,
    documentPages
  );
  if (!range.ok) return { ok: false, error: range.error };

  const colors = resolvePageColors(range.pages, documentPages, spec.colorMode, spec.colorRanges);
  if (!colors.ok) return { ok: false, error: colors.error };

  let breakdown: PriceBreakdown;
  try {
    breakdown = calculatePrice(
      {
        pageCount: range.pages.length,
        copies: spec.copies,
        colorMode: spec.colorMode,
        paperSize: spec.paperSize,
        sides: spec.sides,
        ...(colors.normalized ? { colorPageCount: colors.colorPages.length } : {}),
      },
      config
    );
  } catch (err) {
    if (err instanceof PricingError) return { ok: false, error: err.message };
    throw err;
  }

  return {
    ok: true,
    breakdown: { ...breakdown, documentPages },
    selectedPages: range.pages,
    storedRange: range.pages.length === documentPages ? "all" : pagesToRangeString(range.pages),
    colorRanges: colors.normalized,
  };
}

/**
 * The page count an existing order's selection can be checked against
 * without downloading the file: recorded at creation since this change, and
 * otherwise the largest page the stored range names (enough to re-read the
 * same selection, not to select new pages).
 */
function knownDocumentPages(order: Record<string, unknown>): { pages: number; exact: boolean } {
  const breakdown = order.price_breakdown as { documentPages?: number } | null;
  if (breakdown?.documentPages && breakdown.documentPages > 0) {
    return { pages: breakdown.documentPages, exact: true };
  }
  const range = String(order.page_range ?? "all");
  const count = Number(order.page_count ?? 0);
  if (range === "all") return { pages: count, exact: false };
  const max = Math.max(...(range.match(/\d+/g) ?? ["0"]).map(Number));
  return { pages: Math.max(max, count), exact: false };
}

function specOf(order: Record<string, unknown>): PrintSpec {
  return {
    copies: Number(order.copies),
    colorMode: order.color_mode as PrintSpec["colorMode"],
    paperSize: order.paper_size as PrintSpec["paperSize"],
    sides: order.sides as PrintSpec["sides"],
    orientation: (order.orientation as PrintSpec["orientation"]) ?? "auto",
    pageRange: String(order.page_range ?? "all"),
    colorRanges: (order.color_ranges as ColorRange[] | null) ?? null,
    fitMode: (order.fit_mode as PrintSpec["fitMode"]) ?? "fit",
  };
}

export async function editOrder(
  db: SupabaseClient,
  deps: EditDeps,
  input: {
    orderId: string;
    shopId: string;
    actorId: string;
    changes: EditChanges;
    /** The owner has seen and accepted the refund amount. */
    confirmRefund?: boolean;
  }
): Promise<EditResult> {
  const { orderId, shopId } = input;

  const { data: order } = await db
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!order) return { ok: false, status: 404, error: "Order not found." };

  const [{ data: job }, { data: pricing }, { data: settings }, { data: file }] = await Promise.all([
    db.from("print_jobs").select("id, state").eq("order_id", orderId).maybeSingle(),
    db.from("pricing").select("*").eq("shop_id", shopId).maybeSingle(),
    db.from("shop_settings").select("payment_gateway").eq("shop_id", shopId).maybeSingle(),
    db
      .from("order_files")
      .select("storage_path, converted_storage_path, deleted_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const jobState: string | null = job?.state ?? null;
  if (!job || !EDITABLE_JOB_STATES.has(jobState ?? "")) {
    return {
      ok: false,
      status: 409,
      code: "not_editable",
      error:
        jobState === "PRINT_ATTEMPTED" || jobState === "PRINTING"
          ? "This order has already been sent to the printer and can't be changed."
          : "This order can no longer be changed.",
    };
  }
  if (!pricing) return { ok: false, status: 409, error: "Set your prices before editing orders." };

  const before = specOf(order);
  const after: PrintSpec = {
    ...before,
    ...Object.fromEntries(Object.entries(input.changes).filter(([, v]) => v !== undefined)),
  } as PrintSpec;

  // The page count to check the selection against.
  const selectionChanged =
    after.pageRange !== before.pageRange ||
    JSON.stringify(after.colorRanges) !== JSON.stringify(before.colorRanges);
  let { pages: documentPages, exact } = knownDocumentPages(order);
  if (selectionChanged && !exact) {
    if (!file || file.deleted_at) {
      return { ok: false, status: 409, error: "The file has been deleted, so the pages can't be changed." };
    }
    const counted = await deps.documentPages(file.converted_storage_path || file.storage_path);
    if (!counted) return { ok: false, status: 503, error: "Couldn't read the document. Try again." };
    documentPages = counted;
    exact = true;
  }

  const priced = priceSpec(after, documentPages, pricingConfigFrom(pricing));
  if (!priced.ok) return { ok: false, status: 422, error: priced.error };

  const previousAmount = rupees(Number(order.amount ?? 0));
  const amount = rupees(priced.breakdown.total);
  const shopGateway: string | null = settings?.payment_gateway ?? null;

  const rows = await loadPayments(db, orderId);
  const held = moneyHeld(rows);
  const paid = order.payment_status === "paid";

  const unchanged =
    JSON.stringify({ ...after, pageRange: priced.storedRange, colorRanges: priced.colorRanges }) ===
      JSON.stringify(before) && amount === previousAmount;
  if (unchanged) {
    return { ok: true, outcome: "unchanged", previousAmount, amount, held };
  }

  // Lowering a paid order's price means money goes back. Stop and say exactly
  // how much before doing anything.
  const refundAmount = paid ? rupees(held - amount) : 0;
  if (refundAmount > 0 && !input.confirmRefund) {
    return {
      ok: false,
      status: 409,
      code: "needs_refund_confirmation",
      error: `Refund ₹${refundAmount} to the customer for this change?`,
      refundAmount,
      amount,
    };
  }

  // Take the job back from the agent before changing what it would print.
  if (jobState === "CLAIMED") {
    const { data: released } = await db
      .from("print_jobs")
      .update({ state: "QUEUED", claimed_by_agent_id: null, claimed_at: null })
      .eq("id", job.id)
      .eq("state", "CLAIMED")
      .select("id");
    if (!released || released.length === 0) {
      return {
        ok: false,
        status: 409,
        code: "not_editable",
        error: "The printer has just started on this order, so it can't be changed now.",
      };
    }
    await db.from("orders").update({ print_status: "queued" }).eq("id", orderId).eq("print_status", "claimed");
  }

  // The order itself, guarded on the amount and payment status read above so
  // two edits (or an edit and a payment) racing each other can't both land.
  const { data: written } = await db
    .from("orders")
    .update({
      copies: after.copies,
      color_mode: after.colorMode,
      paper_size: after.paperSize,
      sides: after.sides,
      orientation: after.orientation,
      page_range: priced.storedRange,
      page_count: priced.selectedPages.length,
      color_ranges: priced.colorRanges,
      fit_mode: after.fitMode,
      price_breakdown: priced.breakdown,
      amount,
    })
    .eq("id", orderId)
    .eq("amount", order.amount)
    .eq("payment_status", order.payment_status)
    .select("id");
  if (!written || written.length === 0) {
    return {
      ok: false,
      status: 409,
      code: "conflict",
      error: "This order changed while you were editing it. Reload and try again.",
    };
  }

  let outcome: EditOutcome = "updated";
  let topup: { amount: number; paymentSessionId: string | null } | null = null;
  let refund: { amount: number; ok: boolean; error?: string } | null = null;
  let warning: string | undefined;

  if (!paid) {
    if (amount !== previousAmount) {
      const current = outstandingPayment(rows.filter((r) => (r.purpose ?? "order") === "order"));
      if (current && current.payment_session_id) {
        // A Cashfree session can't change amount: retire it, issue a new one.
        await retirePendingCharges(db, deps.gateway, rows, "order");
        const charge = await openCharge(db, deps.gateway, deps.urls, {
          orderId,
          amount,
          kind: "reissue",
          shopGateway,
          existing: rows,
        });
        outcome = "reissued";
        if (!charge.ok) warning = `The new payment link couldn't be created yet: ${charge.error}`;
      } else if (current) {
        // No session yet (counter payment, or approval not given): the row
        // just carries the new amount.
        await db
          .from("payments")
          .update({ amount })
          .eq("id", current.id)
          .eq("status", "pending");
        if (current.gateway === "cashfree" && jobState !== "PENDING_APPROVAL") {
          const session = await ensureCheckoutSession(db, deps.gateway, deps.urls, {
            ...current,
            amount,
          });
          if (!session.ok) warning = `The payment link couldn't be created yet: ${session.error}`;
        }
      }
    }
  } else {
    if (refundAmount > 0) {
      const result = await issueRefund(
        db,
        deps.gateway,
        rows,
        refundAmount,
        `Order ${order.public_order_id} changed by the shop`
      );
      refund = result.ok
        ? { amount: refundAmount, ok: true }
        : { amount: refundAmount, ok: false, error: result.error };
      outcome = "refunded";
      if (!result.ok) {
        // The order already shows the new price, so the shortfall stays
        // visible as a refund due on the order until it is retried.
        warning = `The order was updated, but the refund didn't go through: ${result.error} Use Refund on the order to try again.`;
      }
    }
    const settled = await settleBalance(db, deps.gateway, deps.urls, orderId, shopGateway);
    if (settled.due > 0) {
      outcome = "topup";
      topup = settled.topup
        ? { amount: settled.topup.amount, paymentSessionId: settled.topup.paymentSessionId }
        : null;
      if (settled.error) warning = `The extra payment link couldn't be created yet: ${settled.error}`;
    }
  }

  await db.from("audit_logs").insert({
    actor_type: "shop_owner",
    actor_id: input.actorId,
    shop_id: shopId,
    action: "order.edited",
    target_table: "orders",
    target_id: orderId,
    metadata: {
      before: { ...before, amount: previousAmount },
      after: {
        ...after,
        pageRange: priced.storedRange,
        colorRanges: priced.colorRanges,
        amount,
      },
      held,
      outcome,
      refund,
      topup: topup ? { amount: topup.amount } : null,
    },
  });

  return { ok: true, outcome, previousAmount, amount, held, topup, refund, warning };
}

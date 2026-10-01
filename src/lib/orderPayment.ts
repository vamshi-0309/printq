import type { SupabaseClient } from "@supabase/supabase-js";
import { formatToken } from "./token";
import {
  loadPayments,
  moneyHeld,
  openCharge,
  retirePendingCharges,
  rupees,
  type CheckoutUrls,
  type GatewayClient,
} from "./orderMoney";

/**
 * The single place an order becomes "paid".
 *
 * Both payment paths funnel through here — the shop owner tapping "confirm"
 * in the dashboard, and a verified Cashfree webhook — so token assignment and
 * queue placement exist in exactly one implementation rather than two that
 * can drift apart.
 *
 * IDEMPOTENCY
 * A gateway may deliver the same webhook more than once, and a webhook can
 * race the owner's manual confirmation. The first write is therefore a
 * compare-and-swap: the UPDATE only matches rows still in `pending`, and we
 * ask Postgres which rows it actually changed. Whoever wins the swap assigns
 * the token; everyone else observes `alreadyPaid` and touches nothing. That
 * ordering matters — assigning the token first would burn a counter value on
 * every duplicate delivery and leave gaps in the shop's token sequence.
 */

export type MarkPaidResult =
  | {
      ok: true;
      alreadyPaid: boolean;
      tokenNumber: string | null;
      tokenCounter: number | null;
      queuePosition: number | null;
    }
  | { ok: false; error: string; status: number; code?: "not_payable" };

/**
 * Order states that must never be queued by a payment. Money that arrives for
 * one of these is recorded against its payments row (so a refund can be
 * issued) but the order is left exactly as the owner put it.
 */
export const NOT_PAYABLE_PRINT_STATUSES = new Set(["pending_approval", "rejected", "cancelled"]);

export async function markOrderPaidAndQueue(
  supabase: SupabaseClient,
  orderId: string,
  opts: {
    gatewayPaymentId?: string;
    gateway?: string;
    /**
     * The payments row this money arrived on. When given, only that row is
     * marked paid; otherwise the order's pending main charge is (the counter
     * confirmation path, where there is only ever one).
     */
    paymentId?: string;
  } = {}
): Promise<MarkPaidResult> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, shop_id, payment_status, print_status, token_number, token_counter")
    .eq("id", orderId)
    .single();

  if (!order) return { ok: false, error: "Order not found.", status: 404 };

  if (order.payment_status !== "paid" && NOT_PAYABLE_PRINT_STATUSES.has(order.print_status)) {
    return {
      ok: false,
      status: 409,
      code: "not_payable",
      error:
        order.print_status === "pending_approval"
          ? "This order is waiting for the shop to approve it."
          : `This order was ${order.print_status} and can't be paid.`,
    };
  }

  // A customer who dropped out of checkout and then paid on a second try:
  // the drop marked the order failed, which made the swap below miss and left
  // a paid order unqueued for good. Its own CAS, so it cannot disturb an
  // order that is genuinely paid.
  if (order.payment_status === "failed") {
    await supabase
      .from("orders")
      .update({ payment_status: "pending", failure_reason: null })
      .eq("id", orderId)
      .eq("payment_status", "failed");
  }

  // Compare-and-swap. Only the caller that flips pending -> paid proceeds.
  // Scoped to the print status read above too, so an owner cancelling in the
  // same instant wins instead of being overwritten.
  const { data: claimed } = await supabase
    .from("orders")
    .update({ payment_status: "paid", paid_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("payment_status", "pending")
    .eq("print_status", order.print_status)
    .select("id");

  if (!claimed || claimed.length === 0) {
    // Someone else already completed this order. Report their outcome rather
    // than issuing a second token.
    const { data: existing } = await supabase
      .from("orders")
      .select("token_number, token_counter")
      .eq("id", orderId)
      .single();

    const { data: entry } = await supabase
      .from("queue_entries")
      .select("position")
      .eq("order_id", orderId)
      .maybeSingle();

    return {
      ok: true,
      alreadyPaid: true,
      tokenNumber: existing?.token_number ?? null,
      tokenCounter: existing?.token_counter ?? null,
      queuePosition: entry?.position ?? null,
    };
  }

  // Atomic per-shop counter (see get_next_token in db/schema.sql).
  const { data: tokenResult } = await supabase.rpc("get_next_token", {
    p_shop_id: order.shop_id,
  });

  const tokenCounter = tokenResult as number;
  const tokenNumber = formatToken(tokenCounter);

  await supabase
    .from("orders")
    .update({
      print_status: "queued",
      token_number: tokenNumber,
      token_counter: tokenCounter,
    })
    .eq("id", orderId);

  const paymentUpdate: Record<string, unknown> = {
    status: "paid",
    verified_at: new Date().toISOString(),
  };
  if (opts.gatewayPaymentId) paymentUpdate.gateway_payment_id = opts.gatewayPaymentId;
  if (opts.gateway) paymentUpdate.gateway = opts.gateway;

  if (opts.paymentId) {
    await supabase.from("payments").update(paymentUpdate).eq("id", opts.paymentId);
  } else {
    // Only the pending main charge: an expired re-issue or a top-up row for
    // this order must not be swept up as paid.
    await supabase
      .from("payments")
      .update(paymentUpdate)
      .eq("order_id", orderId)
      .eq("status", "pending")
      .eq("purpose", "order");
  }

  await supabase.from("print_jobs").update({ state: "QUEUED" }).eq("order_id", orderId);

  const { count } = await supabase
    .from("queue_entries")
    .select("*", { count: "exact", head: true })
    .eq("shop_id", order.shop_id);

  const position = (count ?? 0) + 1;
  await supabase.from("queue_entries").insert({
    shop_id: order.shop_id,
    order_id: orderId,
    position,
  });

  return { ok: true, alreadyPaid: false, tokenNumber, tokenCounter, queuePosition: position };
}

/** Records a failed or abandoned gateway payment. The job is never queued. */
export async function markOrderPaymentFailed(
  supabase: SupabaseClient,
  orderId: string,
  reason: string
): Promise<void> {
  // Never downgrade an order that already succeeded — a late FAILED webhook
  // for an earlier attempt must not undo a completed payment.
  await supabase
    .from("orders")
    .update({ payment_status: "failed", failure_reason: reason })
    .eq("id", orderId)
    .eq("payment_status", "pending");

  await supabase
    .from("payments")
    .update({ status: "failed" })
    .eq("order_id", orderId)
    .eq("status", "pending");
}

/* ── Balance after a price change or a top-up ────────────────────── */

export type SettleResult = {
  /** What the customer still owes, in rupees. Negative means overpaid. */
  due: number;
  held: number;
  jobState: string | null;
  /** The pending top-up the customer should pay, when one is due. */
  topup: { paymentId: string; paymentSessionId: string | null; amount: number } | null;
  error?: string;
};

/**
 * Make a paid order's job match its balance.
 *
 *   owes money   → AWAITING_TOPUP, with exactly one pending top-up charge for
 *                  exactly the difference; the agent cannot claim it
 *   fully paid   → back to QUEUED if it was waiting on a top-up; any leftover
 *                  top-up charge is retired
 *   overpaid     → nothing automatic. The owner is offered a refund; money is
 *                  never sent back without them confirming the amount.
 *
 * Idempotent: running it twice changes nothing the second time, which is what
 * lets the webhook call it on every delivery, duplicates included.
 */
export async function settleBalance(
  db: SupabaseClient,
  gateway: GatewayClient | null,
  urls: CheckoutUrls,
  orderId: string,
  shopGateway: string | null
): Promise<SettleResult> {
  const { data: order } = await db
    .from("orders")
    .select("id, amount, payment_status, print_status")
    .eq("id", orderId)
    .single();
  const { data: job } = await db
    .from("print_jobs")
    .select("id, state")
    .eq("order_id", orderId)
    .maybeSingle();

  const rows = await loadPayments(db, orderId);
  const held = moneyHeld(rows);
  const amount = rupees(Number(order?.amount ?? 0));
  const due = rupees(amount - held);
  const jobState: string | null = job?.state ?? null;

  if (!order || order.payment_status !== "paid" || !job) {
    return { due, held, jobState, topup: null };
  }

  if (due > 0) {
    let state = jobState;
    if (state === "QUEUED" || state === "CLAIMED" || state === "PAID") {
      const { data: moved } = await db
        .from("print_jobs")
        .update({ state: "AWAITING_TOPUP" })
        .eq("id", job.id)
        .eq("state", state)
        .select("id");
      if (moved && moved.length > 0) {
        state = "AWAITING_TOPUP";
        await db.from("orders").update({ print_status: "awaiting_topup" }).eq("id", orderId);
      }
    }
    if (state !== "AWAITING_TOPUP") {
      // Already at the printer, or finished: a balance can't stop it now.
      return { due, held, jobState: state, topup: null };
    }

    const pendingTopups = rows.filter((r) => r.status === "pending" && r.purpose === "topup");
    const exact = pendingTopups.find((r) => rupees(Number(r.amount)) === due);
    if (exact && pendingTopups.length === 1) {
      return {
        due,
        held,
        jobState: state,
        topup: { paymentId: exact.id, paymentSessionId: exact.payment_session_id, amount: due },
      };
    }
    await retirePendingCharges(db, gateway, rows, "topup");
    const charge = await openCharge(db, gateway, urls, {
      orderId,
      amount: due,
      kind: "topup",
      shopGateway,
      existing: rows,
    });
    return {
      due,
      held,
      jobState: state,
      topup: charge.paymentId
        ? {
            paymentId: charge.paymentId,
            paymentSessionId: charge.ok ? charge.paymentSessionId : null,
            amount: due,
          }
        : null,
      error: charge.ok ? undefined : charge.error,
    };
  }

  // Paid in full (or over). No top-up is owed any more.
  await retirePendingCharges(db, gateway, rows, "topup");
  if (jobState === "AWAITING_TOPUP") {
    const { data: moved } = await db
      .from("print_jobs")
      .update({ state: "QUEUED" })
      .eq("id", job.id)
      .eq("state", "AWAITING_TOPUP")
      .select("id");
    if (moved && moved.length > 0) {
      await db.from("orders").update({ print_status: "queued" }).eq("id", orderId);
      return { due, held, jobState: "QUEUED", topup: null };
    }
  }
  return { due, held, jobState, topup: null };
}

/* ── A verified gateway payment ──────────────────────────────────── */

export type GatewayPaymentResult =
  | {
      ok: true;
      duplicate: boolean;
      orderId: string;
      purpose: string;
      tokenNumber: string | null;
      /** Set when the customer has paid more than the order now costs. */
      refundDue?: number;
    }
  | { ok: false; error: string };

/**
 * Apply a verified Cashfree success to the payments row it was taken on.
 *
 * The row is found by payments.cashfree_order_id — the exact id we gave
 * Cashfree — so original payments, re-issued sessions and top-ups are told
 * apart. An order created before that column existed falls back to the old
 * mapping (Cashfree order id = order UUID), through the unchanged
 * markOrderPaidAndQueue path.
 *
 * Every step is idempotent and the order is re-checked on every delivery,
 * duplicates included: a crash between marking the row and queueing the
 * order is repaired by Cashfree's retry instead of stranding a paid order.
 */
export async function applyGatewayPayment(
  db: SupabaseClient,
  gateway: GatewayClient | null,
  urls: CheckoutUrls,
  cashfreeOrderId: string,
  opts: { gatewayPaymentId?: string } = {}
): Promise<GatewayPaymentResult> {
  const { data: found } = await db
    .from("payments")
    .select("id, order_id, purpose, status")
    .eq("cashfree_order_id", cashfreeOrderId)
    .maybeSingle();

  if (!found) {
    const legacy = await markOrderPaidAndQueue(db, cashfreeOrderId, {
      gatewayPaymentId: opts.gatewayPaymentId,
      gateway: "cashfree",
    });
    if (!legacy.ok) return { ok: false, error: legacy.error };
    return {
      ok: true,
      duplicate: legacy.alreadyPaid,
      orderId: cashfreeOrderId,
      purpose: "order",
      tokenNumber: legacy.tokenNumber,
    };
  }

  // Record the money on its own row. Any status but paid may become paid: an
  // expired re-issue the customer paid anyway is still money taken.
  const { data: swapped } = await db
    .from("payments")
    .update({
      status: "paid",
      gateway_payment_id: opts.gatewayPaymentId ?? null,
      verified_at: new Date().toISOString(),
    })
    .eq("id", found.id)
    .neq("status", "paid")
    .select("id");
  const duplicate = !swapped || swapped.length === 0;

  const { data: order } = await db
    .from("orders")
    .select("id, shop_id, payment_status, print_status, token_number")
    .eq("id", found.order_id)
    .single();
  if (!order) return { ok: false, error: "Order not found." };

  const { data: settings } = await db
    .from("shop_settings")
    .select("payment_gateway")
    .eq("shop_id", order.shop_id)
    .maybeSingle();
  const shopGateway: string | null = settings?.payment_gateway ?? null;

  let tokenNumber: string | null = order.token_number ?? null;

  if (order.payment_status !== "paid") {
    if (NOT_PAYABLE_PRINT_STATUSES.has(order.print_status)) {
      // Paid for an order the shop has already stopped. Never queued; the
      // owner is offered a refund for what was taken.
      const rows = await loadPayments(db, order.id);
      return {
        ok: true,
        duplicate,
        orderId: order.id,
        purpose: found.purpose ?? "order",
        tokenNumber: null,
        refundDue: moneyHeld(rows),
      };
    }
    const result = await markOrderPaidAndQueue(db, order.id, {
      gatewayPaymentId: opts.gatewayPaymentId,
      gateway: "cashfree",
      paymentId: found.id,
    });
    if (!result.ok) return { ok: false, error: result.error };
    tokenNumber = result.tokenNumber;
    if (!result.alreadyPaid) {
      // Paid on one main charge: any other pending one is now pointless.
      const rows = await loadPayments(db, order.id);
      await retirePendingCharges(db, gateway, rows, "order");
    }
  }

  // The price may have changed after this session was created; if so the
  // order now waits for the difference instead of printing short-paid.
  const settle = await settleBalance(db, gateway, urls, order.id, shopGateway);

  return {
    ok: true,
    duplicate,
    orderId: order.id,
    purpose: found.purpose ?? "order",
    tokenNumber,
    refundDue: settle.due < 0 ? -settle.due : undefined,
  };
}

/** A failed or abandoned checkout on one specific Cashfree order. */
export async function applyGatewayFailure(
  db: SupabaseClient,
  cashfreeOrderId: string,
  reason: string
): Promise<void> {
  const { data: found } = await db
    .from("payments")
    .select("id, order_id, purpose, status")
    .eq("cashfree_order_id", cashfreeOrderId)
    .maybeSingle();

  if (!found) {
    await markOrderPaymentFailed(db, cashfreeOrderId, reason);
    return;
  }

  if ((found.purpose ?? "order") === "order" && found.status === "pending") {
    // The live main charge: same behaviour as before, scoped to this row.
    await db
      .from("orders")
      .update({ payment_status: "failed", failure_reason: reason })
      .eq("id", found.order_id)
      .eq("payment_status", "pending");
  }
  // A failed top-up leaves the order waiting for it; the customer can try
  // again from their status page. Either way, only this row is marked.
  await db.from("payments").update({ status: "failed" }).eq("id", found.id).eq("status", "pending");
}

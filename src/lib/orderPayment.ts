import type { SupabaseClient } from "@supabase/supabase-js";
import { formatToken } from "./token";

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
  | { ok: false; error: string; status: number };

export async function markOrderPaidAndQueue(
  supabase: SupabaseClient,
  orderId: string,
  opts: { gatewayPaymentId?: string; gateway?: string } = {}
): Promise<MarkPaidResult> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, shop_id, payment_status, token_number, token_counter")
    .eq("id", orderId)
    .single();

  if (!order) return { ok: false, error: "Order not found.", status: 404 };

  // Compare-and-swap. Only the caller that flips pending -> paid proceeds.
  const { data: claimed } = await supabase
    .from("orders")
    .update({ payment_status: "paid", paid_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("payment_status", "pending")
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

  await supabase.from("payments").update(paymentUpdate).eq("order_id", orderId);

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

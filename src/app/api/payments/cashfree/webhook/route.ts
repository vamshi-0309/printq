import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { applyGatewayFailure, applyGatewayPayment } from "@/lib/orderPayment";
import { cashfreeGateway } from "@/lib/orderMoney";
import {
  verifyCashfreeWebhook,
  parseCashfreeEvent,
  isSuccessEvent,
  isFailureEvent,
  isRefundEvent,
} from "@/lib/cashfreeWebhook";

/**
 * Cashfree payment webhook.
 *
 * This is the only trustworthy evidence that a customer actually paid — the
 * browser returning from checkout proves nothing, since anyone can navigate to
 * the return URL. So the order is queued from here, not from the redirect.
 *
 * The raw body is read with req.text() and verified BEFORE any parsing:
 * Cashfree signs the exact bytes, and JSON.parse + re-stringify would reorder
 * keys and invalidate the signature.
 *
 * Response policy: once an event is verified we return 200 even if it turns
 * out to be a duplicate or refers to an unknown order, so Cashfree stops
 * retrying something that will never succeed. Non-200 is reserved for failed
 * verification (400) and genuine transient faults (500), which are the only
 * cases where a retry could help.
 *
 * WHICH PAYMENT
 * `data.order.order_id` is the Cashfree order id we created, which is no
 * longer always the order UUID: a top-up is "<uuid>-t1", a re-issued session
 * "<uuid>-r2". It is resolved through payments.cashfree_order_id, falling
 * back to the order UUID for orders created before that column existed. See
 * applyGatewayPayment.
 */

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature");
  const timestamp = req.headers.get("x-webhook-timestamp");

  const verification = verifyCashfreeWebhook(
    rawBody,
    signature,
    timestamp,
    process.env.CASHFREE_SECRET_KEY
  );

  if (!verification.valid) {
    // Never echo the body or headers here — an unverified payload is attacker
    // controlled.
    console.warn(
      `[cashfree-webhook] rejected: ${verification.reason} (${rawBody.length} bytes)`
    );
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn("[cashfree-webhook] verified signature but unparseable body");
    return NextResponse.json({ error: "Malformed payload." }, { status: 400 });
  }

  const event = parseCashfreeEvent(payload);
  if (!event) {
    console.warn("[cashfree-webhook] verified but unrecognised event shape");
    return NextResponse.json({ received: true, handled: false }, { status: 200 });
  }

  const orderId = event.orderId;
  console.info(
    `[cashfree-webhook] verified=true type=${event.type} order=${orderId ?? "none"} status=${event.paymentStatus ?? "none"}`
  );

  if (!orderId) {
    return NextResponse.json({ received: true, handled: false }, { status: 200 });
  }

  const supabase = createServiceRoleClient();
  const gateway = cashfreeGateway();

  try {
    if (isSuccessEvent(event)) {
      const result = await applyGatewayPayment(supabase, gateway, null, orderId, {
        gatewayPaymentId: event.cfPaymentId ?? undefined,
      });

      if (!result.ok) {
        // An unknown order will never become known; ack so retries stop.
        console.warn(`[cashfree-webhook] order=${orderId} not actionable: ${result.error}`);
        return NextResponse.json({ received: true, handled: false }, { status: 200 });
      }

      // Store the raw payload for audit only after the signature passed,
      // against the one payments row this event is about.
      await supabase
        .from("payments")
        .update({ raw_webhook_payload: payload })
        .eq("cashfree_order_id", orderId);

      if (result.refundDue) {
        console.warn(
          `[cashfree-webhook] order=${result.orderId} holds ${result.refundDue} more than it costs; owner is offered a refund`
        );
      }
      console.info(
        `[cashfree-webhook] cashfree_order=${orderId} purpose=${result.purpose} paid duplicate=${result.duplicate} token=${result.tokenNumber ?? "none"}`
      );
      return NextResponse.json(
        { received: true, handled: true, duplicate: result.duplicate },
        { status: 200 }
      );
    }

    if (isFailureEvent(event)) {
      await applyGatewayFailure(supabase, orderId, `Payment ${event.paymentStatus ?? event.type}`);
      await supabase
        .from("payments")
        .update({ raw_webhook_payload: payload })
        .eq("cashfree_order_id", orderId);

      console.info(`[cashfree-webhook] cashfree_order=${orderId} marked failed`);
      return NextResponse.json({ received: true, handled: true }, { status: 200 });
    }

    if (isRefundEvent(event) && event.refund?.refundId) {
      // Only the outcome of a refund we started; matched on our refund id.
      const status = event.refund.status;
      const next =
        status === "SUCCESS" ? "succeeded" : status === "CANCELLED" || status === "FAILED" ? "failed" : "pending";
      await supabase
        .from("payments")
        .update({
          refund_status: next,
          refunded_at: next === "succeeded" ? new Date().toISOString() : null,
        })
        .eq("cashfree_order_id", orderId)
        .eq("refund_id", event.refund.refundId);
      console.info(`[cashfree-webhook] refund ${event.refund.refundId} on ${orderId}: ${next}`);
      return NextResponse.json({ received: true, handled: true }, { status: 200 });
    }

    // Verified, but an event type we don't act on (refunds, settlements...).
    return NextResponse.json({ received: true, handled: false }, { status: 200 });
  } catch (err) {
    // Transient fault — let Cashfree retry.
    console.error(
      `[cashfree-webhook] order=${orderId} processing error: ${err instanceof Error ? err.message : "unknown"}`
    );
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
}

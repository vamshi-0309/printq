import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { settleBalance, NOT_PAYABLE_PRINT_STATUSES } from "@/lib/orderPayment";
import {
  cashfreeGateway,
  checkoutUrls,
  ensureCheckoutSession,
  loadPayments,
  moneyHeld,
  outstandingPayment,
  rupees,
} from "@/lib/orderMoney";

const paySchema = z.object({
  orderId: z.string().uuid(),
  customerSessionToken: z.string().uuid(),
});

export const dynamic = "force-dynamic";

/**
 * "Pay now" on the customer's status page.
 *
 * Returns the Cashfree checkout session for whatever this order is owed right
 * now — the original payment, a re-issued one after the shop changed the
 * price, or a top-up — creating the session if it doesn't exist yet. That
 * covers an approved approval-mode order, an order placed while Cashfree was
 * briefly unreachable, and a failed top-up the customer wants to retry.
 *
 * It never creates a second session for a payment that already has one,
 * so tapping Pay twice is harmless.
 */
export async function POST(req: NextRequest) {
  const parsed = paySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const db = createServiceRoleClient();
  const { data: order } = await db
    .from("orders")
    .select("id, shop_id, amount, payment_status, print_status")
    .eq("id", parsed.data.orderId)
    .eq("customer_session_token", parsed.data.customerSessionToken)
    .single();

  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  if (order.payment_status !== "paid" && NOT_PAYABLE_PRINT_STATUSES.has(order.print_status)) {
    return NextResponse.json(
      {
        error:
          order.print_status === "pending_approval"
            ? "The shop hasn't approved this order yet."
            : "This order can't be paid.",
      },
      { status: 409 }
    );
  }

  const [{ data: settings }, { data: shop }] = await Promise.all([
    db.from("shop_settings").select("payment_gateway").eq("shop_id", order.shop_id).maybeSingle(),
    db.from("shops").select("slug").eq("id", order.shop_id).maybeSingle(),
  ]);
  const gateway = cashfreeGateway();
  const urls = checkoutUrls(shop?.slug ?? "");
  const shopGateway: string | null = settings?.payment_gateway ?? null;

  // A paid order that owes a top-up: make sure exactly one is open.
  if (order.payment_status === "paid") {
    await settleBalance(db, gateway, urls, order.id, shopGateway);
  }

  const payments = await loadPayments(db, order.id);
  const owed = rupees(Number(order.amount ?? 0) - moneyHeld(payments));
  const current = outstandingPayment(payments);
  if (!current || owed <= 0) {
    return NextResponse.json({ error: "Nothing is owed on this order." }, { status: 409 });
  }
  if (current.gateway !== "cashfree") {
    return NextResponse.json({ error: "Pay the shop directly for this order." }, { status: 409 });
  }

  const session = await ensureCheckoutSession(db, gateway, urls, current);
  if (!session.ok || !session.paymentSessionId) {
    return NextResponse.json(
      { error: session.ok ? "Could not start the payment." : session.error },
      { status: 502 }
    );
  }

  return NextResponse.json({
    paymentSessionId: session.paymentSessionId,
    amount: session.amount,
    kind: current.purpose === "topup" ? "topup" : "order",
  });
}

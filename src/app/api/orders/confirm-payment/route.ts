import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import { markOrderPaidAndQueue } from "@/lib/orderPayment";

const confirmSchema = z.object({
  orderId: z.string().uuid(),
});

/**
 * Manual payment confirmation by the shop owner.
 * Assigns a token and moves the order into the print queue.
 * Requires the caller to be authenticated as a member of the shop.
 */
export async function POST(req: NextRequest) {
  const parsed = confirmSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Verify the caller is a shop member (uses cookie-bound client with RLS)
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Use service role for the actual mutations (bypasses RLS for cross-table ops)
  const supabase = createServiceRoleClient();

  // Load the order
  const { data: order } = await supabase
    .from("orders")
    .select("id, shop_id, payment_status, print_status, amount")
    .eq("id", parsed.data.orderId)
    .single();

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Verify the user belongs to this shop
  const { data: membership } = await supabase
    .from("shop_members")
    .select("id")
    .eq("shop_id", order.shop_id)
    .eq("user_id", user.id)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Not authorized for this shop." }, { status: 403 });
  }

  // Token assignment and queue placement live in one shared, idempotent
  // helper so this path and the Cashfree webhook can never diverge.
  const result = await markOrderPaidAndQueue(supabase, order.id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (result.alreadyPaid) {
    return NextResponse.json({ error: "Payment already confirmed." }, { status: 409 });
  }

  return NextResponse.json({
    tokenNumber: result.tokenNumber,
    tokenCounter: result.tokenCounter,
    queuePosition: result.queuePosition,
  });
}

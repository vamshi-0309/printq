import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";

const statusSchema = z.object({
  orderId: z.string().uuid(),
  customerSessionToken: z.string().uuid(),
});

/**
 * Customer-facing order status. Authenticated by the customer_session_token
 * generated when the order was created — no login required.
 */
export async function POST(req: NextRequest) {
  const parsed = statusSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: order } = await supabase
    .from("orders")
    .select(`
      id,
      public_order_id,
      shop_id,
      token_number,
      token_counter,
      payment_status,
      print_status,
      amount,
      copies,
      color_mode,
      paper_size,
      sides,
      page_count,
      created_at,
      paid_at,
      completed_at,
      failure_reason
    `)
    .eq("id", parsed.data.orderId)
    .eq("customer_session_token", parsed.data.customerSessionToken)
    .single();

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Get queue position if the order is in an active state
  let queuePosition: number | null = null;
  if (["queued", "claimed", "printing", "print_attempted"].includes(order.print_status)) {
    const { data: entry } = await supabase
      .from("queue_entries")
      .select("position")
      .eq("order_id", order.id)
      .single();

    queuePosition = entry?.position ?? null;
  }

  // Get shop name for display
  const { data: shop } = await supabase
    .from("shops")
    .select("shop_name")
    .eq("id", order.shop_id)
    .single();

  return NextResponse.json({
    orderId: order.public_order_id,
    shopName: shop?.shop_name,
    tokenNumber: order.token_number,
    paymentStatus: order.payment_status,
    printStatus: order.print_status,
    amount: order.amount,
    copies: order.copies,
    colorMode: order.color_mode,
    paperSize: order.paper_size,
    sides: order.sides,
    pageCount: order.page_count,
    queuePosition,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    completedAt: order.completed_at,
    failureReason: order.failure_reason,
  });
}

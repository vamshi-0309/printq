import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  buildCustomerStatus,
  isStatusExpired,
  queueSnapshot,
  upiLinkFor,
  type StatusOrderRow,
} from "@/lib/customerStatus";
import { loadPayments, moneyHeld, rupees } from "@/lib/orderMoney";

const statusSchema = z.object({
  orderId: z.string().uuid(),
  customerSessionToken: z.string().uuid(),
});

export const dynamic = "force-dynamic";

/**
 * Customer-facing order status. Authenticated by the customer_session_token
 * generated when the order was created — no login required.
 *
 * What may be returned is fixed in src/lib/customerStatus.ts; this route only
 * gathers the inputs. Nothing about any other customer is read except the
 * token of the job at the printer.
 */
export async function POST(req: NextRequest) {
  const parsed = statusSchema.safeParse(await req.json().catch(() => null));
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
      payment_status,
      print_status,
      amount,
      copies,
      color_mode,
      paper_size,
      sides,
      orientation,
      page_count,
      page_range,
      color_ranges,
      fit_mode,
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

  const [{ data: shop }, { data: settings }, { data: file }, payments, queue] = await Promise.all([
    supabase.from("shops").select("shop_name").eq("id", order.shop_id).single(),
    supabase.from("shop_settings").select("upi_id, payment_gateway").eq("shop_id", order.shop_id).maybeSingle(),
    supabase
      .from("order_files")
      .select("deleted_at")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    loadPayments(supabase, order.id),
    queueSnapshot(supabase, order.shop_id, order.id),
  ]);

  // Past retention, or finished more than a day ago: the link has done its
  // job. Say so plainly rather than showing a stale screen.
  if (isStatusExpired(order, Boolean(file?.deleted_at), new Date())) {
    return NextResponse.json(
      {
        expired: true,
        orderId: order.public_order_id,
        error: "This order link has expired. If you still need help, ask at the counter.",
      },
      { status: 410 }
    );
  }

  const owed = rupees(Number(order.amount ?? 0) - moneyHeld(payments));
  const shopName = shop?.shop_name ?? "";

  return NextResponse.json(
    buildCustomerStatus({
      order: order as StatusOrderRow,
      shopName: shop?.shop_name ?? null,
      queue,
      payments,
      shopGateway: settings?.payment_gateway ?? null,
      upiLink: owed > 0 ? upiLinkFor(settings?.upi_id, shopName, owed, order.public_order_id) : null,
    })
  );
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { calculatePrice, type ShopPricingConfig, PricingError } from "@/lib/pricing";
import { parsePageRange } from "@/lib/pageRange";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createCashfreeOrder, getCashfreeConfig, CashfreeError } from "@/lib/cashfree";

const orderSchema = z.object({
  shopId: z.string().uuid(),
  fileStoragePath: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().min(1),
  pageCount: z.number().int().min(1),
  copies: z.number().int().min(1).max(500),
  colorMode: z.enum(["bw", "color"]),
  paperSize: z.enum(["A4", "A3"]),
  orientation: z.enum(["portrait", "landscape", "auto"]),
  sides: z.enum(["single", "double"]),
  pageRange: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const parsed = orderSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid order data." }, { status: 400 });
  }
  const data = parsed.data;

  const supabase = createServiceRoleClient();

  // 1. Verify shop is active
  const { data: shop } = await supabase
    .from("shops")
    .select("id, shop_name, status, slug")
    .eq("id", data.shopId)
    .single();

  if (!shop || shop.status !== "active") {
    return NextResponse.json({ error: "Shop not found or inactive." }, { status: 404 });
  }

  // 2. Load pricing config
  const { data: pricing } = await supabase
    .from("pricing")
    .select("*")
    .eq("shop_id", data.shopId)
    .single();

  if (!pricing) {
    return NextResponse.json({ error: "Shop pricing not configured." }, { status: 404 });
  }

  const config: ShopPricingConfig = {
    a4BwPerPage: Number(pricing.a4_bw_per_page),
    a4ColorPerPage: Number(pricing.a4_color_per_page),
    a3BwPerPage: Number(pricing.a3_bw_per_page),
    a3ColorPerPage: Number(pricing.a3_color_per_page),
    duplexDiscountPercent: Number(pricing.duplex_discount_percent),
    minimumOrderAmount: Number(pricing.minimum_order_amount),
    enabledPaperSizes: pricing.enabled_paper_sizes,
  };

  // 3. Validate page range
  const rangeResult = parsePageRange(
    data.pageRange === "all" ? `1-${data.pageCount}` : data.pageRange,
    data.pageCount
  );
  if (!rangeResult.ok) {
    return NextResponse.json({ error: rangeResult.error }, { status: 400 });
  }

  // 4. Server-authoritative price calculation
  let breakdown;
  try {
    breakdown = calculatePrice(
      {
        pageCount: rangeResult.pages.length,
        copies: data.copies,
        colorMode: data.colorMode,
        paperSize: data.paperSize,
        sides: data.sides,
      },
      config
    );
  } catch (err) {
    if (err instanceof PricingError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json({ error: "Price calculation failed." }, { status: 500 });
  }

  // 5. Create order row
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      shop_id: data.shopId,
      color_mode: data.colorMode,
      paper_size: data.paperSize,
      orientation: data.orientation,
      sides: data.sides,
      copies: data.copies,
      page_range: data.pageRange,
      page_count: rangeResult.pages.length,
      price_breakdown: breakdown,
      amount: breakdown.total,
      payment_status: "pending",
      print_status: "payment_pending",
    })
    .select("id, public_order_id, customer_session_token")
    .single();

  if (orderError || !order) {
    return NextResponse.json(
      { error: "Failed to create order." },
      { status: 500 }
    );
  }

  // 6. Create order_files row
  await supabase.from("order_files").insert({
    order_id: order.id,
    original_filename: data.originalFilename,
    storage_path: data.fileStoragePath,
    mime_type: data.mimeType,
    size_bytes: data.sizeBytes,
  });

  // 7. Create payment row
  await supabase.from("payments").insert({
    order_id: order.id,
    method: "upi_intent",
    amount: breakdown.total,
    status: "pending",
  });

  // 8. Create print_jobs row (state=CREATED, won't be claimed until paid)
  await supabase.from("print_jobs").insert({
    order_id: order.id,
    state: "CREATED",
  });

  // 9. Payment: the shop chooses its own rail in dashboard settings.
  const { data: settings } = await supabase
    .from("shop_settings")
    .select("upi_id, payment_gateway")
    .eq("shop_id", data.shopId)
    .single();

  const gateway = settings?.payment_gateway ?? null;

  if (gateway === "cashfree") {
    const config = getCashfreeConfig();
    if (!config) {
      return NextResponse.json(
        { error: "This shop's online payments aren't configured yet." },
        { status: 503 }
      );
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
    try {
      const cf = await createCashfreeOrder(
        {
          // Our order UUID doubles as Cashfree's order_id so the webhook,
          // which echoes only `data.order.order_id`, can find this row again.
          orderUuid: order.id,
          amount: breakdown.total,
          customerPhone: process.env.CASHFREE_PLACEHOLDER_PHONE?.trim() || "9999999999",
          returnUrl: `${appUrl}/p/${shop.slug}?cf_return=1`,
          notifyUrl: `${appUrl}/api/payments/cashfree/webhook`,
        },
        config
      );

      await supabase
        .from("payments")
        .update({
          method: "gateway",
          gateway: "cashfree",
          gateway_order_id: cf.cfOrderId || null,
          payment_session_id: cf.paymentSessionId,
        })
        .eq("order_id", order.id);

      return NextResponse.json({
        orderId: order.public_order_id,
        orderUuid: order.id,
        customerSessionToken: order.customer_session_token,
        amount: breakdown.total,
        breakdown,
        selectedPages: rangeResult.pages,
        gateway: "cashfree",
        paymentSessionId: cf.paymentSessionId,
        upiLink: null,
      });
    } catch (err) {
      const message =
        err instanceof CashfreeError ? err.message : "Could not start the payment.";
      console.error(`[orders] cashfree setup failed for order=${order.id}: ${message}`);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  // Razorpay is modelled in the schema but not wired yet; fall through to the
  // UPI-intent behaviour rather than pretending it works.

  // Default path, unchanged: a UPI intent link the customer pays directly,
  // confirmed by the shop owner in the dashboard.
  const upiId = settings?.upi_id || "";
  const upiLink = upiId
    ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(shop.shop_name)}&am=${breakdown.total}&tn=${order.public_order_id}`
    : null;

  return NextResponse.json({
    orderId: order.public_order_id,
    orderUuid: order.id,
    customerSessionToken: order.customer_session_token,
    amount: breakdown.total,
    breakdown,
    selectedPages: rangeResult.pages,
    upiLink,
    gateway: "none",
    paymentMethod: upiId ? "upi_intent" : "manual",
  });
}

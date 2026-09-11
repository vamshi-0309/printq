import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { calculatePrice, PricingError, type ShopPricingConfig } from "@/lib/pricing";
import { parsePageRange } from "@/lib/pageRange";
import { createServiceRoleClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  shopId: z.string().uuid(),
  pageCount: z.number().int().min(1),
  copies: z.number().int().min(1).max(500),
  colorMode: z.enum(["bw", "color"]),
  paperSize: z.enum(["A4", "A3"]),
  sides: z.enum(["single", "double"]),
  pageRange: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const parsed = requestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { shopId, pageCount, copies, colorMode, paperSize, sides, pageRange } = parsed.data;

  const rangeResult = parsePageRange(pageRange, pageCount);
  if (!rangeResult.ok) {
    return NextResponse.json({ error: rangeResult.error }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // Load shop's pricing config
  const { data: pricing, error: pricingError } = await supabase
    .from("pricing")
    .select("*")
    .eq("shop_id", shopId)
    .single();

  if (pricingError || !pricing) {
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

  try {
    const breakdown = calculatePrice(
      { pageCount: rangeResult.pages.length, copies, colorMode, paperSize, sides },
      config
    );
    return NextResponse.json({ breakdown, selectedPages: rangeResult.pages });
  } catch (err) {
    if (err instanceof PricingError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json({ error: "Could not calculate price." }, { status: 500 });
  }
}

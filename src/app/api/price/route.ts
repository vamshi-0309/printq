import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MAX_COLOR_RANGES } from "@/lib/pageRange";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { priceSpec, pricingConfigFrom } from "@/lib/orderEdit";

const requestSchema = z.object({
  shopId: z.string().uuid(),
  pageCount: z.number().int().min(1),
  copies: z.number().int().min(1).max(500),
  colorMode: z.enum(["bw", "color"]),
  paperSize: z.enum(["A4", "A3"]),
  sides: z.enum(["single", "double"]),
  pageRange: z.string().min(1),
  colorRanges: z
    .array(z.object({ range: z.string().min(1).max(200), mode: z.enum(["bw", "color"]) }))
    .max(MAX_COLOR_RANGES)
    .nullish(),
});

/**
 * A live quote for the customer's current choices.
 *
 * Priced by priceSpec — the function the order route and the owner's edit
 * use — so the number on screen is computed exactly the way the order will
 * be. The page count here is the browser's, which is fine for a preview: the
 * order route recounts the stored file and prices from that.
 */

export async function POST(req: NextRequest) {
  const parsed = requestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { shopId, pageCount, copies, colorMode, paperSize, sides, pageRange, colorRanges } = parsed.data;

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

  const priced = priceSpec(
    {
      copies,
      colorMode,
      paperSize,
      sides,
      orientation: "auto",
      pageRange,
      colorRanges: colorRanges ?? null,
      fitMode: "fit",
    },
    pageCount,
    pricingConfigFrom(pricing)
  );
  if (!priced.ok) {
    return NextResponse.json({ error: priced.error }, { status: 422 });
  }
  return NextResponse.json({ breakdown: priced.breakdown, selectedPages: priced.selectedPages });
}

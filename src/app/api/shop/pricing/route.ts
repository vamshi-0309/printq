import { NextRequest, NextResponse } from "next/server";
import { requireShop } from "@/lib/shopAuth";

/**
 * The shop's rate card.
 *
 * These numbers set what every future customer is charged, so the write is
 * validated and its result is checked. The previous version did neither: it
 * ran `parseFloat(body.x) || default`, so a typo silently became the default
 * rate, and it discarded the upsert's error entirely — a failed save returned
 * `{ ok: true }` and the form said "Saved."
 *
 * Changing rates never touches an existing order. `orders.amount` and
 * `orders.price_breakdown` are written once, from the rates in force at the
 * time, and nothing here reads or rewrites them.
 *
 * There is exactly one price calculation in this codebase (src/lib/pricing.ts)
 * and this route does not add another — it only stores the inputs that
 * calculation reads.
 */

export const dynamic = "force-dynamic";

/** Well above any real per-page rate; a guard against a slipped decimal. */
const MAX_RATE = 1000;
const MAX_MINIMUM = 10000;

interface FieldError {
  field: string;
  message: string;
}

function readRate(
  raw: unknown,
  field: string,
  label: string,
  errors: FieldError[],
  max = MAX_RATE
): number | null {
  const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? "").trim());

  if (!Number.isFinite(value)) {
    errors.push({ field, message: `${label} must be a number.` });
    return null;
  }
  if (value < 0) {
    errors.push({ field, message: `${label} can't be negative.` });
    return null;
  }
  if (value > max) {
    errors.push({ field, message: `${label} looks wrong — the most allowed is ₹${max}.` });
    return null;
  }
  // The column is numeric(10,2); rounding here keeps what is stored equal to
  // what the owner typed rather than letting Postgres decide.
  return Math.round(value * 100) / 100;
}

export async function GET() {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, db } = auth.ctx;

  const { data: pricing, error } = await db
    .from("pricing")
    .select("*")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not load your pricing." }, { status: 500 });
  }

  return NextResponse.json({ pricing });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, db } = auth.ctx;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const errors: FieldError[] = [];

  const a4Bw = readRate(body.a4BwPerPage, "a4BwPerPage", "A4 black & white", errors);
  const a4Color = readRate(body.a4ColorPerPage, "a4ColorPerPage", "A4 colour", errors);
  const a3Bw = readRate(body.a3BwPerPage, "a3BwPerPage", "A3 black & white", errors);
  const a3Color = readRate(body.a3ColorPerPage, "a3ColorPerPage", "A3 colour", errors);
  const duplex = readRate(
    body.duplexDiscountPercent,
    "duplexDiscountPercent",
    "Double-sided discount",
    errors,
    100
  );
  const minimum = readRate(
    body.minimumOrderAmount,
    "minimumOrderAmount",
    "Minimum order amount",
    errors,
    MAX_MINIMUM
  );

  const enableA3 = body.enableA3 === true || body.enableA3 === "true";

  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0].message, errors }, { status: 422 });
  }

  const enabledPaperSizes = enableA3 ? ["A4", "A3"] : ["A4"];

  const { data: saved, error } = await db
    .from("pricing")
    .upsert(
      {
        shop_id: shopId,
        a4_bw_per_page: a4Bw,
        a4_color_per_page: a4Color,
        a3_bw_per_page: a3Bw,
        a3_color_per_page: a3Color,
        duplex_discount_percent: duplex,
        minimum_order_amount: minimum,
        enabled_paper_sizes: enabledPaperSizes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id" }
    )
    .select("*")
    .single();

  if (error || !saved) {
    return NextResponse.json({ error: "Could not save your pricing." }, { status: 500 });
  }

  // Returning the stored row means the form redraws from what the database
  // actually holds, not from what the browser hoped it sent.
  return NextResponse.json({ ok: true, pricing: saved });
}

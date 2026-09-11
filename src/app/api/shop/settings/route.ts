import { NextRequest, NextResponse } from "next/server";
import { requireShop } from "@/lib/shopAuth";
import { getCashfreeConfig } from "@/lib/cashfree";
import { normalizeGatewayAccountId } from "@/lib/gatewaySettings";

/**
 * Shop settings.
 *
 * `shop_settings` has RLS enabled with no policy attached, so a user-scoped
 * client silently matches zero rows — reads come back empty and writes report
 * success while changing nothing. Membership is therefore proved with the
 * cookie-bound client (requireShop) and the row is read and written as the
 * platform. Every mutation checks its error; an earlier version did not, and
 * saving settings appeared to work while persisting nothing.
 *
 * WHAT IS NEVER RETURNED
 * Columns are listed explicitly rather than selected with `*`. Two things must
 * not travel in this payload:
 *
 *   - shop_settings.pairing_code — a live pairing code lets any machine that
 *     learns it attach an agent to this shop. It is issued deliberately by the
 *     agent endpoint and shown once, not carried along in an unrelated read.
 *   - anything belonging to PrintQ's own Cashfree account. The app id and
 *     secret live in server environment variables, are never stored per shop,
 *     and are never sent to a browser. `gatewayAvailability` answers the only
 *     question the UI actually has — whether the server can transact at all —
 *     as a boolean.
 */

export const dynamic = "force-dynamic";

const SHOP_COLUMNS =
  "id, slug, shop_name, owner_name, phone, email, address, city, state, pincode, gstin, status, created_at";

const SETTINGS_COLUMNS =
  "shop_id, upi_id, payment_gateway, payment_gateway_account_id, file_retention_hours, heartbeat_timeout_seconds, updated_at";

const MIN_RETENTION_HOURS = 1;
const MAX_RETENTION_HOURS = 168;

export async function GET() {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, db } = auth.ctx;

  const [{ data: shop, error: shopError }, { data: settings }, { data: licence }] =
    await Promise.all([
      db.from("shops").select(SHOP_COLUMNS).eq("id", shopId).single(),
      db.from("shop_settings").select(SETTINGS_COLUMNS).eq("shop_id", shopId).maybeSingle(),
      db
        .from("licences")
        .select("plan, status, activated_at, expires_at, grace_period_days")
        .eq("shop_id", shopId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (shopError || !shop) {
    return NextResponse.json({ error: "Could not load your shop." }, { status: 500 });
  }

  return NextResponse.json({
    shop,
    settings,
    licence,
    // Lets the dashboard show whether online payments can be selected at all,
    // instead of offering a gateway the server has no credentials for.
    gatewayAvailability: { cashfree: getCashfreeConfig() !== null, razorpay: false },
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, db } = auth.ctx;

  let body: {
    shop?: Record<string, unknown>;
    settings?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Things worth telling the owner about that are not reasons to refuse a save.
  const warnings: string[] = [];

  if (body.shop) {
    const text = (v: unknown) => {
      const s = typeof v === "string" ? v.trim() : "";
      return s.length > 0 ? s : null;
    };

    const shopName = text(body.shop.shop_name);
    const ownerName = text(body.shop.owner_name);
    const phone = text(body.shop.phone);
    const email = text(body.shop.email);

    // These four are NOT NULL in the schema. Sending a blank one would raise a
    // constraint error the owner cannot interpret, so it is caught here.
    const missing = [
      !shopName && "shop name",
      !ownerName && "owner name",
      !phone && "phone number",
      !email && "email",
    ].filter(Boolean);

    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Please fill in your ${missing.join(", ")}.` },
        { status: 422 }
      );
    }

    const { error } = await db
      .from("shops")
      .update({
        shop_name: shopName,
        owner_name: ownerName,
        phone,
        email,
        address: text(body.shop.address),
        city: text(body.shop.city),
        state: text(body.shop.state),
        pincode: text(body.shop.pincode),
        gstin: text(body.shop.gstin),
        updated_at: new Date().toISOString(),
      })
      .eq("id", shopId);

    if (error) {
      return NextResponse.json({ error: "Could not save shop details." }, { status: 500 });
    }
  }

  if (body.settings) {
    const { upi_id, payment_gateway, payment_gateway_account_id, file_retention_hours } =
      body.settings;

    const gateway = payment_gateway === "none" || !payment_gateway ? null : payment_gateway;

    // Cashfree currently runs on PrintQ's single platform merchant account
    // (CASHFREE_APP_ID / CASHFREE_SECRET_KEY on the server), so a shop has no
    // account id to supply. The column is retained for the future per-shop
    // sub-merchant phase; until then a blank field persists as NULL rather
    // than "", so "not configured" stays unambiguous for that migration.
    const accountId = normalizeGatewayAccountId(payment_gateway_account_id);

    // Reject a gateway the server cannot actually transact with, rather than
    // letting the shop accept orders that fail at the customer's checkout.
    if (gateway === "cashfree" && !getCashfreeConfig()) {
      return NextResponse.json(
        {
          error:
            "Cashfree isn't configured on this server yet. Contact PrintQ support to enable it.",
        },
        { status: 422 }
      );
    }
    if (gateway === "razorpay") {
      return NextResponse.json(
        { error: "Razorpay isn't available yet. Choose Cashfree or UPI intent." },
        { status: 422 }
      );
    }

    const upi = typeof upi_id === "string" ? upi_id.trim() : "";
    if (upi && !/^[\w.\-]{2,64}@[a-zA-Z0-9]{2,32}$/.test(upi)) {
      return NextResponse.json(
        { error: "That doesn't look like a UPI ID. It should look like yourshop@okhdfcbank." },
        { status: 422 }
      );
    }

    // With no gateway and no UPI id, a customer is shown no way to pay at all.
    // Reported rather than refused: the owner may be part-way through setup and
    // saving an unrelated field, and blocking that would be obstructive.
    if (!gateway && !upi) {
      warnings.push(
        "Customers have no way to pay you yet. Add your UPI ID or choose a payment gateway."
      );
    }

    const retention = Number.parseInt(String(file_retention_hours), 10);
    if (
      !Number.isFinite(retention) ||
      retention < MIN_RETENTION_HOURS ||
      retention > MAX_RETENTION_HOURS
    ) {
      return NextResponse.json(
        { error: `Delete files after must be between ${MIN_RETENTION_HOURS} and ${MAX_RETENTION_HOURS} hours.` },
        { status: 422 }
      );
    }

    const { error } = await db.from("shop_settings").upsert(
      {
        shop_id: shopId,
        upi_id: upi || null,
        payment_gateway: gateway,
        payment_gateway_account_id: accountId,
        file_retention_hours: retention,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id" }
    );

    if (error) {
      return NextResponse.json({ error: "Could not save payment settings." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, warnings });
}

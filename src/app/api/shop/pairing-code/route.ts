import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireShop } from "@/lib/shopAuth";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, userId, db } = auth.ctx;

  const code = crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 6);

  // Short-lived by design: a 6-character code is guessable given unlimited
  // time, so it stops being accepted after the configured TTL.
  const ttlMinutes = Number.parseInt(process.env.AGENT_PAIRING_TOKEN_TTL_MINUTES ?? "", 10);
  const ttl = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 15;
  const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();

  // upsert, not update: a shop with no shop_settings row yet would otherwise
  // match zero rows and report success while saving nothing.
  const { error } = await db
    .from("shop_settings")
    .upsert(
      { shop_id: shopId, pairing_code: code, pairing_code_expires_at: expiresAt },
      { onConflict: "shop_id" }
    );

  if (error) {
    return NextResponse.json({ error: "Failed to save pairing code." }, { status: 500 });
  }

  // Issuing a code is what lets a new machine print for this shop, so it is
  // worth a record. The code itself is deliberately not logged.
  await db.from("audit_logs").insert({
    actor_type: "shop_owner",
    actor_id: userId,
    shop_id: shopId,
    action: "agent.pairing_code_issued",
    target_table: "shop_settings",
    target_id: shopId,
    metadata: { ttl_minutes: ttl },
  });

  return NextResponse.json({ code, expiresAt, expiresInMinutes: ttl });
}

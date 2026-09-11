import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.pairing_code) {
    return NextResponse.json({ error: "Missing pairing code." }, { status: 400 });
  }

  const pairingCode: string = body.pairing_code.toUpperCase().trim();

  if (!/^[A-Z0-9]{6}$/.test(pairingCode)) {
    return NextResponse.json({ error: "Invalid pairing code format." }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // Look up the pairing code — stored in shop_settings.pairing_code
  // with a short expiry. For now we use a simpler approach: the shop
  // generates a code, stores it in shop_settings, and the agent sends
  // it here within 10 minutes.
  const { data: settings } = await supabase
    .from("shop_settings")
    .select("shop_id, pairing_code_expires_at")
    .eq("pairing_code", pairingCode)
    .maybeSingle();

  if (!settings) {
    return NextResponse.json({ error: "Invalid or expired pairing code." }, { status: 404 });
  }

  // Enforce the expiry the code was issued with. Same message as an unknown
  // code, so this can't be used to probe which codes exist.
  const expiresAt = settings.pairing_code_expires_at
    ? new Date(settings.pairing_code_expires_at).getTime()
    : 0;
  if (!expiresAt || expiresAt < Date.now()) {
    return NextResponse.json({ error: "Invalid or expired pairing code." }, { status: 404 });
  }

  // Generate agent credentials
  const agentSecret = crypto.randomBytes(32).toString("hex");
  const agentSecretHash = crypto.createHash("sha256").update(agentSecret).digest("hex");

  // Create the agent row
  const { data: agent, error } = await supabase
    .from("print_agents")
    .insert({
      shop_id: settings.shop_id,
      agent_secret_hash: agentSecretHash,
      status: "offline",
    })
    .select("id")
    .single();

  if (error || !agent) {
    return NextResponse.json({ error: "Failed to create agent." }, { status: 500 });
  }

  // Clear the pairing code so it can't be reused
  await supabase
    .from("shop_settings")
    .update({ pairing_code: null, pairing_code_expires_at: null })
    .eq("shop_id", settings.shop_id);

  // Get shop info for the agent config
  const { data: shop } = await supabase
    .from("shops")
    .select("shop_name, slug")
    .eq("id", settings.shop_id)
    .single();

  return NextResponse.json({
    agentId: agent.id,
    agentSecret,
    shopId: settings.shop_id,
    shopName: shop?.shop_name ?? "",
    shopSlug: shop?.slug ?? "",
    apiBaseUrl: process.env.NEXT_PUBLIC_APP_URL || "https://printq.in",
  });
}

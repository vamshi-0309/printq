import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent } from "../auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const printers: { system_name: string; is_default: boolean; supports_color?: boolean; supports_duplex?: boolean }[] = body.printers ?? [];
  const agentVersion: string = body.agent_version ?? "unknown";
  const hostname: string = body.hostname ?? "";

  const supabase = createServiceRoleClient();

  // Update agent heartbeat
  await supabase
    .from("print_agents")
    .update({
      last_heartbeat_at: new Date().toISOString(),
      status: "online",
      version: agentVersion,
      hostname,
    })
    .eq("id", auth.agentId)
    .eq("shop_id", auth.shopId);

  // Upsert printers. Errors are collected rather than ignored: this silently
  // failed for every printer because no unique constraint matched the
  // ON CONFLICT target, and the 200 response hid it completely.
  //
  // `is_default` is deliberately NOT written here. The agent reports whatever
  // Windows considers default, and overwriting on every heartbeat would undo
  // the shop owner's choice within 20 seconds of them making it. The owner's
  // selection wins; Windows only seeds it below when nothing is set yet.
  const printerErrors: string[] = [];
  for (const p of printers) {
    const { error: printerError } = await supabase.from("printers").upsert(
      {
        shop_id: auth.shopId,
        agent_id: auth.agentId,
        system_name: p.system_name,
        display_name: p.system_name,
        supports_color: p.supports_color ?? false,
        supports_duplex: p.supports_duplex ?? false,
        last_status: "ready",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,system_name", ignoreDuplicates: false }
    );
    if (printerError) printerErrors.push(`${p.system_name}: ${printerError.message}`);
  }

  if (printerErrors.length > 0) {
    // The heartbeat itself succeeded, so the agent stays online — but this
    // must be visible instead of vanishing behind a 200.
    console.error(
      `[agent-heartbeat] shop=${auth.shopId} failed to save ${printerErrors.length} printer(s): ${printerErrors[0]}`
    );
  }

  // Seed a default only when the shop has none — first discovery, or every
  // printer was removed. After that the dashboard owns this field.
  if (printers.length > 0 && printerErrors.length === 0) {
    const { count: defaultCount } = await supabase
      .from("printers")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", auth.shopId)
      .eq("is_default", true);

    if ((defaultCount ?? 0) === 0) {
      const windowsDefault = printers.find((p) => p.is_default) ?? printers[0];
      await supabase
        .from("printers")
        .update({ is_default: true })
        .eq("shop_id", auth.shopId)
        .eq("system_name", windowsDefault.system_name);
    }
  }

  // Check licence status
  const { data: licence } = await supabase
    .from("licences")
    .select("status, expires_at")
    .eq("shop_id", auth.shopId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return NextResponse.json({
    status: "ok",
    printers_saved: printers.length - printerErrors.length,
    licence: licence?.status ?? "unknown",
    heartbeat_interval_seconds: 20,
    server_time: new Date().toISOString(),
  });
}

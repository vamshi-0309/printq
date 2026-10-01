import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent } from "../auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PRINTER_PROBLEMS } from "@/lib/printerHealth";
import { purgeExpiredFiles } from "@/lib/jobMaintenance";
import { deleteFile } from "@/lib/storage";
import { cashfreeGateway } from "@/lib/orderMoney";

/** A status code the agent may report; anything else is stored as "ready". */
function reportedStatus(raw: unknown): string {
  return typeof raw === "string" && raw in PRINTER_PROBLEMS ? raw : "ready";
}

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const printers: {
    system_name: string;
    is_default: boolean;
    supports_color?: boolean;
    supports_duplex?: boolean;
    /** Agent 1.1+: the spooler's view of this printer, e.g. "out_of_paper". */
    status?: string;
  }[] = body.printers ?? [];
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

  // Save printers. Errors are collected rather than ignored: this silently
  // failed for every printer because no unique constraint matched the
  // ON CONFLICT target, and the 200 response hid it completely.
  //
  // `is_default` is deliberately NOT written here. The agent reports whatever
  // Windows considers default, and overwriting on every heartbeat would undo
  // the shop owner's choice within 20 seconds of them making it. The owner's
  // selection wins; Windows only seeds it below when nothing is set yet.
  //
  // `display_name` is the same: it is set once, when a printer is first seen,
  // and after that belongs to the owner, who can rename it. It used to be
  // rewritten to the Windows name on every heartbeat. `system_name` — the
  // exact Windows name the agent prints to — is never changed by a rename.
  const { data: knownRows } = await supabase
    .from("printers")
    .select("system_name")
    .eq("shop_id", auth.shopId);
  const known = new Set((knownRows ?? []).map((r) => r.system_name as string));

  const printerErrors: string[] = [];
  for (const p of printers) {
    const fields = {
      shop_id: auth.shopId,
      agent_id: auth.agentId,
      system_name: p.system_name,
      supports_color: p.supports_color ?? false,
      supports_duplex: p.supports_duplex ?? false,
      last_status: reportedStatus(p.status),
      updated_at: new Date().toISOString(),
    };
    const { error: printerError } = known.has(p.system_name)
      ? await supabase
          .from("printers")
          .update(fields)
          .eq("shop_id", auth.shopId)
          .eq("system_name", p.system_name)
      : await supabase
          .from("printers")
          .upsert({ ...fields, display_name: p.system_name }, { onConflict: "shop_id,system_name", ignoreDuplicates: false });
    if (printerError) printerErrors.push(`${p.system_name}: ${printerError.message}`);
  }

  // The agent could not reach the Windows print spooler at all, so it listed
  // no printers. Say so on this agent's printers rather than leaving them
  // looking ready.
  if (body.spooler_ok === false) {
    await supabase
      .from("printers")
      .update({ last_status: "spooler_down", updated_at: new Date().toISOString() })
      .eq("shop_id", auth.shopId)
      .eq("agent_id", auth.agentId);
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

  // Echo back which printer this shop has chosen, so the agent's own window
  // can show it without inventing a second opinion. The agent displays this;
  // it never decides it. The claim route remains the only thing that picks a
  // printer for an actual job.
  const { data: selected } = await supabase
    .from("printers")
    .select("system_name")
    .eq("shop_id", auth.shopId)
    .eq("is_default", true)
    .eq("is_enabled", true)
    .maybeSingle();

  // Retention: delete this shop's expired customer files, a small batch per
  // heartbeat. Never allowed to fail the heartbeat itself.
  try {
    const { data: retention } = await supabase
      .from("shop_settings")
      .select("file_retention_hours")
      .eq("shop_id", auth.shopId)
      .maybeSingle();
    const gateway = cashfreeGateway();
    const purged = await purgeExpiredFiles(
      supabase,
      auth.shopId,
      Number(retention?.file_retention_hours ?? 24),
      { removeObject: deleteFile, terminateCheckout: gateway ? (id) => gateway.terminate(id) : undefined }
    );
    if (purged.deleted > 0 || purged.failed > 0) {
      console.info(
        `[retention] shop=${auth.shopId} deleted=${purged.deleted} expired_orders=${purged.expiredOrders} failed=${purged.failed}`
      );
    }
  } catch (err) {
    console.error(`[retention] shop=${auth.shopId} pass failed: ${err instanceof Error ? err.message : err}`);
  }

  return NextResponse.json({
    status: "ok",
    printers_saved: printers.length - printerErrors.length,
    selected_printer: selected?.system_name ?? null,
    licence: licence?.status ?? "unknown",
    heartbeat_interval_seconds: 20,
    server_time: new Date().toISOString(),
  });
}

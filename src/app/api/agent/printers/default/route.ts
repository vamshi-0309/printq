import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent } from "../../auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Let the agent set which printer PrintQ prints to.
 *
 * The shop owner is standing at the counter PC with the agent window open;
 * making them log into the dashboard on that machine just to tick a radio
 * button is the kind of friction that ends with someone giving up. The agent
 * is already an authenticated actor for exactly one shop, so it can ask for
 * this change on the owner's behalf.
 *
 * What this deliberately does NOT do is make the agent authoritative. It asks
 * the server to change a row; the claim route still decides what a job prints
 * on, and applies the same rules it always has. Every constraint the dashboard
 * enforces is enforced here too:
 *
 *   - the printer must belong to the calling agent's own shop (scoped query,
 *     so naming another shop's printer id or name is a 404, not a takeover);
 *   - it must be enabled, because a disabled default is a queue that stops;
 *   - exactly one default per shop, so the others are cleared in the same
 *     request.
 *
 * The printer is named by its Windows `system_name` rather than a row id: the
 * agent knows what Windows calls the device, and does not need to learn our
 * primary keys to point at it.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) return auth.response;

  let body: { system_name?: unknown; printer_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const systemName = typeof body.system_name === "string" ? body.system_name.trim() : "";
  const printerId = typeof body.printer_id === "string" ? body.printer_id.trim() : "";

  if (!systemName && !printerId) {
    return NextResponse.json(
      { error: "Name the printer to use." },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();

  // Scoped to the agent's shop in the query itself, so another shop's printer
  // simply does not exist from here.
  let lookup = supabase
    .from("printers")
    .select("id, system_name, is_enabled")
    .eq("shop_id", auth.shopId);

  lookup = printerId ? lookup.eq("id", printerId) : lookup.eq("system_name", systemName);

  const { data: printer, error: lookupError } = await lookup.maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: "Could not look up that printer." }, { status: 500 });
  }
  if (!printer) {
    return NextResponse.json(
      {
        error:
          "That printer isn't registered with PrintQ yet. Use Refresh printers, then try again.",
      },
      { status: 404 }
    );
  }
  if (!printer.is_enabled) {
    return NextResponse.json(
      {
        error:
          "That printer is switched off in PrintQ. Turn it on in Dashboard > Printers first.",
      },
      { status: 409 }
    );
  }

  // One default per shop: clear the others before setting this one, both
  // writes scoped to the shop.
  const { error: clearError } = await supabase
    .from("printers")
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq("shop_id", auth.shopId)
    .neq("id", printer.id);

  if (clearError) {
    return NextResponse.json({ error: "Could not update the printer." }, { status: 500 });
  }

  const { error: setError } = await supabase
    .from("printers")
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq("id", printer.id)
    .eq("shop_id", auth.shopId);

  if (setError) {
    return NextResponse.json({ error: "Could not update the printer." }, { status: 500 });
  }

  await supabase.from("audit_logs").insert({
    actor_type: "agent",
    actor_id: auth.agentId,
    shop_id: auth.shopId,
    action: "printer.default_set",
    target_table: "printers",
    target_id: printer.id,
    metadata: { system_name: printer.system_name },
  });

  return NextResponse.json({
    ok: true,
    printer: { id: printer.id, systemName: printer.system_name },
  });
}

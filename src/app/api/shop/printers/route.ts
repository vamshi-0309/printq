import { NextRequest, NextResponse } from "next/server";
import { requireShop } from "@/lib/shopAuth";
import { evaluateShopReadiness } from "@/lib/shopReadiness";

/**
 * Printers discovered by the shop's agent.
 *
 * Every row here was reported by a real agent from a real Windows machine —
 * this route creates nothing. If the list is empty, the honest answer is that
 * no agent has reported a printer, and that is what the response says.
 *
 * `printers` has RLS enabled with no policy attached, so a user-scoped query
 * silently matches zero rows; that is why the dashboard listed nothing while
 * the agent was reporting four printers. Membership is proved with the
 * cookie-bound client and the rows are read as the platform.
 */

export const dynamic = "force-dynamic";

const MAX_DISPLAY_NAME = 80;

export async function GET() {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, db } = auth.ctx;

  const now = new Date();

  // Ordered by name: the table has no created_at column, and ordering by a
  // column that doesn't exist made the whole query fail and return nothing.
  const [printersRes, agentsRes, settingsRes] = await Promise.all([
    db.from("printers").select("*").eq("shop_id", shopId).order("system_name", { ascending: true }),
    db
      .from("print_agents")
      .select("id, hostname, version, last_heartbeat_at, created_at")
      .eq("shop_id", shopId),
    db.from("shop_settings").select("heartbeat_timeout_seconds").eq("shop_id", shopId).maybeSingle(),
  ]);

  if (printersRes.error) {
    return NextResponse.json({ error: "Could not load printers." }, { status: 500 });
  }

  const readiness = evaluateShopReadiness({
    shopStatus: "active",
    heartbeatTimeoutSeconds: settingsRes.data?.heartbeat_timeout_seconds ?? null,
    agents: agentsRes.data ?? [],
    printers: printersRes.data ?? [],
    now,
  });

  // A printer belonging to an agent that is no longer live is not available,
  // however recently it was reported. Saying so is the difference between
  // "ready" and "this was ready the last time anyone checked".
  const liveAgentIds = new Set(readiness.agents.filter((a) => a.online).map((a) => a.id));

  const printers = (printersRes.data ?? []).map((p) => ({
    ...p,
    agentOnline: p.agent_id ? liveAgentIds.has(p.agent_id) : false,
    available: p.is_enabled && Boolean(p.agent_id && liveAgentIds.has(p.agent_id)),
  }));

  const agentRow = readiness.activeAgent;

  return NextResponse.json({
    printers,
    agent: agentRow
      ? {
          id: agentRow.id,
          hostname: agentRow.hostname,
          version: agentRow.version,
          last_heartbeat_at: agentRow.last_heartbeat_at,
          // Derived from heartbeat freshness — the stored column is only ever
          // set to "online" and would show a dead agent as connected.
          status: agentRow.online ? "online" : "offline",
        }
      : null,
    agentCount: readiness.agents.length,
    agentOnline: readiness.agentOnline,
    printerAvailable: readiness.printerAvailable,
    serverTime: now.toISOString(),
  });
}

/**
 * Update one printer: rename it, make it the shop's default, or
 * enable/disable it.
 *
 * Only one printer per shop may be the default, so setting one clears the
 * rest in the same request.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, db } = auth.ctx;

  let body: { printerId?: unknown; isDefault?: unknown; isEnabled?: unknown; displayName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const printerId = typeof body.printerId === "string" ? body.printerId : null;
  if (!printerId) {
    return NextResponse.json({ error: "printerId is required." }, { status: 400 });
  }

  // Scope the lookup to this shop so a caller can't touch another shop's row
  // by guessing an id.
  const { data: printer } = await db
    .from("printers")
    .select("id, is_default, is_enabled, system_name")
    .eq("id", printerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!printer) {
    return NextResponse.json({ error: "Printer not found." }, { status: 404 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.displayName === "string") {
    const name = body.displayName.trim().slice(0, MAX_DISPLAY_NAME);
    if (!name) {
      return NextResponse.json({ error: "A printer needs a name." }, { status: 422 });
    }
    // Only the label changes. system_name is the exact Windows name the agent
    // prints to and must never be edited from here.
    update.display_name = name;
  }

  if (typeof body.isEnabled === "boolean") {
    // Disabling the default would leave the shop with a default it cannot use.
    if (!body.isEnabled && printer.is_default) {
      return NextResponse.json(
        {
          error:
            "This is your default printer. Make another printer the default before disabling it.",
        },
        { status: 409 }
      );
    }
    update.is_enabled = body.isEnabled;
  }

  if (body.isDefault === true) {
    if (printer.is_enabled === false && body.isEnabled !== true) {
      return NextResponse.json(
        { error: "Enable this printer before making it the default." },
        { status: 409 }
      );
    }

    const { error: clearError } = await db
      .from("printers")
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq("shop_id", shopId)
      .neq("id", printerId);

    if (clearError) {
      return NextResponse.json({ error: "Could not update the default." }, { status: 500 });
    }
    update.is_default = true;
  } else if (body.isDefault === false) {
    update.is_default = false;
  }

  const { error } = await db.from("printers").update(update).eq("id", printerId);

  if (error) {
    return NextResponse.json({ error: "Could not update the printer." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

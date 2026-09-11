import { NextResponse } from "next/server";
import { requireShop } from "@/lib/shopAuth";
import { evaluateShopReadiness } from "@/lib/shopReadiness";
import { DEFAULT_HEARTBEAT_TIMEOUT_SECONDS } from "@/lib/agentStatus";

/**
 * The agents paired to this shop.
 *
 * Pairing creates a print_agents row before the agent has ever reported in, so
 * a shop that retried pairing a few times accumulates rows that never had a
 * heartbeat. They are harmless but confusing — this shop has four rows and one
 * live process — so each row is returned with its derived liveness and a plain
 * statement of whether it has ever been seen at all.
 *
 * Liveness is never read from print_agents.status: nothing writes "offline" to
 * that column, so it reads "online" forever once an agent has run. It is
 * derived from heartbeat freshness instead.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, db } = auth.ctx;

  const now = new Date();

  const [agentsRes, printersRes, settingsRes] = await Promise.all([
    db
      .from("print_agents")
      .select("id, hostname, version, last_heartbeat_at, created_at")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false }),
    db.from("printers").select("id, agent_id, is_enabled, is_default, last_status").eq("shop_id", shopId),
    db
      .from("shop_settings")
      .select("heartbeat_timeout_seconds, pairing_code, pairing_code_expires_at")
      .eq("shop_id", shopId)
      .maybeSingle(),
  ]);

  if (agentsRes.error) {
    return NextResponse.json({ error: "Could not load agents." }, { status: 500 });
  }

  const timeout = settingsRes.data?.heartbeat_timeout_seconds ?? DEFAULT_HEARTBEAT_TIMEOUT_SECONDS;

  const readiness = evaluateShopReadiness({
    shopStatus: "active",
    heartbeatTimeoutSeconds: timeout,
    agents: agentsRes.data ?? [],
    printers: printersRes.data ?? [],
    now,
  });

  const printerCountByAgent = new Map<string, number>();
  for (const p of printersRes.data ?? []) {
    if (!p.agent_id) continue;
    printerCountByAgent.set(p.agent_id, (printerCountByAgent.get(p.agent_id) ?? 0) + 1);
  }

  const agents = readiness.agents.map((a) => ({
    id: a.id,
    hostname: a.hostname,
    version: a.version,
    lastHeartbeatAt: a.last_heartbeat_at,
    createdAt: a.created_at ?? null,
    online: a.online,
    /** Paired but never ran — safe to remove. */
    neverSeen: !a.last_heartbeat_at,
    printerCount: printerCountByAgent.get(a.id) ?? 0,
  }));

  // A pairing code is short-lived by design; report the remaining time rather
  // than the code's own expiry timestamp, which the UI would have to
  // re-derive against a clock that may not match the server's.
  const expiresAt = settingsRes.data?.pairing_code_expires_at ?? null;
  const secondsRemaining = expiresAt
    ? Math.max(0, Math.round((new Date(expiresAt).getTime() - now.getTime()) / 1000))
    : 0;

  return NextResponse.json({
    agents,
    agentOnline: readiness.agentOnline,
    heartbeatTimeoutSeconds: timeout,
    // The code itself is only shown while it is still usable.
    pairing:
      settingsRes.data?.pairing_code && secondsRemaining > 0
        ? { code: settingsRes.data.pairing_code, secondsRemaining }
        : null,
    serverTime: now.toISOString(),
  });
}

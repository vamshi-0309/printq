import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

export async function authenticateAgent(req: NextRequest): Promise<
  { ok: true; shopId: string; agentId: string } | { ok: false; response: NextResponse }
> {
  const shopId = req.headers.get("x-printq-shop-id");
  const agentId = req.headers.get("x-printq-agent-id");
  const agentSecret = req.headers.get("x-printq-agent-secret");

  if (!shopId || !agentId || !agentSecret) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Missing agent credentials." }, { status: 401 }),
    };
  }

  const supabase = createServiceRoleClient();

  const { data: agent } = await supabase
    .from("print_agents")
    .select("id, agent_secret_hash, shop_id")
    .eq("id", agentId)
    .eq("shop_id", shopId)
    .single();

  if (!agent) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Agent not found." }, { status: 401 }),
    };
  }

  const hash = crypto.createHash("sha256").update(agentSecret).digest("hex");
  if (hash !== agent.agent_secret_hash) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid agent secret." }, { status: 401 }),
    };
  }

  return { ok: true, shopId, agentId };
}

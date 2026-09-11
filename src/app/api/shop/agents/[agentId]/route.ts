import { NextRequest, NextResponse } from "next/server";
import { requireShop } from "@/lib/shopAuth";
import { isAgentOnline, DEFAULT_HEARTBEAT_TIMEOUT_SECONDS } from "@/lib/agentStatus";

/**
 * Unpair an agent.
 *
 * Every failed pairing attempt leaves a print_agents row behind, so a shop
 * that fiddled with setup ends up with several dead entries and no way to tell
 * which one is the real counter PC. Removing one revokes its credentials
 * permanently — the agent process will start getting 401s and show "Auth
 * rejected" — so the refusals below matter more than the deletion itself.
 *
 * Refused when the agent is holding a job that has not finished: print_jobs
 * references print_agents without ON DELETE, so the delete would fail at the
 * database anyway, and a job mid-print is exactly the wrong thing to orphan.
 */

export const dynamic = "force-dynamic";

const UNFINISHED_JOB_STATES = ["CLAIMED", "PRINT_ATTEMPTED", "PRINTING"];

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, userId, db } = auth.ctx;
  const { agentId } = await params;

  const { data: agent } = await db
    .from("print_agents")
    .select("id, hostname, last_heartbeat_at")
    .eq("id", agentId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }

  const { data: settings } = await db
    .from("shop_settings")
    .select("heartbeat_timeout_seconds")
    .eq("shop_id", shopId)
    .maybeSingle();

  const online = isAgentOnline(
    agent.last_heartbeat_at,
    settings?.heartbeat_timeout_seconds ?? DEFAULT_HEARTBEAT_TIMEOUT_SECONDS
  );

  const { data: heldJobs } = await db
    .from("print_jobs")
    .select("id, state")
    .eq("claimed_by_agent_id", agentId)
    .in("state", UNFINISHED_JOB_STATES);

  if (heldJobs && heldJobs.length > 0) {
    return NextResponse.json(
      {
        error:
          "This agent is in the middle of a print job. Wait for it to finish, or resolve the job on the order first.",
      },
      { status: 409 }
    );
  }

  // print_attempts.agent_id is NOT NULL with no ON DELETE rule, so an agent
  // that has ever printed cannot be deleted without destroying that history.
  // Keeping the record is the right trade — say so plainly instead of
  // surfacing a foreign key violation.
  const { count: attemptCount } = await db
    .from("print_attempts")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentId);

  if ((attemptCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "This agent has print history attached to it, so it can't be removed. Pair the new agent alongside it — only the live one is used.",
      },
      { status: 409 }
    );
  }

  // Jobs this agent completed keep pointing at it, so clear the reference
  // before removing the row rather than letting the foreign key reject it.
  await db
    .from("print_jobs")
    .update({ claimed_by_agent_id: null })
    .eq("claimed_by_agent_id", agentId);

  const { error } = await db
    .from("print_agents")
    .delete()
    .eq("id", agentId)
    .eq("shop_id", shopId);

  if (error) {
    return NextResponse.json(
      { error: "Could not remove this agent. It may still have print history attached." },
      { status: 500 }
    );
  }

  await db.from("audit_logs").insert({
    actor_type: "shop_owner",
    actor_id: userId,
    shop_id: shopId,
    action: "agent.unpaired",
    target_table: "print_agents",
    target_id: agentId,
    metadata: { hostname: agent.hostname, was_online: online },
  });

  return NextResponse.json({ ok: true, wasOnline: online });
}

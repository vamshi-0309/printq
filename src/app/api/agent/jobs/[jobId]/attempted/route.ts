import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent } from "../../../auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { printerBelongsToShop } from "@/lib/printerSelection";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) return auth.response;
  const { jobId } = await params;

  const body = await req.json().catch(() => null);
  // Both values the agent sends are treated as reports, not instructions: the
  // attempt number is assigned below, and the printer is resolved from what
  // the server recorded when it handed the job out.
  const reportedAttempt = body?.attempt_number ?? 1;
  const reportedPrinterId = typeof body?.printer_id === "string" ? body.printer_id : null;

  const supabase = createServiceRoleClient();

  // Verify job is claimed by this agent
  const { data: job } = await supabase
    .from("print_jobs")
    .select("id, order_id, state")
    .eq("id", jobId)
    .eq("claimed_by_agent_id", auth.agentId)
    .single();

  if (!job) {
    return NextResponse.json({ error: "Job not found or not claimed by this agent." }, { status: 404 });
  }

  if (job.state !== "CLAIMED") {
    return NextResponse.json({ error: `Cannot attempt from state ${job.state}.` }, { status: 409 });
  }

  // Which printer is this attempt against?
  //
  // orders.printer_id is written by the claim route from the shop's own
  // selection, so it is the authoritative answer and needs no validation. The
  // agent also reports the printer it used; that value is only accepted when
  // the server recorded nothing, and only after checking it belongs to this
  // shop — otherwise a crafted request could file one shop's printer against
  // another shop's job.
  const { data: orderRow } = await supabase
    .from("orders")
    .select("printer_id, shop_id")
    .eq("id", job.order_id)
    .eq("shop_id", auth.shopId)
    .maybeSingle();

  let printerId: string | null = orderRow?.printer_id ?? null;

  if (!printerId && reportedPrinterId) {
    const { data: shopPrinters } = await supabase
      .from("printers")
      .select("id, shop_id")
      .eq("shop_id", auth.shopId);

    if (printerBelongsToShop(shopPrinters ?? [], reportedPrinterId, auth.shopId)) {
      printerId = reportedPrinterId;
    } else {
      console.error(
        `[agent-attempted] shop=${auth.shopId} job=${jobId} reported printer ${reportedPrinterId} does not belong to this shop; ignoring it`
      );
    }
  }

  // Update job state
  await supabase
    .from("print_jobs")
    .update({ state: "PRINT_ATTEMPTED" })
    .eq("id", jobId);

  // The attempt number is assigned here, not taken from the agent.
  //
  // The agent reports `attempt_number: 1` for every attempt it ever makes. On
  // a retry that collided with the `unique (print_job_id, attempt_number)`
  // constraint, the insert failed, the error was discarded, and the retry's
  // outcome was later written over the *previous* attempt's row — so a job
  // that failed and was retried successfully ended up with a single row
  // reading "confirmed" while still carrying the old failure's error text.
  // Counting server-side keeps one row per real attempt.
  const { count: priorAttempts } = await supabase
    .from("print_attempts")
    .select("id", { count: "exact", head: true })
    .eq("print_job_id", jobId);

  const nextAttempt = (priorAttempts ?? 0) + 1;

  const { error: attemptError } = await supabase.from("print_attempts").insert({
    print_job_id: jobId,
    agent_id: auth.agentId,
    attempt_number: nextAttempt,
    printer_id: printerId,
    result: "sent",
    error_message: null,
  });

  if (attemptError) {
    // The job has moved to PRINT_ATTEMPTED and the agent is printing, so this
    // is not fatal — but losing the record must not happen silently.
    console.error(
      `[agent-attempted] job=${jobId} could not record attempt ${nextAttempt}: ${attemptError.message}`
    );
  }

  // Update order status
  await supabase
    .from("orders")
    .update({
      print_status: "print_attempted",
      print_started_at: new Date().toISOString(),
    })
    .eq("id", job.order_id);

  return NextResponse.json({
    status: "ok",
    attemptNumber: nextAttempt,
    reportedAttempt,
    printerId,
  });
}

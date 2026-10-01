import { NextRequest, NextResponse } from "next/server";
import { authenticateAgent } from "../../../auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { KNOWN_PRINT_ERROR_CODES, PRINT_ERROR_LABELS } from "@/lib/printerHealth";

/**
 * Record the outcome against the attempt this report belongs to.
 *
 * PostgREST does not honour .order()/.limit() on an UPDATE, so the previous
 * form — update ... eq(print_job_id) .order() .limit(1) — rewrote EVERY
 * attempt row for the job, erasing the history of earlier tries. The latest
 * attempt is selected first and updated by its own id.
 */
async function recordAttemptOutcome(
  supabase: ReturnType<typeof createServiceRoleClient>,
  jobId: string,
  patch: { result: string; error_message?: string | null; error_code?: string | null }
): Promise<void> {
  const { data: latest } = await supabase
    .from("print_attempts")
    .select("id")
    .eq("print_job_id", jobId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) {
    console.error(`[agent-result] job=${jobId} has no attempt row to update`);
    return;
  }

  const { error } = await supabase.from("print_attempts").update(patch).eq("id", latest.id);
  if (error) {
    console.error(`[agent-result] job=${jobId} could not record outcome: ${error.message}`);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const auth = await authenticateAgent(req);
  if (!auth.ok) return auth.response;
  const { jobId } = await params;

  const body = await req.json().catch(() => null);
  if (!body || !body.result) {
    return NextResponse.json({ error: "Missing result." }, { status: 400 });
  }

  const result: string = body.result;
  const errorMessage: string = String(body.error_message ?? "").slice(0, 1000);
  // A machine-readable class of failure, so "out of paper" and "printer
  // offline" can be told apart on the dashboard. Unknown codes are dropped
  // rather than stored: the agent reports, it does not define vocabulary.
  const errorCode: string | null =
    typeof body.error_code === "string" && KNOWN_PRINT_ERROR_CODES.has(body.error_code)
      ? body.error_code
      : null;

  const supabase = createServiceRoleClient();

  // Verify job belongs to this agent and is in the right state
  const { data: job } = await supabase
    .from("print_jobs")
    .select("id, order_id, state")
    .eq("id", jobId)
    .eq("claimed_by_agent_id", auth.agentId)
    .single();

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (job.state !== "PRINT_ATTEMPTED" && job.state !== "PRINTING") {
    return NextResponse.json(
      { error: `Cannot report result from state ${job.state}.` },
      { status: 409 }
    );
  }

  if (result === "confirmed") {
    // Mark job as completed — only from the state just read, so a duplicate
    // report or an owner's decision in the meantime is not overwritten.
    const { data: moved } = await supabase
      .from("print_jobs")
      .update({ state: "COMPLETED" })
      .eq("id", jobId)
      .eq("state", job.state)
      .select("id");
    if (!moved || moved.length === 0) {
      return NextResponse.json({ error: "This job changed; result not applied." }, { status: 409 });
    }

    await supabase
      .from("orders")
      .update({
        print_status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.order_id)
      .eq("shop_id", auth.shopId);

    await recordAttemptOutcome(supabase, jobId, { result: "confirmed", error_message: null });

    // Remove from queue
    await supabase
      .from("queue_entries")
      .delete()
      .eq("order_id", job.order_id);

    return NextResponse.json({ status: "completed" });
  }

  if (result === "error") {
    const { data: moved } = await supabase
      .from("print_jobs")
      .update({ state: "FAILED" })
      .eq("id", jobId)
      .eq("state", job.state)
      .select("id");
    if (!moved || moved.length === 0) {
      return NextResponse.json({ error: "This job changed; result not applied." }, { status: 409 });
    }

    const label = errorCode ? PRINT_ERROR_LABELS[errorCode] : null;
    await supabase
      .from("orders")
      .update({
        print_status: "failed",
        failure_reason: label && !errorMessage.startsWith(label) ? `${label}. ${errorMessage}` : errorMessage,
      })
      .eq("id", job.order_id)
      .eq("shop_id", auth.shopId);

    await recordAttemptOutcome(supabase, jobId, {
      result: "error",
      error_message: errorMessage,
      error_code: errorCode,
    });

    return NextResponse.json({ status: "failed", error_message: errorMessage, error_code: errorCode });
  }

  return NextResponse.json({ error: "Unknown result value." }, { status: 400 });
}

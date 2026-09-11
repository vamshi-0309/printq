import { NextRequest, NextResponse } from "next/server";
import { requireShop } from "@/lib/shopAuth";
import { evaluateShopReadiness } from "@/lib/shopReadiness";
import { deriveOrderState } from "@/lib/orderStatus";
import type { JobState } from "@/lib/jobState";
import { availableActions } from "@/lib/orderActions";

/**
 * One order, in full, for the shop that owns it.
 *
 * Every lookup is scoped by shop_id as well as order id, so guessing another
 * shop's order UUID returns 404 rather than its contents.
 *
 * The file is described but never linked: only its name, type and size are
 * returned. A download needs a separate, deliberate request that mints a
 * short-lived signed URL. The customer's documents live in a private bucket
 * and no route in this app has ever handed out a raw storage URL.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, db } = auth.ctx;
  const { orderId } = await params;

  const { data: order, error } = await db
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not load the order." }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const now = new Date();
  const [fileRes, paymentRes, jobRes, queueRes, settingsRes, agentsRes, printersRes] =
    await Promise.all([
      db
        .from("order_files")
        .select("id, original_filename, mime_type, size_bytes, deleted_at, created_at, converted_storage_path")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true }),
      db
        .from("payments")
        .select("id, method, gateway, gateway_payment_id, amount, status, created_at, verified_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .maybeSingle(),
      db
        .from("print_jobs")
        .select("id, state, claimed_by_agent_id, claimed_at, created_at")
        .eq("order_id", orderId)
        .maybeSingle(),
      db.from("queue_entries").select("position, created_at").eq("order_id", orderId).maybeSingle(),
      db.from("shop_settings").select("heartbeat_timeout_seconds").eq("shop_id", shopId).maybeSingle(),
      db
        .from("print_agents")
        .select("id, hostname, version, last_heartbeat_at, created_at")
        .eq("shop_id", shopId),
      db.from("printers").select("id, is_enabled, is_default, last_status").eq("shop_id", shopId),
    ]);

  const readiness = evaluateShopReadiness({
    shopStatus: "active",
    heartbeatTimeoutSeconds: settingsRes.data?.heartbeat_timeout_seconds ?? null,
    agents: agentsRes.data ?? [],
    printers: printersRes.data ?? [],
    now,
  });

  const jobState = (jobRes.data?.state ?? null) as JobState | null;

  const state = deriveOrderState({
    paymentStatus: order.payment_status,
    printStatus: order.print_status,
    jobState,
    agentOnline: readiness.agentOnline,
    printerAvailable: readiness.printerAvailable,
    completedAt: order.completed_at,
    failureReason: order.failure_reason,
  });

  // Attempt history is the evidence behind any "printing"/"done" claim, so the
  // owner can see exactly what the agent reported and when.
  let attempts: unknown[] = [];
  if (jobRes.data?.id) {
    const { data } = await db
      .from("print_attempts")
      .select("attempt_number, attempted_at, result, error_message, printer_id")
      .eq("print_job_id", jobRes.data.id)
      .order("attempt_number", { ascending: true });
    attempts = data ?? [];
  }

  const file = fileRes.data?.[0] ?? null;

  return NextResponse.json({
    order: {
      id: order.id,
      publicOrderId: order.public_order_id,
      tokenNumber: order.token_number,
      tokenCounter: order.token_counter,
      amount: Number(order.amount ?? 0),
      priceBreakdown: order.price_breakdown,
      pageCount: order.page_count,
      copies: order.copies,
      pageRange: order.page_range,
      colorMode: order.color_mode,
      paperSize: order.paper_size,
      orientation: order.orientation,
      sides: order.sides,
      paymentStatus: order.payment_status,
      printStatus: order.print_status,
      createdAt: order.created_at,
      paidAt: order.paid_at,
      printStartedAt: order.print_started_at,
      completedAt: order.completed_at,
      failureReason: order.failure_reason,
      state,
    },
    file: file
      ? {
          id: file.id,
          filename: file.original_filename,
          mimeType: file.mime_type,
          sizeBytes: Number(file.size_bytes ?? 0),
          // Retention deletes the bytes; the row stays as a record.
          deletedAt: file.deleted_at,
          uploadedAt: file.created_at,
        }
      : null,
    payment: paymentRes.data
      ? {
          method: paymentRes.data.method,
          gateway: paymentRes.data.gateway,
          // The gateway's own reference, useful for reconciliation. Not a secret.
          reference: paymentRes.data.gateway_payment_id,
          amount: Number(paymentRes.data.amount ?? 0),
          status: paymentRes.data.status,
          createdAt: paymentRes.data.created_at,
          verifiedAt: paymentRes.data.verified_at,
        }
      : null,
    job: jobRes.data
      ? {
          id: jobRes.data.id,
          state: jobRes.data.state,
          claimedAt: jobRes.data.claimed_at,
          claimedByAgentId: jobRes.data.claimed_by_agent_id,
        }
      : null,
    queuePosition: queueRes.data?.position ?? null,
    attempts,
    actions: availableActions(jobState, order.payment_status),
    agentOnline: readiness.agentOnline,
    printerAvailable: readiness.printerAvailable,
    serverTime: now.toISOString(),
  });
}

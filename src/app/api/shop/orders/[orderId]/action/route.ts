import { NextRequest, NextResponse } from "next/server";
import { requireShop } from "@/lib/shopAuth";
import { markOrderPaidAndQueue } from "@/lib/orderPayment";
import { canTransition, type JobState } from "@/lib/jobState";
import { ACTION_TARGET, ORDER_STATUS_FOR } from "@/lib/orderActions";

/**
 * The shop owner resolving a job by hand.
 *
 * jobState.ts deliberately leaves no automatic path out of PRINT_ATTEMPTED:
 * a lost acknowledgement from the agent is an ambiguous outcome, and only a
 * person standing at the printer can say what actually came out. This route is
 * that person's input — it was the missing half of that design, which is why
 * a job that stalled had no way forward except editing the database.
 *
 * Three rules hold every action honest:
 *
 *   - the target state must be reachable from the current one, decided by
 *     canTransition(), never by the client naming a state;
 *   - the write is a compare-and-swap on the state we read, so a double-click
 *     or two staff members acting at once cannot apply a transition twice;
 *   - "paid" is never set here. Payment goes through markOrderPaidAndQueue,
 *     the same helper the Cashfree webhook uses, so tokens are issued in
 *     exactly one place.
 */

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, userId, db } = auth.ctx;
  const { orderId } = await params;

  let body: { action?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  const { data: order } = await db
    .from("orders")
    .select("id, shop_id, payment_status, print_status")
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Payment confirmation is not a job transition — it is the existing manual
  // UPI path, and it must keep using the one helper that assigns tokens.
  if (action === "confirm_payment") {
    const result = await markOrderPaidAndQueue(db, order.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    if (result.alreadyPaid) {
      return NextResponse.json(
        { error: "This order was already paid — nothing changed.", tokenNumber: result.tokenNumber },
        { status: 409 }
      );
    }

    await db.from("audit_logs").insert({
      actor_type: "shop_owner",
      actor_id: userId,
      shop_id: shopId,
      action: "order.payment_confirmed",
      target_table: "orders",
      target_id: order.id,
      metadata: { token_number: result.tokenNumber },
    });

    return NextResponse.json({
      ok: true,
      tokenNumber: result.tokenNumber,
      queuePosition: result.queuePosition,
    });
  }

  const target = ACTION_TARGET[action];
  if (!target) {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const { data: job } = await db
    .from("print_jobs")
    .select("id, state")
    .eq("order_id", orderId)
    .maybeSingle();

  if (!job) {
    return NextResponse.json(
      { error: "This order has no print job to act on." },
      { status: 409 }
    );
  }

  const from = job.state as JobState;
  if (!canTransition(from, target)) {
    return NextResponse.json(
      { error: `A job that is ${from.toLowerCase().replace(/_/g, " ")} cannot be moved to ${target.toLowerCase().replace(/_/g, " ")}.` },
      { status: 409 }
    );
  }

  // Compare-and-swap: only the caller that observed `from` may apply it.
  const { data: moved } = await db
    .from("print_jobs")
    .update({ state: target })
    .eq("id", job.id)
    .eq("state", from)
    .select("id");

  if (!moved || moved.length === 0) {
    return NextResponse.json(
      { error: "This job changed while you were looking at it. Reload and try again." },
      { status: 409 }
    );
  }

  const orderUpdate: Record<string, unknown> = { print_status: ORDER_STATUS_FOR[target] };
  if (target === "COMPLETED") {
    orderUpdate.completed_at = new Date().toISOString();
    // Recorded as the owner's word, not the agent's — the two are different
    // kinds of evidence and the detail view says which one this was.
    orderUpdate.failure_reason = null;
  }
  if (target === "FAILED") {
    orderUpdate.failure_reason = reason || "Marked as failed by the shop.";
  }
  if (target === "HELD" && reason) {
    orderUpdate.failure_reason = reason;
  }
  if (target === "QUEUED") {
    // Going back into the queue clears the previous explanation, so a stale
    // error message cannot linger next to a live job.
    orderUpdate.failure_reason = null;
  }

  await db.from("orders").update(orderUpdate).eq("id", orderId);

  // Keep queue_entries consistent with the agent's own behaviour: it removes
  // the entry when a job finishes, so finishing one by hand does the same.
  if (target === "COMPLETED" || target === "CANCELLED") {
    await db.from("queue_entries").delete().eq("order_id", orderId);
  }

  if (target === "QUEUED") {
    const { data: existing } = await db
      .from("queue_entries")
      .select("id")
      .eq("order_id", orderId)
      .maybeSingle();

    if (!existing) {
      const { count } = await db
        .from("queue_entries")
        .select("*", { count: "exact", head: true })
        .eq("shop_id", shopId);
      await db.from("queue_entries").insert({
        shop_id: shopId,
        order_id: orderId,
        position: (count ?? 0) + 1,
      });
    }
  }

  await db.from("audit_logs").insert({
    actor_type: "shop_owner",
    actor_id: userId,
    shop_id: shopId,
    action: `order.${action}`,
    target_table: "print_jobs",
    target_id: job.id,
    metadata: { from, to: target, reason: reason || null },
  });

  return NextResponse.json({ ok: true, from, to: target });
}

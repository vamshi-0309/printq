import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireShop } from "@/lib/shopAuth";
import { markOrderPaidAndQueue, settleBalance } from "@/lib/orderPayment";
import { canTransition, type JobState } from "@/lib/jobState";
import {
  ACTION_TARGET,
  ORDER_STATUS_FOR,
  availableActions,
  refundableAmount,
  viaStateFor,
} from "@/lib/orderActions";
import {
  cashfreeGateway,
  checkoutUrls,
  ensureCheckoutSession,
  issueRefund,
  loadPayments,
  moneyHeld,
  outstandingPayment,
  retirePendingCharges,
  rupees,
} from "@/lib/orderMoney";
import { editOrder } from "@/lib/orderEdit";
import { deleteOrderFiles } from "@/lib/jobMaintenance";
import { verifyStoredDocument } from "@/lib/orderDocument";
import { deleteFile, downloadFile, StorageObjectMissing } from "@/lib/storage";
import { MAX_COLOR_RANGES } from "@/lib/pageRange";

/**
 * The shop owner acting on one order.
 *
 * jobState.ts deliberately leaves no automatic path out of PRINT_ATTEMPTED:
 * a lost acknowledgement from the agent is an ambiguous outcome, and only a
 * person standing at the printer can say what actually came out. This route is
 * that person's input — it was the missing half of that design, which is why
 * a job that stalled had no way forward except editing the database.
 *
 * Rules that hold every action honest:
 *
 *   - the action must be one this order offers right now (availableActions —
 *     the same list the dashboard shows), and its target state must be
 *     reachable from the current one, decided by canTransition(), never by
 *     the client naming a state;
 *   - every write is a compare-and-swap on the state we read, so a double-click
 *     or two staff members acting at once cannot apply a transition twice;
 *   - "paid" is never set here directly. Payment goes through
 *     markOrderPaidAndQueue, the same helper the Cashfree webhook uses, so
 *     tokens are issued in exactly one place;
 *   - money only moves when the request carries the exact amount the owner
 *     was shown and confirmed (refunds), or after an explicit confirmation
 *     step (edits that lower a paid price).
 */

export const dynamic = "force-dynamic";

const editSchema = z
  .object({
    copies: z.number().int().min(1).max(500).optional(),
    colorMode: z.enum(["bw", "color"]).optional(),
    paperSize: z.enum(["A4", "A3"]).optional(),
    sides: z.enum(["single", "double"]).optional(),
    orientation: z.enum(["portrait", "landscape", "auto"]).optional(),
    pageRange: z.string().min(1).max(500).optional(),
    colorRanges: z
      .array(z.object({ range: z.string().min(1).max(200), mode: z.enum(["bw", "color"]) }))
      .max(MAX_COLOR_RANGES)
      .nullable()
      .optional(),
    fitMode: z.enum(["fit", "actual"]).optional(),
  })
  .strict();

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, userId, db } = auth.ctx;
  const { orderId } = await params;

  let body: { action?: unknown; reason?: unknown; changes?: unknown; confirmRefund?: unknown; amount?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  const { data: order } = await db
    .from("orders")
    .select("id, shop_id, public_order_id, token_number, payment_status, print_status, amount, print_started_at")
    .eq("id", orderId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const [{ data: job }, { data: settings }, { data: shop }, payments] = await Promise.all([
    db.from("print_jobs").select("id, state").eq("order_id", orderId).maybeSingle(),
    db.from("shop_settings").select("payment_gateway").eq("shop_id", shopId).maybeSingle(),
    db.from("shops").select("slug").eq("id", shopId).maybeSingle(),
    loadPayments(db, orderId),
  ]);

  const from = (job?.state ?? null) as JobState | null;
  const shopGateway: string | null = settings?.payment_gateway ?? null;
  const held = moneyHeld(payments);
  const refundable = refundableAmount(order.print_status, Number(order.amount ?? 0), held);

  // The same list the dashboard shows. Not offered → not allowed.
  const offered = availableActions(from, order.payment_status, {
    printStartedAt: order.print_started_at,
    now: new Date(),
    refundableAmount: refundable,
    gateway: shopGateway,
  }).map((a) => a.action);

  if (!offered.includes(action)) {
    if (!(action in ACTION_TARGET) && !["confirm_payment", "approve", "edit", "confirm_topup", "refund"].includes(action)) {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    const where = from ? from.toLowerCase().replace(/_/g, " ") : "in this state";
    return NextResponse.json(
      {
        error:
          from === "PRINT_ATTEMPTED" || from === "PRINTING"
            ? "Printing — this order can't be changed or cancelled now."
            : `That isn't available for an order that is ${where}.`,
      },
      { status: 409 }
    );
  }

  const gateway = cashfreeGateway();
  const urls = checkoutUrls(shop?.slug ?? "");

  const audit = (name: string, metadata: Record<string, unknown>, target = { table: "orders", id: order.id }) =>
    db.from("audit_logs").insert({
      actor_type: "shop_owner",
      actor_id: userId,
      shop_id: shopId,
      action: name,
      target_table: target.table,
      target_id: target.id,
      metadata,
    });

  /* ── Payment confirmation (existing counter path) ─────────────── */

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
    // The amount may have been edited; anything still owed becomes a top-up.
    await settleBalance(db, gateway, urls, order.id, shopGateway);

    await audit("order.payment_confirmed", { token_number: result.tokenNumber });

    return NextResponse.json({
      ok: true,
      tokenNumber: result.tokenNumber,
      queuePosition: result.queuePosition,
    });
  }

  /* ── Approval mode ────────────────────────────────────────────── */

  if (action === "approve") {
    const { data: moved } = await db
      .from("print_jobs")
      .update({ state: "CREATED" })
      .eq("id", job!.id)
      .eq("state", "PENDING_APPROVAL")
      .select("id");
    if (!moved || moved.length === 0) return changedUnderneath();

    await db
      .from("orders")
      .update({ print_status: "payment_pending" })
      .eq("id", order.id)
      .eq("print_status", "pending_approval");

    // A Cashfree shop's checkout is created now, at the approved price. If
    // Cashfree is unreachable the approval still stands; the customer's
    // "Pay now" retries the session.
    let paymentWarning: string | null = null;
    const current = outstandingPayment(payments);
    if (current && current.gateway === "cashfree") {
      const session = await ensureCheckoutSession(db, gateway, urls, current);
      if (!session.ok) paymentWarning = session.error;
    }

    await audit("order.approved", { amount: order.amount, payment_warning: paymentWarning });
    return NextResponse.json({ ok: true, to: "CREATED", paymentWarning });
  }

  if (action === "reject") {
    if (!reason) {
      return NextResponse.json({ error: "Tell the customer why — a reason is required." }, { status: 422 });
    }
    const { data: moved } = await db
      .from("print_jobs")
      .update({ state: "REJECTED" })
      .eq("id", job!.id)
      .eq("state", "PENDING_APPROVAL")
      .select("id");
    if (!moved || moved.length === 0) return changedUnderneath();

    await db
      .from("orders")
      .update({ print_status: "rejected", payment_status: "expired", failure_reason: reason })
      .eq("id", order.id);
    await retirePendingCharges(db, gateway, payments, "order");

    // The customer's document is not kept for an order that will never print.
    const deleted = await deleteOrderFiles(db, order.id, { removeObject: deleteFile });

    await audit("order.rejected", { reason, files_deleted: deleted });
    return NextResponse.json({ ok: true, to: "REJECTED", filesDeleted: deleted });
  }

  /* ── Editing ──────────────────────────────────────────────────── */

  if (action === "edit") {
    const parsed = editSchema.safeParse(body.changes ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: "Those changes aren't valid." }, { status: 400 });
    }
    const result = await editOrder(
      db,
      {
        gateway,
        urls,
        documentPages: async (storagePath) => {
          const facts = await verifyStoredDocument(
            shopId,
            storagePath,
            downloadFile,
            (err) => err instanceof StorageObjectMissing
          );
          return facts.ok ? facts.pageCount : null;
        },
      },
      {
        orderId: order.id,
        shopId,
        actorId: userId,
        changes: parsed.data,
        confirmRefund: body.confirmRefund === true,
      }
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code, refundAmount: result.refundAmount, amount: result.amount },
        { status: result.status }
      );
    }
    return NextResponse.json(result);
  }

  /* ── Money ────────────────────────────────────────────────────── */

  if (action === "confirm_topup") {
    const topup = payments.find((p) => p.status === "pending" && p.purpose === "topup");
    if (!topup) return NextResponse.json({ error: "No extra payment is waiting." }, { status: 409 });
    const { data: marked } = await db
      .from("payments")
      .update({ status: "paid", verified_at: new Date().toISOString() })
      .eq("id", topup.id)
      .eq("status", "pending")
      .select("id");
    if (!marked || marked.length === 0) return changedUnderneath();
    const settled = await settleBalance(db, gateway, urls, order.id, shopGateway);
    await audit("order.topup_confirmed", { amount: Number(topup.amount), job_state: settled.jobState });
    return NextResponse.json({ ok: true, to: settled.jobState });
  }

  if (action === "refund") {
    // The owner confirmed a specific amount. If it no longer matches what is
    // owed — another refund landed, a payment arrived — refuse rather than
    // send a different sum than they agreed to.
    const confirmed = Number(body.amount);
    if (!Number.isFinite(confirmed) || rupees(confirmed) !== refundable) {
      return NextResponse.json(
        { error: `The refund due is now ₹${refundable}. Reload and confirm again.`, refundAmount: refundable },
        { status: 409 }
      );
    }
    const result = await issueRefund(
      db,
      gateway,
      payments,
      refundable,
      `Refund for order ${order.public_order_id}`
    );
    await audit("order.refunded", {
      amount: refundable,
      ok: result.ok,
      error: result.ok ? null : result.error,
      refunds: result.ok ? result.refunds : [],
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ ok: true, refunded: refundable, refunds: result.refunds });
  }

  /* ── Job transitions ──────────────────────────────────────────── */

  const target = ACTION_TARGET[action];
  if (!target || !job || !from) {
    return NextResponse.json({ error: "This order has no print job to act on." }, { status: 409 });
  }

  // Anything that sends the job to the printer needs the document.
  if (target === "QUEUED") {
    const { data: file } = await db
      .from("order_files")
      .select("deleted_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!file || file.deleted_at) {
      return NextResponse.json(
        { error: "The customer's file has already been deleted, so this can't be printed again." },
        { status: 409 }
      );
    }
  }

  const via = viaStateFor(action, from);
  const path = via ? [from, via, target] : [from, target];
  for (let i = 0; i < path.length - 1; i++) {
    if (!canTransition(path[i], path[i + 1])) {
      return NextResponse.json(
        { error: `A job that is ${from.toLowerCase().replace(/_/g, " ")} cannot be moved to ${target.toLowerCase().replace(/_/g, " ")}.` },
        { status: 409 }
      );
    }
  }

  // Compare-and-swap at each step: only the caller that observed `from` may
  // apply it. Retrying an uncertain print passes through HELD — the human
  // checkpoint the state machine requires — in one click.
  for (let i = 0; i < path.length - 1; i++) {
    const patch: Record<string, unknown> = { state: path[i + 1] };
    if (path[i + 1] === "QUEUED") {
      patch.claimed_by_agent_id = null;
      patch.claimed_at = null;
    }
    const { data: moved } = await db
      .from("print_jobs")
      .update(patch)
      .eq("id", job.id)
      .eq("state", path[i])
      .select("id");
    if (!moved || moved.length === 0) return changedUnderneath();
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
  if (target === "HELD") {
    orderUpdate.failure_reason = reason || (action === "mark_problem" ? "Marked as a problem by the shop." : null);
  }
  if (target === "QUEUED") {
    // Going back into the queue clears the previous explanation, so a stale
    // error message cannot linger next to a live job.
    orderUpdate.failure_reason = null;
    if (action === "reprint") {
      orderUpdate.completed_at = null;
      orderUpdate.print_started_at = null;
    }
  }

  await db.from("orders").update(orderUpdate).eq("id", orderId);

  if (target === "CANCELLED") {
    // Nothing left open for the customer to pay into.
    await retirePendingCharges(db, gateway, payments, "order");
    await retirePendingCharges(db, gateway, payments, "topup");
  }

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

  await audit(
    `order.${action}`,
    {
      from,
      via,
      to: target,
      reason: reason || null,
      // On a paid cancel, what the owner was told they must refund.
      paid_amount: target === "CANCELLED" ? held : undefined,
    },
    { table: "print_jobs", id: job.id }
  );

  return NextResponse.json({ ok: true, from, to: target });
}

function changedUnderneath() {
  return NextResponse.json(
    { error: "This order changed while you were looking at it. Reload and try again." },
    { status: 409 }
  );
}

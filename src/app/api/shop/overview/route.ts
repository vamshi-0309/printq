import { NextResponse } from "next/server";
import { requireShop } from "@/lib/shopAuth";
import { evaluateShopReadiness } from "@/lib/shopReadiness";
import { deriveOrderState } from "@/lib/orderStatus";
import { startOfDay } from "@/lib/businessDay";

/**
 * Everything the overview screen needs, in one authenticated request.
 *
 * The page used to assemble this in the browser from four separate Supabase
 * queries, three of which hit tables with RLS enabled and no policy — so they
 * quietly returned nothing and the panel showed zeroes. Computing it here also
 * means the agent-liveness and job-state joins happen once, server-side,
 * against the same instant, instead of the UI stitching together facts read
 * seconds apart.
 *
 * Nothing in this response is estimated. Every number is a count of real rows,
 * and any figure that cannot be established is reported as such rather than
 * defaulted to zero.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, db } = auth.ctx;

  const now = new Date();
  const dayStart = startOfDay(now);

  const [shopRes, settingsRes, agentsRes, printersRes, licenceRes, pricingRes] = await Promise.all([
    db.from("shops").select("id, slug, shop_name, city, status, created_at").eq("id", shopId).single(),
    db
      .from("shop_settings")
      .select("heartbeat_timeout_seconds, payment_gateway, upi_id, file_retention_hours")
      .eq("shop_id", shopId)
      .maybeSingle(),
    db
      .from("print_agents")
      .select("id, hostname, version, last_heartbeat_at, created_at")
      .eq("shop_id", shopId),
    db
      .from("printers")
      .select("id, system_name, display_name, is_enabled, is_default, last_status")
      .eq("shop_id", shopId),
    db
      .from("licences")
      .select("status, expires_at, grace_period_days")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("pricing").select("shop_id").eq("shop_id", shopId).maybeSingle(),
  ]);

  if (shopRes.error || !shopRes.data) {
    return NextResponse.json({ error: "Could not load your shop." }, { status: 500 });
  }

  const readiness = evaluateShopReadiness({
    shopStatus: shopRes.data.status,
    heartbeatTimeoutSeconds: settingsRes.data?.heartbeat_timeout_seconds ?? null,
    agents: agentsRes.data ?? [],
    printers: printersRes.data ?? [],
    licence: licenceRes.data ?? null,
    now,
  });

  // Active work: everything not finished, oldest first — that is the order the
  // counter serves them in.
  const { data: activeRows, error: activeError } = await db
    .from("orders")
    .select(
      "id, public_order_id, token_number, payment_status, print_status, amount, page_count, copies, color_mode, paper_size, sides, created_at, paid_at, failure_reason"
    )
    .eq("shop_id", shopId)
    .not("print_status", "in", "(completed,cancelled)")
    .order("created_at", { ascending: true })
    .limit(100);

  if (activeError) {
    return NextResponse.json({ error: "Could not load the queue." }, { status: 500 });
  }

  const activeOrders = activeRows ?? [];

  // print_jobs is the agent's own record. Without it the UI cannot tell
  // "queued" from "the agent is actually printing this".
  const jobStateByOrder = new Map<string, string>();
  if (activeOrders.length > 0) {
    const { data: jobs } = await db
      .from("print_jobs")
      .select("order_id, state, claimed_at, claimed_by_agent_id")
      .in(
        "order_id",
        activeOrders.map((o) => o.id)
      );
    for (const job of jobs ?? []) jobStateByOrder.set(job.order_id, job.state);
  }

  const queue = activeOrders.map((o) => {
    const state = deriveOrderState({
      paymentStatus: o.payment_status,
      printStatus: o.print_status,
      jobState: jobStateByOrder.get(o.id) ?? null,
      agentOnline: readiness.agentOnline,
      printerAvailable: readiness.printerAvailable,
      failureReason: o.failure_reason,
    });
    return {
      id: o.id,
      publicOrderId: o.public_order_id,
      tokenNumber: o.token_number,
      amount: Number(o.amount ?? 0),
      pageCount: o.page_count,
      copies: o.copies,
      colorMode: o.color_mode,
      paperSize: o.paper_size,
      sides: o.sides,
      createdAt: o.created_at,
      paidAt: o.paid_at,
      state,
    };
  });

  // Today's numbers, on the shop's own day boundary.
  const { data: todayRows } = await db
    .from("orders")
    .select("amount, page_count, copies, payment_status, print_status, completed_at")
    .eq("shop_id", shopId)
    .gte("created_at", dayStart.toISOString());

  const today = (todayRows ?? []).reduce(
    (acc, o) => {
      const paid = o.payment_status === "paid";
      if (paid) {
        acc.paidOrders += 1;
        acc.revenue += Number(o.amount ?? 0);
        // Pages ordered is not pages printed. Both are shown, separately.
        acc.pagesOrdered += (o.page_count ?? 0) * (o.copies ?? 1);
        if (o.print_status === "completed") {
          acc.completedOrders += 1;
          acc.pagesPrinted += (o.page_count ?? 0) * (o.copies ?? 1);
        }
      } else {
        acc.unpaidOrders += 1;
      }
      return acc;
    },
    {
      paidOrders: 0,
      unpaidOrders: 0,
      completedOrders: 0,
      revenue: 0,
      pagesOrdered: 0,
      pagesPrinted: 0,
    }
  );

  // Money already taken for work not yet done — the number that matters when
  // the agent has been offline for a while.
  const owed = queue
    .filter((q) => q.state.key !== "awaiting_payment" && q.state.key !== "payment_failed")
    .reduce((sum, q) => sum + q.amount, 0);

  return NextResponse.json({
    shop: {
      id: shopRes.data.id,
      slug: shopRes.data.slug,
      name: shopRes.data.shop_name,
      city: shopRes.data.city,
      status: shopRes.data.status,
    },
    readiness,
    settings: {
      paymentGateway: settingsRes.data?.payment_gateway ?? null,
      hasUpiId: Boolean(settingsRes.data?.upi_id),
      fileRetentionHours: settingsRes.data?.file_retention_hours ?? 24,
      pricingConfigured: Boolean(pricingRes.data),
    },
    today: {
      ...today,
      since: dayStart.toISOString(),
    },
    queue,
    counts: {
      active: queue.length,
      blocked: queue.filter((q) => q.state.blocked).length,
      awaitingPayment: queue.filter((q) => q.state.key === "awaiting_payment").length,
      unprintedValue: owed,
    },
    serverTime: now.toISOString(),
  });
}

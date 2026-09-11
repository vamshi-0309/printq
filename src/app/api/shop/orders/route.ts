import { NextRequest, NextResponse } from "next/server";
import { requireShop } from "@/lib/shopAuth";
import { evaluateShopReadiness } from "@/lib/shopReadiness";
import { deriveOrderState, matchesFilter, ORDER_FILTERS } from "@/lib/orderStatus";

/**
 * The shop's order history, filtered and paged.
 *
 * Read server-side rather than from the browser so the list can join
 * print_jobs — the table that says whether an agent has actually touched a
 * job. `print_jobs` has RLS enabled with no policy, so the browser cannot see
 * it at all, which is why the old page could only ever show the order's own
 * optimistic print_status.
 *
 * Filters are applied twice on purpose: a coarse predicate in SQL so the page
 * is not fetched only to be discarded, then the exact derived-state match in
 * JS. The derived state depends on live agent status, which no SQL predicate
 * can express.
 */

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Raw-column narrowing per filter, guaranteed never to exclude a row that the
 * exact derived-state match would have kept. `null` means no narrowing.
 */
const COARSE_PRINT_STATUS: Record<string, string[] | null> = {
  in_queue: ["paid", "queued", "claimed"],
  printing: ["print_attempted", "printing"],
  completed: ["completed"],
  // Everything that could derive to blocked; narrowed exactly in JS below.
  needs_attention: ["paid", "queued", "failed", "held"],
};

export async function GET(req: NextRequest) {
  const auth = await requireShop();
  if (!auth.ok) return auth.response;
  const { shopId, db } = auth.ctx;

  const params = req.nextUrl.searchParams;
  const filter = params.get("filter") ?? "all";
  const search = (params.get("q") ?? "").trim();
  const before = params.get("before");
  const limit = Math.min(
    Math.max(Number.parseInt(params.get("limit") ?? "", 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  if (!(filter in ORDER_FILTERS)) {
    return NextResponse.json({ error: "Unknown filter." }, { status: 400 });
  }

  // Liveness first: the same instant is used for every row's derived state.
  const now = new Date();
  const [settingsRes, agentsRes, printersRes] = await Promise.all([
    db.from("shop_settings").select("heartbeat_timeout_seconds").eq("shop_id", shopId).maybeSingle(),
    db.from("print_agents").select("id, hostname, version, last_heartbeat_at, created_at").eq("shop_id", shopId),
    db.from("printers").select("id, is_enabled, is_default, last_status").eq("shop_id", shopId),
  ]);

  const readiness = evaluateShopReadiness({
    shopStatus: "active", // Order display does not depend on shop status.
    heartbeatTimeoutSeconds: settingsRes.data?.heartbeat_timeout_seconds ?? null,
    agents: agentsRes.data ?? [],
    printers: printersRes.data ?? [],
    now,
  });

  let query = db
    .from("orders")
    .select(
      "id, public_order_id, token_number, payment_status, print_status, amount, page_count, copies, color_mode, paper_size, sides, page_range, created_at, paid_at, completed_at, failure_reason"
    )
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const coarse = COARSE_PRINT_STATUS[filter];
  if (coarse) {
    query = query.in("print_status", coarse);
  } else if (filter === "awaiting_payment") {
    query = query.eq("payment_status", "pending");
  } else if (filter === "closed") {
    query = query.or("print_status.in.(failed,cancelled),payment_status.in.(failed,expired)");
  }

  if (before) {
    query = query.lt("created_at", before);
  }

  if (search) {
    // Order id and token are the two things written on the customer's slip.
    const escaped = search.replace(/[%,()]/g, "");
    if (escaped) {
      query = query.or(
        `public_order_id.ilike.%${escaped}%,token_number.ilike.%${escaped}%`
      );
    }
  }

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Could not load orders." }, { status: 500 });
  }

  const orders = rows ?? [];

  const jobStateByOrder = new Map<string, string>();
  if (orders.length > 0) {
    const { data: jobs } = await db
      .from("print_jobs")
      .select("order_id, state")
      .in(
        "order_id",
        orders.map((o) => o.id)
      );
    for (const job of jobs ?? []) jobStateByOrder.set(job.order_id, job.state);
  }

  const mapped = orders
    .map((o) => ({
      id: o.id,
      publicOrderId: o.public_order_id,
      tokenNumber: o.token_number,
      amount: Number(o.amount ?? 0),
      pageCount: o.page_count,
      copies: o.copies,
      colorMode: o.color_mode,
      paperSize: o.paper_size,
      sides: o.sides,
      pageRange: o.page_range,
      createdAt: o.created_at,
      paidAt: o.paid_at,
      completedAt: o.completed_at,
      state: deriveOrderState({
        paymentStatus: o.payment_status,
        printStatus: o.print_status,
        jobState: jobStateByOrder.get(o.id) ?? null,
        agentOnline: readiness.agentOnline,
        printerAvailable: readiness.printerAvailable,
        completedAt: o.completed_at,
        failureReason: o.failure_reason,
      }),
    }))
    .filter((o) => matchesFilter(filter, o.state.key));

  return NextResponse.json({
    orders: mapped,
    // Cursor comes from the SQL page, not the filtered result: paging must
    // continue from where the query stopped, not where the display did.
    nextCursor: orders.length === limit ? orders[orders.length - 1].created_at : null,
    agentOnline: readiness.agentOnline,
    printerAvailable: readiness.printerAvailable,
    serverTime: now.toISOString(),
  });
}

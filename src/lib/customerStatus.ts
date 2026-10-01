import type { SupabaseClient } from "@supabase/supabase-js";
import { moneyHeld, outstandingPayment, rupees, type PaymentRow } from "./orderMoney";

/**
 * What a customer's phone is told about their order.
 *
 * WHAT IS NEVER SENT
 * Anything about another customer except one thing: the token currently at
 * the printer ("Currently printing: A043"), which is already called out
 * across the counter. No other order's id, file, amount, page count or
 * settings, and nothing that identifies the shop's internals (agent, printer,
 * storage path, session token). The response is built field by field below,
 * never by spreading a row, and the test in customerStatus.test.ts fails if a
 * field is added without being listed there.
 *
 * QUEUE POSITION
 * Counted live from print_jobs in the same order the claim route serves them
 * (oldest job first), among jobs actually waiting or printing. The old value
 * came from queue_entries.position, a counter that only ever went up — the
 * hundredth order of the day was told "position 100" in an empty shop.
 */

/** Jobs that are ahead of someone in the line. */
export const ACTIVE_JOB_STATES = ["QUEUED", "CLAIMED", "PRINT_ATTEMPTED", "PRINTING"];

/** Rough throughput for the wait estimate: pages per minute, plus per-job handling. */
export const ESTIMATE_PAGES_PER_MINUTE = 20;
export const ESTIMATE_MINUTES_PER_JOB = 0.5;

/** How long a finished order's status stays viewable. */
export const STATUS_VISIBLE_AFTER_FINISH_HOURS = 24;

const TERMINAL_PRINT_STATUSES = new Set(["completed", "cancelled", "rejected"]);

export interface QueueSnapshot {
  /** 1 = next to print. Null when this order is not in the line. */
  position: number | null;
  /** Token of the job at the printer now, or null. Nothing else about it. */
  currentlyPrinting: string | null;
  estimatedWaitMinutes: number | null;
}

interface ActiveJob {
  id: string;
  order_id: string;
  state: string;
  created_at: string;
  orders: { shop_id: string; token_number: string | null; page_count: number | null; copies: number | null };
}

export async function queueSnapshot(
  db: SupabaseClient,
  shopId: string,
  orderId: string
): Promise<QueueSnapshot> {
  const { data, error } = await db
    .from("print_jobs")
    .select("id, order_id, state, created_at, orders!inner(shop_id, token_number, page_count, copies)")
    .in("state", ACTIVE_JOB_STATES)
    .eq("orders.shop_id", shopId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error || !data) return { position: null, currentlyPrinting: null, estimatedWaitMinutes: null };
  const jobs = data as unknown as ActiveJob[];

  const printing =
    [...jobs].reverse().find((j) => j.state === "PRINT_ATTEMPTED" || j.state === "PRINTING") ??
    jobs.find((j) => j.state === "CLAIMED") ??
    null;

  const index = jobs.findIndex((j) => j.order_id === orderId);
  if (index === -1) {
    return { position: null, currentlyPrinting: printing?.orders.token_number ?? null, estimatedWaitMinutes: null };
  }

  const ahead = jobs.slice(0, index);
  const sheetsAhead = ahead.reduce((n, j) => n + (j.orders.page_count ?? 1) * (j.orders.copies ?? 1), 0);
  const estimate = Math.ceil(
    sheetsAhead / ESTIMATE_PAGES_PER_MINUTE + ahead.length * ESTIMATE_MINUTES_PER_JOB
  );

  return {
    position: index + 1,
    currentlyPrinting: printing && printing.order_id !== orderId ? printing.orders.token_number : null,
    estimatedWaitMinutes: ahead.length === 0 ? 0 : Math.max(1, estimate),
  };
}

export interface StatusOrderRow {
  id: string;
  public_order_id: string;
  shop_id: string;
  token_number: string | null;
  payment_status: string;
  print_status: string;
  amount: number | string | null;
  copies: number;
  color_mode: string;
  paper_size: string;
  sides: string;
  orientation: string | null;
  page_count: number | null;
  page_range: string | null;
  color_ranges: unknown;
  fit_mode: string | null;
  created_at: string;
  paid_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
}

export interface CustomerPaymentPrompt {
  kind: "order" | "topup";
  amount: number;
  gateway: "cashfree" | null;
  /** Cashfree checkout session, when one exists. */
  paymentSessionId: string | null;
}

/** Whether this link should now just say "expired". */
export function isStatusExpired(
  order: Pick<StatusOrderRow, "print_status" | "payment_status" | "completed_at" | "created_at">,
  fileDeleted: boolean,
  now: Date
): boolean {
  const finished = TERMINAL_PRINT_STATUSES.has(order.print_status) || order.payment_status === "expired";
  const active = !finished && order.payment_status === "paid";
  // Retention removed the file of an order that wasn't going to print. Not
  // for a rejection: its file is deleted at once, on purpose, and the
  // customer still needs to read the shop's reason.
  if (fileDeleted && !active && order.print_status !== "rejected") return true;
  if (!finished) return false;
  const endedAt = Date.parse(order.completed_at ?? order.created_at);
  return now.getTime() - endedAt > STATUS_VISIBLE_AFTER_FINISH_HOURS * 3600 * 1000;
}

/**
 * The complete status response. Every field is named here; nothing is copied
 * wholesale from a row.
 */
export function buildCustomerStatus(input: {
  order: StatusOrderRow;
  shopName: string | null;
  queue: QueueSnapshot;
  payments: PaymentRow[];
  shopGateway: string | null;
  upiLink: string | null;
}) {
  const { order, queue, payments } = input;
  const amount = rupees(Number(order.amount ?? 0));
  const held = moneyHeld(payments);

  let pay: CustomerPaymentPrompt | null = null;
  const awaitingApproval = order.print_status === "pending_approval";
  const stopped = order.print_status === "cancelled" || order.print_status === "rejected";
  if (!awaitingApproval && !stopped) {
    const outstanding = outstandingPayment(payments);
    const owed = rupees(amount - held);
    if (outstanding && owed > 0) {
      pay = {
        kind: outstanding.purpose === "topup" ? "topup" : "order",
        amount: rupees(Number(outstanding.amount)),
        gateway: outstanding.gateway === "cashfree" ? "cashfree" : null,
        paymentSessionId: outstanding.payment_session_id,
      };
    }
  }

  const inLine = ["queued", "claimed", "print_attempted", "printing", "paid"].includes(order.print_status);

  return {
    orderId: order.public_order_id,
    shopName: input.shopName,
    tokenNumber: order.token_number,
    paymentStatus: order.payment_status,
    printStatus: order.print_status,
    amount,
    amountPaid: held,
    copies: order.copies,
    colorMode: order.color_mode,
    colorRanges: Array.isArray(order.color_ranges) ? order.color_ranges : null,
    paperSize: order.paper_size,
    sides: order.sides,
    orientation: order.orientation ?? "auto",
    fitMode: order.fit_mode ?? "fit",
    pageCount: order.page_count,
    pageRange: order.page_range,
    queuePosition: inLine ? queue.position : null,
    currentlyPrinting: inLine ? queue.currentlyPrinting : null,
    estimatedWaitMinutes: inLine ? queue.estimatedWaitMinutes : null,
    payment: pay,
    // For a counter-paid shop: a UPI link for exactly what is owed now.
    upiLink: pay && !pay.gateway ? input.upiLink : null,
    rejectionReason: order.print_status === "rejected" ? order.failure_reason : null,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    completedAt: order.completed_at,
    failureReason: order.print_status === "rejected" ? null : order.failure_reason,
  };
}

export type CustomerStatus = ReturnType<typeof buildCustomerStatus>;

/** Every key a customer may ever receive. Asserted by the leakage test. */
export const CUSTOMER_STATUS_KEYS = [
  "orderId",
  "shopName",
  "tokenNumber",
  "paymentStatus",
  "printStatus",
  "amount",
  "amountPaid",
  "copies",
  "colorMode",
  "colorRanges",
  "paperSize",
  "sides",
  "orientation",
  "fitMode",
  "pageCount",
  "pageRange",
  "queuePosition",
  "currentlyPrinting",
  "estimatedWaitMinutes",
  "payment",
  "upiLink",
  "rejectionReason",
  "createdAt",
  "paidAt",
  "completedAt",
  "failureReason",
] as const;

export function upiLinkFor(upiId: string | null | undefined, shopName: string, amount: number, note: string): string | null {
  if (!upiId) return null;
  return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(shopName)}&am=${amount}&tn=${encodeURIComponent(note)}`;
}

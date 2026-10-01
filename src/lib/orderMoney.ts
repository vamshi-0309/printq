import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createCashfreeOrder,
  getCashfreeConfig,
  refundCashfreeOrder,
  refundIdFor,
  terminateCashfreeOrder,
  type CreateOrderInput,
  type CreateOrderResult,
  type RefundInput,
  type RefundResult,
} from "./cashfree";

/**
 * The money side of an order: what has been paid, what is still owed, and
 * what has been given back.
 *
 * ONE PAYMENTS ROW PER CASHFREE ORDER
 * A Cashfree order's amount cannot change once created, so every new amount
 * is a new Cashfree order with its own payments row, identified by the exact
 * id we sent (payments.cashfree_order_id):
 *
 *   original   <order uuid>          created with the order (or on approval)
 *   re-issue   <order uuid>-r<n>     an unpaid order whose price was edited
 *   top-up     <order uuid>-t<n>     a paid order whose price was raised
 *
 * A superseded row is marked `expired` and its Cashfree order terminated, best
 * effort. If the customer manages to pay it anyway, the webhook still finds
 * the row by its id and the money is counted — see moneyHeld — so nothing
 * paid is ever lost track of; at worst the owner sees a refund is due.
 *
 * The balance is always derived from the rows, never stored: an order is
 * fully paid when moneyHeld(rows) >= orders.amount.
 */

export interface PaymentRow {
  id: string;
  order_id: string;
  purpose: string | null;
  status: string;
  amount: number | string;
  method: string;
  gateway: string | null;
  cashfree_order_id: string | null;
  payment_session_id: string | null;
  refund_status: string | null;
  refund_amount: number | string | null;
  refund_id?: string | null;
  created_at: string;
}

export const PAYMENT_COLUMNS =
  "id, order_id, purpose, status, amount, method, gateway, cashfree_order_id, payment_session_id, refund_status, refund_amount, refund_id, created_at";

const num = (v: unknown) => (v == null ? 0 : Number(v));

/** Rupees, rounded to paise so float noise never decides a comparison. */
export function rupees(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Money we hold for this order: everything captured, less every refund that
 * is under way or done. A failed refund means the money is still with us.
 */
export function moneyHeld(rows: PaymentRow[]): number {
  let total = 0;
  for (const r of rows) {
    if (r.status === "paid" || r.status === "refunded") total += num(r.amount);
    if (r.refund_status === "pending" || r.refund_status === "succeeded") total -= num(r.refund_amount);
  }
  return rupees(total);
}

/** The payment the customer should be paying right now, if any. */
export function outstandingPayment(rows: PaymentRow[]): PaymentRow | null {
  const pending = rows
    .filter((r) => r.status === "pending")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return pending[0] ?? null;
}

/** The Cashfree order id for the next row of a kind. */
export function nextCashfreeOrderId(
  orderId: string,
  rows: PaymentRow[],
  kind: "reissue" | "topup"
): string {
  const prefix = `${orderId}-${kind === "topup" ? "t" : "r"}`;
  const used = rows
    .map((r) => r.cashfree_order_id ?? "")
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number.parseInt(id.slice(prefix.length), 10))
    .filter(Number.isFinite);
  const n = used.length === 0 ? (kind === "reissue" ? 2 : 1) : Math.max(...used) + 1;
  return `${prefix}${n}`;
}

/* ── The gateway, injectable for tests ───────────────────────────── */

export interface GatewayClient {
  createOrder(input: CreateOrderInput): Promise<CreateOrderResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  terminate(cashfreeOrderId: string): Promise<boolean>;
}

/** The real Cashfree client, or null when the server has no credentials. */
export function cashfreeGateway(): GatewayClient | null {
  const config = getCashfreeConfig();
  if (!config) return null;
  return {
    createOrder: (input) => createCashfreeOrder(input, config),
    refund: (input) => refundCashfreeOrder(input, config),
    terminate: (id) => terminateCashfreeOrder(id, config),
  };
}

/** Where Cashfree sends the customer back to, and where it posts webhooks. */
export interface CheckoutUrls {
  returnUrl: string;
  notifyUrl: string;
}

export function checkoutUrls(shopSlug: string): CheckoutUrls {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  return {
    returnUrl: `${appUrl}/p/${shopSlug}?cf_return=1`,
    notifyUrl: `${appUrl}/api/payments/cashfree/webhook`,
  };
}

const placeholderPhone = () => process.env.CASHFREE_PLACEHOLDER_PHONE?.trim() || "9999999999";

export async function loadPayments(db: SupabaseClient, orderId: string): Promise<PaymentRow[]> {
  const { data, error } = await db
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read payments: ${error.message}`);
  return (data ?? []) as PaymentRow[];
}

export type SessionResult =
  | { ok: true; paymentId: string; paymentSessionId: string | null; amount: number }
  | { ok: false; paymentId: string | null; error: string };

/**
 * Give a pending payments row a Cashfree checkout session if it needs one.
 *
 * Used when an approval-mode order is approved, and when a customer taps
 * "Pay now" on an order whose session was never created (Cashfree was
 * unreachable when the order was placed). A row that already has a session
 * is returned as it is: this never creates a second Cashfree order for the
 * same row.
 */
export async function ensureCheckoutSession(
  db: SupabaseClient,
  gateway: GatewayClient | null,
  urls: CheckoutUrls,
  row: PaymentRow
): Promise<SessionResult> {
  const amount = rupees(num(row.amount));
  if (row.payment_session_id || row.gateway !== "cashfree") {
    return { ok: true, paymentId: row.id, paymentSessionId: row.payment_session_id, amount };
  }
  if (!gateway) {
    return { ok: false, paymentId: row.id, error: "Online payments aren't configured on this server." };
  }

  const cashfreeOrderId = row.cashfree_order_id ?? row.order_id;
  try {
    const cf = await gateway.createOrder({
      orderUuid: row.order_id,
      cashfreeOrderId,
      amount,
      customerPhone: placeholderPhone(),
      returnUrl: urls.returnUrl,
      notifyUrl: urls.notifyUrl,
    });
    await db
      .from("payments")
      .update({
        cashfree_order_id: cashfreeOrderId,
        gateway_order_id: cf.cfOrderId || null,
        payment_session_id: cf.paymentSessionId,
      })
      .eq("id", row.id)
      .eq("status", "pending");
    return { ok: true, paymentId: row.id, paymentSessionId: cf.paymentSessionId, amount };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not start the payment.";
    console.error(`[payments] session for ${cashfreeOrderId} failed: ${message}`);
    return { ok: false, paymentId: row.id, error: message };
  }
}

/**
 * Open a new charge on an order: a re-issued main payment, or a top-up.
 *
 * `shopGateway` is the shop's chosen rail. A counter-paid shop gets a
 * payments row with no Cashfree order; the owner confirms it by hand.
 */
export async function openCharge(
  db: SupabaseClient,
  gateway: GatewayClient | null,
  urls: CheckoutUrls,
  opts: {
    orderId: string;
    amount: number;
    kind: "reissue" | "topup";
    shopGateway: string | null;
    existing: PaymentRow[];
  }
): Promise<SessionResult> {
  const viaCashfree = opts.shopGateway === "cashfree";
  const row = {
    order_id: opts.orderId,
    purpose: opts.kind === "topup" ? "topup" : "order",
    method: viaCashfree ? "gateway" : "upi_intent",
    gateway: viaCashfree ? "cashfree" : null,
    amount: rupees(opts.amount),
    status: "pending",
    cashfree_order_id: viaCashfree ? nextCashfreeOrderId(opts.orderId, opts.existing, opts.kind) : null,
  };

  const { data: inserted, error } = await db.from("payments").insert(row).select(PAYMENT_COLUMNS).single();
  if (error || !inserted) {
    return { ok: false, paymentId: null, error: "Could not record the new charge." };
  }
  return ensureCheckoutSession(db, gateway, urls, inserted as PaymentRow);
}

/**
 * Retire pending charges that no longer match the order: mark them expired
 * and stop their Cashfree orders being paid. Returns how many were retired.
 */
export async function retirePendingCharges(
  db: SupabaseClient,
  gateway: GatewayClient | null,
  rows: PaymentRow[],
  purpose: "order" | "topup"
): Promise<number> {
  let retired = 0;
  for (const r of rows) {
    if (r.status !== "pending" || (r.purpose ?? "order") !== purpose) continue;
    const { data } = await db
      .from("payments")
      .update({ status: "expired" })
      .eq("id", r.id)
      .eq("status", "pending")
      .select("id");
    if (!data || data.length === 0) continue; // paid in the meantime: keep it
    retired += 1;
    if (r.cashfree_order_id && r.payment_session_id && gateway) {
      await gateway.terminate(r.cashfree_order_id);
    }
  }
  return retired;
}

export type RefundOutcome =
  | { ok: true; amount: number; refunds: { paymentId: string; refundId: string | null; status: string }[] }
  | { ok: false; error: string };

/**
 * Give `amount` back to the customer.
 *
 * Gateway money goes back through Cashfree, taken from the most recent paid
 * rows first. Money paid at the counter cannot be moved by PrintQ, so it is
 * recorded as refunded on the owner's word — the owner has just confirmed
 * they paid it back themselves. Never called without that confirmation.
 */
export async function issueRefund(
  db: SupabaseClient,
  gateway: GatewayClient | null,
  rows: PaymentRow[],
  amount: number,
  note: string
): Promise<RefundOutcome> {
  let remaining = rupees(amount);
  if (!(remaining > 0)) return { ok: false, error: "Nothing to refund." };
  if (remaining > moneyHeld(rows)) {
    return { ok: false, error: "That is more than the customer has paid." };
  }

  const refunds: { paymentId: string; refundId: string | null; status: string }[] = [];
  const paid = rows
    .filter((r) => r.status === "paid")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  for (const r of paid) {
    if (remaining <= 0) break;
    const alreadyBack =
      r.refund_status === "pending" || r.refund_status === "succeeded" ? num(r.refund_amount) : 0;
    const available = rupees(num(r.amount) - alreadyBack);
    if (available <= 0) continue;
    const take = rupees(Math.min(available, remaining));
    const newTotal = rupees(alreadyBack + take);

    if (r.gateway === "cashfree" && r.cashfree_order_id) {
      if (!gateway) return { ok: false, error: "Online refunds aren't configured on this server." };
      const priorRefunds = r.refund_id ? Number.parseInt(r.refund_id.split("rf").pop() ?? "0", 10) || 0 : 0;
      const refundId = refundIdFor(r.cashfree_order_id, priorRefunds + 1);
      try {
        const result = await gateway.refund({
          cashfreeOrderId: r.cashfree_order_id,
          refundId,
          amount: take,
          note,
        });
        const status = result.status === "SUCCESS" ? "succeeded" : "pending";
        await db
          .from("payments")
          .update({
            refund_status: status,
            refund_amount: newTotal,
            refund_id: refundId,
            refunded_at: status === "succeeded" ? new Date().toISOString() : null,
          })
          .eq("id", r.id);
        refunds.push({ paymentId: r.id, refundId, status });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Refund failed.";
        // Nothing was recorded for this row, so the balance still says the
        // money is held — the owner can try again.
        return { ok: false, error: `Cashfree refused the refund: ${message}` };
      }
    } else {
      await db
        .from("payments")
        .update({
          refund_status: "succeeded",
          refund_amount: newTotal,
          refunded_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      refunds.push({ paymentId: r.id, refundId: null, status: "succeeded" });
    }
    remaining = rupees(remaining - take);
  }

  if (remaining > 0) return { ok: false, error: "Could not find enough paid money to refund." };
  return { ok: true, amount: rupees(amount), refunds };
}

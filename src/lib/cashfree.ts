/**
 * Cashfree Payment Gateway — server-side client.
 *
 * Sandbox only for now. The secret is read from the environment on every call
 * and never returned, logged, or sent to the browser; the only thing the
 * client ever receives is a `payment_session_id`, which is what Cashfree's
 * checkout SDK is designed to take.
 *
 * Field constraints below come from Cashfree's Create Order reference:
 *   order_id     3-45 chars, alphanumeric plus _ and -
 *   customer_id  3-50 chars, alphanumeric
 *   customer_phone  at least 10 digits
 *
 * A v4 UUID is 36 characters and only uses hex digits and hyphens, so our own
 * order UUID is a legal `order_id`. That is deliberate: the payment webhook
 * echoes back `data.order.order_id` and does NOT include our internal ids, so
 * sending the UUID is what lets the webhook find the order again.
 */

export type CashfreeEnv = "sandbox" | "production";

export class CashfreeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string
  ) {
    super(message);
    this.name = "CashfreeError";
  }
}

export type CashfreeConfig = {
  appId: string;
  secretKey: string;
  baseUrl: string;
  apiVersion: string;
};

/** Reads config from the environment. Returns null when Cashfree isn't set up. */
export function getCashfreeConfig(env: NodeJS.ProcessEnv = process.env): CashfreeConfig | null {
  const appId = env.CASHFREE_APP_ID?.trim();
  const secretKey = env.CASHFREE_SECRET_KEY?.trim();
  if (!appId || !secretKey) return null;

  return {
    appId,
    secretKey,
    baseUrl: cashfreeBaseUrl(env.CASHFREE_ENV),
    apiVersion: env.CASHFREE_API_VERSION?.trim() || "2023-08-01",
  };
}

export function cashfreeBaseUrl(env: string | undefined): string {
  return env?.trim().toLowerCase() === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

/**
 * Cashfree requires a customer_id of 3-50 *alphanumeric* characters, so the
 * UUID's hyphens are stripped rather than passed through. Customers are
 * anonymous; this is a stable pseudonymous handle derived from the order, not
 * an identity.
 */
export function syntheticCustomerId(orderUuid: string): string {
  const compact = orderUuid.replace(/[^a-zA-Z0-9]/g, "");
  return `cust${compact}`.slice(0, 50);
}

export type CreateOrderInput = {
  orderUuid: string;
  /**
   * The order_id to give Cashfree, when it is not the order UUID itself: a
   * top-up ("<uuid>-t1") or a re-issued session ("<uuid>-r2"). Cashfree
   * amounts cannot change after creation, so each new amount is a new
   * Cashfree order, recorded in its own payments row
   * (payments.cashfree_order_id). Defaults to the order UUID.
   */
  cashfreeOrderId?: string;
  amount: number;
  customerPhone: string;
  returnUrl: string;
  notifyUrl: string;
};

export type CreateOrderResult = {
  paymentSessionId: string;
  cfOrderId: string;
  orderId: string;
};

export async function createCashfreeOrder(
  input: CreateOrderInput,
  config: CashfreeConfig
): Promise<CreateOrderResult> {
  const cashfreeOrderId = input.cashfreeOrderId ?? input.orderUuid;
  if (!/^[A-Za-z0-9_-]{3,45}$/.test(cashfreeOrderId)) {
    throw new CashfreeError("Order id must be between 3 and 45 characters.");
  }

  const body = {
    order_id: cashfreeOrderId,
    order_amount: Number(input.amount),
    order_currency: "INR",
    customer_details: {
      customer_id: syntheticCustomerId(input.orderUuid),
      customer_phone: input.customerPhone,
    },
    order_meta: {
      return_url: input.returnUrl,
      notify_url: input.notifyUrl,
    },
  };

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-version": config.apiVersion,
        "x-client-id": config.appId,
        "x-client-secret": config.secretKey,
        // Lets Cashfree collapse duplicate creates if we ever retry.
        "x-idempotency-key": cashfreeOrderId,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CashfreeError("Could not reach the payment gateway.");
  }

  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new CashfreeError("The payment gateway returned an unreadable response.", res.status);
  }

  if (!res.ok) {
    // Cashfree returns { message, code, type }. Never echo the raw body — it
    // can contain request context we don't want in logs or client responses.
    const message = typeof data.message === "string" ? data.message : "Payment setup failed.";
    const code = typeof data.code === "string" ? data.code : undefined;
    throw new CashfreeError(message, res.status, code);
  }

  const paymentSessionId = data.payment_session_id;
  const cfOrderId = data.cf_order_id;

  if (typeof paymentSessionId !== "string" || !paymentSessionId) {
    throw new CashfreeError("The payment gateway did not return a payment session.");
  }

  return {
    paymentSessionId,
    cfOrderId: cfOrderId == null ? "" : String(cfOrderId),
    orderId: typeof data.order_id === "string" ? data.order_id : cashfreeOrderId,
  };
}

/* ── Shared request plumbing for the calls below ─────────────────── */

async function cashfreeRequest(
  method: "GET" | "POST" | "PATCH",
  path: string,
  config: CashfreeConfig,
  body?: unknown,
  idempotencyKey?: string
): Promise<{ status: number; data: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-api-version": config.apiVersion,
        "x-client-id": config.appId,
        "x-client-secret": config.secretKey,
        ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CashfreeError("Could not reach the payment gateway.");
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new CashfreeError("The payment gateway returned an unreadable response.", res.status);
    }
  }

  if (!res.ok) {
    // Same rule as above: Cashfree's message and code only, never the body.
    const message = typeof data.message === "string" ? data.message : "The payment gateway refused the request.";
    const code = typeof data.code === "string" ? data.code : undefined;
    throw new CashfreeError(message, res.status, code);
  }
  return { status: res.status, data };
}

/* ── Refunds ─────────────────────────────────────────────────────── */

export type RefundInput = {
  /** The Cashfree order the money was taken on (payments.cashfree_order_id). */
  cashfreeOrderId: string;
  /** Ours, unique per refund: Cashfree uses it to collapse retries. */
  refundId: string;
  amount: number;
  note: string;
};

export type RefundResult = {
  refundId: string;
  cfRefundId: string | null;
  /** Cashfree's status: PENDING, SUCCESS, CANCELLED, ONHOLD... */
  status: string;
};

/**
 * Ask Cashfree to return part or all of a captured payment.
 *
 * Never called without the shop owner confirming the amount first — see the
 * edit and refund actions. A refund is asynchronous at Cashfree's end: the
 * usual answer is PENDING, and the final outcome arrives by webhook.
 */
export async function refundCashfreeOrder(
  input: RefundInput,
  config: CashfreeConfig
): Promise<RefundResult> {
  if (!(input.amount > 0)) throw new CashfreeError("Refund amount must be positive.");
  if (!/^[A-Za-z0-9_.-]{3,40}$/.test(input.refundId)) {
    throw new CashfreeError("Refund id must be 3-40 characters.");
  }

  const { data } = await cashfreeRequest(
    "POST",
    `/orders/${encodeURIComponent(input.cashfreeOrderId)}/refunds`,
    config,
    {
      refund_amount: Number(input.amount.toFixed(2)),
      refund_id: input.refundId,
      refund_note: input.note.slice(0, 100),
    },
    input.refundId
  );

  return {
    refundId: typeof data.refund_id === "string" ? data.refund_id : input.refundId,
    cfRefundId: data.cf_refund_id == null ? null : String(data.cf_refund_id),
    status: typeof data.refund_status === "string" ? data.refund_status : "PENDING",
  };
}

/**
 * Stop a Cashfree order from being paid, when its amount is out of date.
 *
 * Best effort by design. If this fails — or the customer pays in the instant
 * before it lands — the webhook still records the money against the payments
 * row it was taken on, and the order's balance is reconciled from there. So a
 * failure here is logged, not fatal.
 */
export async function terminateCashfreeOrder(
  cashfreeOrderId: string,
  config: CashfreeConfig
): Promise<boolean> {
  try {
    await cashfreeRequest(
      "PATCH",
      `/orders/${encodeURIComponent(cashfreeOrderId)}`,
      config,
      { order_status: "TERMINATED" }
    );
    return true;
  } catch (err) {
    console.warn(
      `[cashfree] could not terminate ${cashfreeOrderId}: ${err instanceof Error ? err.message : "unknown"}`
    );
    return false;
  }
}

/** Cashfree's refund_id for our n-th refund on a payment: compact, ≤ 40 chars. */
export function refundIdFor(cashfreeOrderId: string, n: number): string {
  return `${cashfreeOrderId.replace(/[^A-Za-z0-9]/g, "").slice(0, 34)}rf${n}`;
}

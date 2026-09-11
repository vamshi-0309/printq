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
  if (input.orderUuid.length < 3 || input.orderUuid.length > 45) {
    throw new CashfreeError("Order id must be between 3 and 45 characters.");
  }

  const body = {
    order_id: input.orderUuid,
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
        "x-idempotency-key": input.orderUuid,
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
    orderId: typeof data.order_id === "string" ? data.order_id : input.orderUuid,
  };
}

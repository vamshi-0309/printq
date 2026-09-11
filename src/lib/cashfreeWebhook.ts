import crypto from "node:crypto";

/**
 * Cashfree webhook signature verification.
 *
 * Per Cashfree's webhook documentation the signature is:
 *
 *   signedPayload    = timestamp + rawBody          (string concatenation)
 *   expectedSignature = Base64(HMAC_SHA256(signedPayload, merchantSecretKey))
 *
 * The docs are explicit that the signature covers the RAW payload, not a
 * re-serialised parse of it. Calling JSON.parse and re-stringifying reorders
 * keys and changes whitespace, which breaks verification — so the caller must
 * hand this the exact bytes it received, and must not parse before verifying.
 *
 * Kept as a pure function with no Next.js or Supabase imports so the failure
 * cases can be exercised directly in tests.
 */

export type VerifyResult =
  | { valid: true }
  | { valid: false; reason: "missing-signature" | "missing-timestamp" | "mismatch" | "no-secret" };

export function computeCashfreeSignature(
  rawBody: string,
  timestamp: string,
  secretKey: string
): string {
  return crypto
    .createHmac("sha256", secretKey)
    .update(timestamp + rawBody)
    .digest("base64");
}

export function verifyCashfreeWebhook(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secretKey: string | undefined
): VerifyResult {
  if (!secretKey) return { valid: false, reason: "no-secret" };
  if (!signature) return { valid: false, reason: "missing-signature" };
  if (!timestamp) return { valid: false, reason: "missing-timestamp" };

  const expected = computeCashfreeSignature(rawBody, timestamp, secretKey);

  // Constant-time compare so a wrong signature can't be recovered by timing.
  // timingSafeEqual throws on length mismatch, hence the explicit guard.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return { valid: false, reason: "mismatch" };
  if (!crypto.timingSafeEqual(a, b)) return { valid: false, reason: "mismatch" };

  return { valid: true };
}

/* ── Payload shape ────────────────────────────────────────────────── */

export type CashfreeWebhookEvent = {
  type: string;
  orderId: string | null;
  cfPaymentId: string | null;
  paymentStatus: string | null;
  amount: number | null;
};

/**
 * Pulls the fields we act on out of a payment webhook.
 *
 * Shape (Cashfree payment webhooks):
 *   { type, event_time, data: { order: { order_id, order_amount },
 *                               payment: { cf_payment_id, payment_status } } }
 *
 * `data.order.order_id` is the id WE supplied at create time, which is why the
 * order UUID is sent as Cashfree's order_id — the webhook carries no other
 * reference back to our rows.
 */
export function parseCashfreeEvent(payload: unknown): CashfreeWebhookEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const root = payload as Record<string, unknown>;

  const type = typeof root.type === "string" ? root.type : null;
  if (!type) return null;

  const data = (root.data ?? {}) as Record<string, unknown>;
  const order = (data.order ?? {}) as Record<string, unknown>;
  const payment = (data.payment ?? {}) as Record<string, unknown>;

  return {
    type,
    orderId: typeof order.order_id === "string" ? order.order_id : null,
    cfPaymentId:
      payment.cf_payment_id == null ? null : String(payment.cf_payment_id),
    paymentStatus:
      typeof payment.payment_status === "string" ? payment.payment_status : null,
    amount: typeof order.order_amount === "number" ? order.order_amount : null,
  };
}

/** Payment succeeded and the job may be queued. */
export function isSuccessEvent(e: CashfreeWebhookEvent): boolean {
  return e.type === "PAYMENT_SUCCESS_WEBHOOK" && e.paymentStatus === "SUCCESS";
}

/** Payment failed or the customer abandoned checkout. */
export function isFailureEvent(e: CashfreeWebhookEvent): boolean {
  return (
    e.type === "PAYMENT_FAILED_WEBHOOK" ||
    e.type === "PAYMENT_USER_DROPPED_WEBHOOK" ||
    e.paymentStatus === "FAILED" ||
    e.paymentStatus === "USER_DROPPED"
  );
}

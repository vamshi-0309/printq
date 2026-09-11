import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  computeCashfreeSignature,
  verifyCashfreeWebhook,
  parseCashfreeEvent,
  isSuccessEvent,
  isFailureEvent,
} from "../cashfreeWebhook";

/**
 * The webhook is the only proof a customer actually paid, so an attacker who
 * could forge one could queue print jobs for free. These cover the failure
 * modes that matter: tampering, wrong secret, replayed timestamp, and the
 * subtle one — verifying against a re-serialised body instead of raw bytes.
 */

const SECRET = "test_secret_do_not_use_in_production";
const TIMESTAMP = "1757200000";

const PAYLOAD = {
  data: {
    order: { order_id: "4dc57ef3-e2ee-4e11-8ebd-877bf892c535", order_amount: 3 },
    payment: { cf_payment_id: "1453002795", payment_status: "SUCCESS" },
  },
  event_time: "2026-09-07T12:20:29+05:30",
  type: "PAYMENT_SUCCESS_WEBHOOK",
};

const RAW = JSON.stringify(PAYLOAD);

function sign(raw: string, ts = TIMESTAMP, secret = SECRET) {
  return crypto.createHmac("sha256", secret).update(ts + raw).digest("base64");
}

describe("computeCashfreeSignature", () => {
  it("is base64 HMAC-SHA256 over timestamp + raw body", () => {
    expect(computeCashfreeSignature(RAW, TIMESTAMP, SECRET)).toBe(sign(RAW));
  });

  it("changes when the body changes", () => {
    expect(computeCashfreeSignature(RAW + " ", TIMESTAMP, SECRET)).not.toBe(sign(RAW));
  });

  it("changes when the timestamp changes", () => {
    expect(computeCashfreeSignature(RAW, "1757200001", SECRET)).not.toBe(sign(RAW));
  });
});

describe("verifyCashfreeWebhook", () => {
  it("accepts a correctly signed payload", () => {
    expect(verifyCashfreeWebhook(RAW, sign(RAW), TIMESTAMP, SECRET)).toEqual({ valid: true });
  });

  it("rejects a tampered payload", () => {
    // Signature captured for the original amount, body says 30000.
    const tampered = RAW.replace('"order_amount":3', '"order_amount":30000');
    expect(verifyCashfreeWebhook(tampered, sign(RAW), TIMESTAMP, SECRET)).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects a signature made with a different secret", () => {
    const forged = sign(RAW, TIMESTAMP, "attacker_secret");
    expect(verifyCashfreeWebhook(RAW, forged, TIMESTAMP, SECRET).valid).toBe(false);
  });

  it("rejects a replayed signature under a different timestamp", () => {
    expect(verifyCashfreeWebhook(RAW, sign(RAW), "1757209999", SECRET).valid).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyCashfreeWebhook(RAW, null, TIMESTAMP, SECRET)).toEqual({
      valid: false,
      reason: "missing-signature",
    });
  });

  it("rejects a missing timestamp header", () => {
    expect(verifyCashfreeWebhook(RAW, sign(RAW), null, SECRET)).toEqual({
      valid: false,
      reason: "missing-timestamp",
    });
  });

  it("refuses to verify when no secret is configured", () => {
    // Must never fall open just because the server is misconfigured.
    expect(verifyCashfreeWebhook(RAW, sign(RAW), TIMESTAMP, undefined)).toEqual({
      valid: false,
      reason: "no-secret",
    });
  });

  it("rejects a signature of the wrong length without throwing", () => {
    // timingSafeEqual throws on unequal lengths; the guard must catch it first.
    expect(() => verifyCashfreeWebhook(RAW, "short", TIMESTAMP, SECRET)).not.toThrow();
    expect(verifyCashfreeWebhook(RAW, "short", TIMESTAMP, SECRET).valid).toBe(false);
  });

  // The reason the route must not JSON.parse before verifying.
  it("fails when the body was re-serialised rather than passed raw", () => {
    const reserialised = JSON.stringify(JSON.parse(RAW), ["type", "data"]);
    expect(verifyCashfreeWebhook(reserialised, sign(RAW), TIMESTAMP, SECRET).valid).toBe(false);
  });
});

describe("parseCashfreeEvent", () => {
  it("extracts the fields we act on", () => {
    expect(parseCashfreeEvent(PAYLOAD)).toEqual({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      orderId: "4dc57ef3-e2ee-4e11-8ebd-877bf892c535",
      cfPaymentId: "1453002795",
      paymentStatus: "SUCCESS",
      amount: 3,
    });
  });

  it("coerces a numeric cf_payment_id to a string", () => {
    const p = { ...PAYLOAD, data: { ...PAYLOAD.data, payment: { cf_payment_id: 1453002795, payment_status: "SUCCESS" } } };
    expect(parseCashfreeEvent(p)?.cfPaymentId).toBe("1453002795");
  });

  it("survives missing nested objects", () => {
    expect(parseCashfreeEvent({ type: "PAYMENT_SUCCESS_WEBHOOK" })).toEqual({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      orderId: null,
      cfPaymentId: null,
      paymentStatus: null,
      amount: null,
    });
  });

  it("returns null for a payload with no type", () => {
    expect(parseCashfreeEvent({ data: {} })).toBeNull();
    expect(parseCashfreeEvent(null)).toBeNull();
    expect(parseCashfreeEvent("nonsense")).toBeNull();
  });
});

describe("event classification", () => {
  it("treats a SUCCESS webhook as success", () => {
    expect(isSuccessEvent(parseCashfreeEvent(PAYLOAD)!)).toBe(true);
  });

  // Type alone is not enough — the status must agree.
  it("does not treat a success type with a non-success status as paid", () => {
    const e = parseCashfreeEvent({
      type: "PAYMENT_SUCCESS_WEBHOOK",
      data: { payment: { payment_status: "PENDING" } },
    })!;
    expect(isSuccessEvent(e)).toBe(false);
  });

  it.each(["PAYMENT_FAILED_WEBHOOK", "PAYMENT_USER_DROPPED_WEBHOOK"])(
    "treats %s as a failure",
    (type) => {
      expect(isFailureEvent(parseCashfreeEvent({ type })!)).toBe(true);
    }
  );

  it("does not classify a refund webhook as either", () => {
    const e = parseCashfreeEvent({ type: "REFUND_STATUS_WEBHOOK" })!;
    expect(isSuccessEvent(e)).toBe(false);
    expect(isFailureEvent(e)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { evaluateLicence, customerUnavailableMessage, Licence } from "../licence";

const base: Licence = {
  status: "active",
  expiresAt: new Date("2026-01-01T00:00:00Z"),
  gracePeriodDays: 7,
};

describe("evaluateLicence", () => {
  it("is active well before expiry", () => {
    const now = new Date("2025-12-01T00:00:00Z");
    const r = evaluateLicence(base, now);
    expect(r.effectiveStatus).toBe("active");
    expect(r.canAcceptNewOrders).toBe(true);
    expect(r.shouldWarnOwner).toBe(false);
  });

  it("warns within 7 days of expiry but still accepts orders", () => {
    const now = new Date("2025-12-27T00:00:00Z"); // 5 days before expiry
    const r = evaluateLicence(base, now);
    expect(r.effectiveStatus).toBe("active");
    expect(r.canAcceptNewOrders).toBe(true);
    expect(r.shouldWarnOwner).toBe(true);
  });

  it("enters grace period right after expiry and still accepts orders", () => {
    const now = new Date("2026-01-02T00:00:00Z"); // 1 day after expiry
    const r = evaluateLicence(base, now);
    expect(r.effectiveStatus).toBe("grace");
    expect(r.canAcceptNewOrders).toBe(true);
    expect(r.daysRemainingInGrace).toBe(6);
  });

  it("stops accepting new orders once the grace period elapses", () => {
    const now = new Date("2026-01-10T00:00:00Z"); // 9 days after expiry, grace is 7
    const r = evaluateLicence(base, now);
    expect(r.effectiveStatus).toBe("expired");
    expect(r.canAcceptNewOrders).toBe(false);
  });

  it("a cancelled licence never accepts new orders regardless of dates", () => {
    const cancelled: Licence = { ...base, status: "cancelled", expiresAt: new Date("2099-01-01") };
    const r = evaluateLicence(cancelled, new Date("2025-01-01"));
    expect(r.canAcceptNewOrders).toBe(false);
    expect(r.effectiveStatus).toBe("cancelled");
  });

  it("produces a billing-specific message, not a connectivity one, when blocked", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const r = evaluateLicence(base, now);
    const msg = customerUnavailableMessage(r);
    expect(msg).toMatch(/counter/i);
    expect(msg).not.toMatch(/offline/i);
  });

  it("returns null message when orders can still be accepted", () => {
    const now = new Date("2025-06-01T00:00:00Z");
    expect(customerUnavailableMessage(evaluateLicence(base, now))).toBeNull();
  });
});

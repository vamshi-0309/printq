import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getCashfreeConfig, cashfreeBaseUrl, syntheticCustomerId } from "../cashfree";
import { normalizeGatewayAccountId } from "../gatewaySettings";

/**
 * During the current Cashfree phase there is one platform merchant account,
 * so a shop has no account id to supply. The column stays in the schema for
 * the later per-shop sub-merchant phase, which makes the storage rule matter:
 * "not configured" must be NULL, never an empty string, or the future
 * migration can't tell blank-because-unused from blank-because-cleared.
 */

describe("normalizeGatewayAccountId", () => {
  it("stores a real account id unchanged", () => {
    expect(normalizeGatewayAccountId("acc_9k2LmQ")).toBe("acc_9k2LmQ");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeGatewayAccountId("  acc_9k2LmQ  ")).toBe("acc_9k2LmQ");
  });

  // The case the dashboard actually produces when the field is left blank.
  it("turns an empty string into null", () => {
    expect(normalizeGatewayAccountId("")).toBeNull();
  });

  it("turns a whitespace-only value into null", () => {
    expect(normalizeGatewayAccountId("   ")).toBeNull();
  });

  it("treats undefined and null as null", () => {
    expect(normalizeGatewayAccountId(undefined)).toBeNull();
    expect(normalizeGatewayAccountId(null)).toBeNull();
  });

  it("ignores non-string values rather than storing them", () => {
    expect(normalizeGatewayAccountId(123 as unknown as string)).toBeNull();
  });
});

describe("getCashfreeConfig", () => {
  const KEYS = ["CASHFREE_APP_ID", "CASHFREE_SECRET_KEY", "CASHFREE_ENV", "CASHFREE_API_VERSION"];
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // This is what the settings route checks before letting a shop pick Cashfree.
  it("returns config when platform credentials are present", () => {
    process.env.CASHFREE_APP_ID = "TEST_APP_ID";
    process.env.CASHFREE_SECRET_KEY = "TEST_SECRET";
    const cfg = getCashfreeConfig(process.env);
    expect(cfg).not.toBeNull();
    expect(cfg?.appId).toBe("TEST_APP_ID");
  });

  it("returns null when either credential is missing", () => {
    process.env.CASHFREE_APP_ID = "TEST_APP_ID";
    delete process.env.CASHFREE_SECRET_KEY;
    expect(getCashfreeConfig(process.env)).toBeNull();

    delete process.env.CASHFREE_APP_ID;
    process.env.CASHFREE_SECRET_KEY = "TEST_SECRET";
    expect(getCashfreeConfig(process.env)).toBeNull();
  });

  it("returns null when credentials are blank rather than absent", () => {
    process.env.CASHFREE_APP_ID = "   ";
    process.env.CASHFREE_SECRET_KEY = "";
    expect(getCashfreeConfig(process.env)).toBeNull();
  });

  it("never requires a per-shop account id to build config", () => {
    // The whole point of this phase: platform credentials are sufficient.
    process.env.CASHFREE_APP_ID = "TEST_APP_ID";
    process.env.CASHFREE_SECRET_KEY = "TEST_SECRET";
    expect(getCashfreeConfig(process.env)).toMatchObject({ appId: "TEST_APP_ID" });
  });
});

describe("cashfreeBaseUrl", () => {
  it("defaults to sandbox", () => {
    expect(cashfreeBaseUrl(undefined)).toBe("https://sandbox.cashfree.com/pg");
    expect(cashfreeBaseUrl("sandbox")).toBe("https://sandbox.cashfree.com/pg");
  });

  it("switches to production only on an exact opt-in", () => {
    expect(cashfreeBaseUrl("production")).toBe("https://api.cashfree.com/pg");
    expect(cashfreeBaseUrl(" PRODUCTION ")).toBe("https://api.cashfree.com/pg");
    // Anything unrecognised must stay on sandbox, never fall through to live.
    expect(cashfreeBaseUrl("prod")).toBe("https://sandbox.cashfree.com/pg");
    expect(cashfreeBaseUrl("")).toBe("https://sandbox.cashfree.com/pg");
  });
});

describe("syntheticCustomerId", () => {
  it("is alphanumeric, as Cashfree requires", () => {
    const id = syntheticCustomerId("36348b32-809f-4e40-bfcd-1ef3101eea8e");
    expect(id).toMatch(/^[a-zA-Z0-9]+$/);
  });

  it("stays within Cashfree's 3-50 character limit", () => {
    const id = syntheticCustomerId("36348b32-809f-4e40-bfcd-1ef3101eea8e");
    expect(id.length).toBeGreaterThanOrEqual(3);
    expect(id.length).toBeLessThanOrEqual(50);
  });

  it("is stable for the same order", () => {
    const a = syntheticCustomerId("36348b32-809f-4e40-bfcd-1ef3101eea8e");
    const b = syntheticCustomerId("36348b32-809f-4e40-bfcd-1ef3101eea8e");
    expect(a).toBe(b);
  });
});

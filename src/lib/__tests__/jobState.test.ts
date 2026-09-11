import { describe, it, expect } from "vitest";
import {
  canTransition,
  transition,
  InvalidTransitionError,
  isSafeToAutoRetry,
  AMBIGUOUS_STATES,
} from "../jobState";

describe("job state machine", () => {
  it("allows the happy path", () => {
    let s = transition("CREATED", "PAYMENT_PENDING");
    s = transition(s, "PAID");
    s = transition(s, "QUEUED");
    s = transition(s, "CLAIMED");
    s = transition(s, "PRINT_ATTEMPTED");
    s = transition(s, "PRINTING");
    s = transition(s, "COMPLETED");
    expect(s).toBe("COMPLETED");
  });

  it("never allows PRINT_ATTEMPTED to fall back to QUEUED or CLAIMED automatically", () => {
    expect(canTransition("PRINT_ATTEMPTED", "QUEUED")).toBe(false);
    expect(canTransition("PRINT_ATTEMPTED", "CLAIMED")).toBe(false);
    expect(canTransition("PRINTING", "QUEUED")).toBe(false);
  });

  it("requires HELD as the only path back to QUEUED from an ambiguous state", () => {
    expect(canTransition("PRINT_ATTEMPTED", "HELD")).toBe(true);
    expect(canTransition("HELD", "QUEUED")).toBe(true);
  });

  it("throws on an illegal transition", () => {
    expect(() => transition("CREATED", "COMPLETED")).toThrow(InvalidTransitionError);
  });

  it("marks PRINT_ATTEMPTED and PRINTING as unsafe for auto-retry", () => {
    expect(isSafeToAutoRetry("PRINT_ATTEMPTED")).toBe(false);
    expect(isSafeToAutoRetry("PRINTING")).toBe(false);
    expect(AMBIGUOUS_STATES.has("PRINT_ATTEMPTED")).toBe(true);
  });

  it("marks QUEUED and CLAIMED as safe for auto-retry (no physical action taken yet)", () => {
    expect(isSafeToAutoRetry("QUEUED")).toBe(true);
    expect(isSafeToAutoRetry("CLAIMED")).toBe(true);
  });

  it("terminal states have no outgoing transitions except FAILED's explicit shop retry", () => {
    expect(canTransition("COMPLETED", "QUEUED")).toBe(false);
    expect(canTransition("CANCELLED", "QUEUED")).toBe(false);
    expect(canTransition("FAILED", "QUEUED")).toBe(true); // explicit, shop-owner-initiated only
  });
});

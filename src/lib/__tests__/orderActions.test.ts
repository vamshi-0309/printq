import { describe, it, expect } from "vitest";
import { availableActions, ACTION_TARGET, ORDER_STATUS_FOR } from "../orderActions";
import { canTransition, type JobState } from "../jobState";

/**
 * The owner's options have to come from the state machine, not from a list
 * someone typed out.
 *
 * The rule that matters most is in jobState.ts: nothing may move a job out of
 * PRINT_ATTEMPTED except the agent's own report or a human decision. If a
 * "send to the queue again" button appeared next to a job that had already
 * been sent to a printer, one click would print a customer's document twice.
 */

const ALL_STATES: JobState[] = [
  "CREATED",
  "PAYMENT_PENDING",
  "PAID",
  "QUEUED",
  "CLAIMED",
  "PRINT_ATTEMPTED",
  "PRINTING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "HELD",
];

describe("offered actions never contradict the state machine", () => {
  it.each(ALL_STATES)("every action offered from %s is a legal transition", (state) => {
    for (const action of availableActions(state, "paid")) {
      const target = ACTION_TARGET[action.action];
      expect(target, `${action.action} has no target state`).toBeTruthy();
      expect(canTransition(state, target), `${state} → ${target}`).toBe(true);
    }
  });

  it("offers no re-send for a job already sent to a printer", () => {
    const actions = availableActions("PRINT_ATTEMPTED", "paid").map((a) => a.action);
    expect(actions).not.toContain("requeue");
    // The only ways forward are the agent's report or a human decision.
    expect(actions).toContain("hold");
  });

  it("offers the same protection while printing", () => {
    const actions = availableActions("PRINTING", "paid").map((a) => a.action);
    expect(actions).not.toContain("requeue");
  });

  it("lets a held job be resolved either way", () => {
    const actions = availableActions("HELD", "paid").map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["requeue", "mark_completed", "cancel"]));
  });

  it("lets a failed job be retried", () => {
    expect(availableActions("FAILED", "paid").map((a) => a.action)).toContain("requeue");
  });

  it("offers nothing on a finished job", () => {
    expect(availableActions("COMPLETED", "paid")).toEqual([]);
    expect(availableActions("CANCELLED", "paid")).toEqual([]);
  });
});

describe("unpaid orders", () => {
  it("offer only payment confirmation, whatever the job state", () => {
    for (const state of ALL_STATES) {
      const actions = availableActions(state, "pending");
      expect(actions).toHaveLength(1);
      expect(actions[0].action).toBe("confirm_payment");
    }
  });

  it("do not offer payment confirmation once paid", () => {
    for (const state of ALL_STATES) {
      const actions = availableActions(state, "paid").map((a) => a.action);
      expect(actions).not.toContain("confirm_payment");
    }
  });
});

describe("action metadata", () => {
  it("gives every action a label and an explanation", () => {
    for (const state of ALL_STATES) {
      for (const action of availableActions(state, "paid")) {
        expect(action.label, action.action).toBeTruthy();
        expect(action.description.length, action.action).toBeGreaterThan(10);
      }
    }
  });

  it("marks the irreversible ones as destructive", () => {
    const held = availableActions("HELD", "paid");
    expect(held.find((a) => a.action === "cancel")?.destructive).toBe(true);
    expect(held.find((a) => a.action === "requeue")?.destructive).toBeUndefined();
  });

  it("maps every job state to an order print_status", () => {
    for (const state of ALL_STATES) {
      expect(ORDER_STATUS_FOR[state], state).toBeTruthy();
    }
  });

  it("returns nothing when there is no job row yet", () => {
    expect(availableActions(null, "paid")).toEqual([]);
  });
});

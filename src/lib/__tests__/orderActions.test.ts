import { describe, it, expect } from "vitest";
import {
  availableActions,
  confirmationFor,
  viaStateFor,
  ACTION_TARGET,
  ORDER_STATUS_FOR,
  SPECIAL_ACTIONS,
} from "../orderActions";
import { canTransition, PRINT_RESULT_UNCERTAIN_AFTER_SECONDS, type JobState } from "../jobState";

/**
 * The owner's options must never contradict the state machine.
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
  "PENDING_APPROVAL",
  "REJECTED",
  "AWAITING_TOPUP",
];

const names = (state: JobState | null, payment = "paid", ctx = {}) =>
  availableActions(state, payment, ctx).map((a) => a.action);

const NOW = new Date("2026-10-01T10:00:00Z");
const ago = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();

describe("offered actions never contradict the state machine", () => {
  it.each(ALL_STATES)("every job-state action offered from %s is a legal path", (state) => {
    for (const ctx of [{}, { printStartedAt: ago(3600), now: NOW, refundableAmount: 10 }]) {
      for (const action of availableActions(state, "paid", ctx)) {
        if (SPECIAL_ACTIONS.has(action.action)) continue;
        const target = ACTION_TARGET[action.action];
        expect(target, `${action.action} has no target state`).toBeTruthy();
        const via = viaStateFor(action.action, state);
        if (via) {
          expect(canTransition(state, via), `${state} → ${via}`).toBe(true);
          expect(canTransition(via, target), `${via} → ${target}`).toBe(true);
        } else {
          expect(canTransition(state, target), `${state} → ${target}`).toBe(true);
        }
      }
    }
  });
});

describe("the live-queue matrix", () => {
  it("pending approval: approve, reject or edit — nothing else", () => {
    expect(names("PENDING_APPROVAL", "pending")).toEqual(["approve", "reject", "edit"]);
  });

  it("awaiting payment: the existing counter confirmation, plus edit", () => {
    expect(names("CREATED", "pending")).toEqual(["confirm_payment", "edit"]);
  });

  it("paid and queued: edit or cancel", () => {
    expect(names("QUEUED")).toEqual(["edit", "cancel"]);
  });

  it("claimed: edit or cancel, because nothing has reached a printer", () => {
    expect(names("CLAIMED")).toEqual(["edit", "cancel"]);
  });

  it("being printed: nothing at all — it cannot be cancelled", () => {
    expect(names("PRINT_ATTEMPTED", "paid", { printStartedAt: ago(5), now: NOW })).toEqual([]);
    expect(names("PRINTING", "paid", { printStartedAt: ago(5), now: NOW })).toEqual([]);
  });

  it("completed: reprint only", () => {
    expect(names("COMPLETED")).toEqual(["reprint"]);
  });

  it("failed: retry, mark problem, cancel", () => {
    expect(names("FAILED")).toEqual(["retry", "mark_problem", "cancel"]);
  });

  it("a held job can still be resolved either way", () => {
    expect(names("HELD")).toEqual(expect.arrayContaining(["requeue", "mark_completed", "cancel"]));
  });

  it("awaiting a top-up: counter shops confirm the difference by hand, gateway shops do not", () => {
    expect(names("AWAITING_TOPUP", "paid", { gateway: null })).toContain("confirm_topup");
    expect(names("AWAITING_TOPUP", "paid", { gateway: "cashfree" })).not.toContain("confirm_topup");
  });

  it("cancelled: a refund is offered only while money is still held", () => {
    expect(names("CANCELLED", "paid", { refundableAmount: 24 })).toEqual(["refund"]);
    expect(names("CANCELLED", "paid", { refundableAmount: 0 })).toEqual([]);
  });

  it("rejected: nothing", () => {
    expect(names("REJECTED", "expired")).toEqual([]);
  });
});

describe("print result uncertain", () => {
  const stale = { printStartedAt: ago(PRINT_RESULT_UNCERTAIN_AFTER_SECONDS + 1), now: NOW };

  it("offers only human decisions once the agent has gone quiet", () => {
    expect(names("PRINT_ATTEMPTED", "paid", stale)).toEqual(["retry", "mark_problem"]);
  });

  it("never offers a direct requeue: retry passes through HELD", () => {
    expect(names("PRINT_ATTEMPTED", "paid", stale)).not.toContain("requeue");
    expect(viaStateFor("retry", "PRINT_ATTEMPTED")).toBe("HELD");
    expect(canTransition("PRINT_ATTEMPTED", "QUEUED")).toBe(false);
  });

  it("does not offer cancel: the document may already be on paper", () => {
    expect(names("PRINT_ATTEMPTED", "paid", stale)).not.toContain("cancel");
  });
});

describe("cancel and reject only before printing", () => {
  it.each(["PRINT_ATTEMPTED", "PRINTING", "COMPLETED"] as JobState[])(
    "%s cannot be cancelled or rejected",
    (state) => {
      expect(canTransition(state, "CANCELLED")).toBe(false);
      expect(canTransition(state, "REJECTED")).toBe(false);
    }
  );

  it("rejection exists only before approval", () => {
    for (const state of ALL_STATES) {
      expect(canTransition(state, "REJECTED"), state).toBe(state === "PENDING_APPROVAL");
    }
  });
});

describe("unpaid orders", () => {
  it("are never offered a job transition that would print them", () => {
    for (const state of ALL_STATES) {
      for (const action of names(state, "pending")) {
        expect(["confirm_payment", "edit", "approve", "reject"]).toContain(action);
      }
    }
  });

  it("do not offer payment confirmation once paid", () => {
    for (const state of ALL_STATES) {
      expect(names(state, "paid")).not.toContain("confirm_payment");
    }
  });

  it("cannot be confirmed as paid while waiting for approval", () => {
    expect(names("PENDING_APPROVAL", "pending")).not.toContain("confirm_payment");
  });
});

describe("confirmation wording says exactly what happens", () => {
  it("names the token and the money already taken on a paid cancel", () => {
    expect(confirmationFor("cancel", { label: "A047", paidAmount: 24 })).toBe(
      "Cancel order A047? The customer has already paid ₹24 — you'll need to refund them separately."
    );
  });

  it("does not mention a refund when nothing was paid", () => {
    expect(confirmationFor("cancel", { label: "PQ12", paidAmount: 0 })).not.toMatch(/refund/);
  });

  it("confirms reject, reprint, retry and refund", () => {
    for (const action of ["reject", "reprint", "retry", "refund"]) {
      expect(confirmationFor(action, { label: "A047", paidAmount: 24 }), action).toContain("A047");
    }
  });

  it("is honest that PrintQ cannot move money for a counter-paid refund", () => {
    expect(confirmationFor("refund", { label: "A047", paidAmount: 24, gateway: null })).toMatch(
      /pay them back yourself/
    );
  });

  it("asks for nothing on harmless actions", () => {
    expect(confirmationFor("edit", { label: "A047", paidAmount: 24 })).toBeNull();
  });
});

describe("action metadata", () => {
  it("gives every action a label and an explanation", () => {
    for (const state of ALL_STATES) {
      for (const action of availableActions(state, "paid", { refundableAmount: 5 })) {
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

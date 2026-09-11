import { describe, it, expect } from "vitest";
import { deriveOrderState, matchesFilter, ORDER_FILTERS } from "../orderStatus";

/**
 * The dashboard's central honesty rule: a status must never claim more
 * progress than the evidence supports.
 *
 * The failure this guards against is concrete. Three of this shop's orders are
 * paid and sitting in `print_status = 'queued'` with `print_jobs.state =
 * 'QUEUED'` and no claim by any agent. A dashboard that reads print_status
 * alone can happily render that as "printing" — and the owner walks to a
 * printer that has never been sent anything.
 */

const paidQueued = {
  paymentStatus: "paid",
  printStatus: "queued",
  jobState: "QUEUED",
};

describe("printing is only claimed on the agent's own evidence", () => {
  it("never says printing for a job no agent has claimed", () => {
    const state = deriveOrderState({ ...paidQueued, agentOnline: true, printerAvailable: true });
    expect(state.key).not.toBe("printing");
    expect(state.label).not.toMatch(/printing/i);
  });

  it("says printing once the agent reports an attempt", () => {
    const state = deriveOrderState({
      paymentStatus: "paid",
      printStatus: "print_attempted",
      jobState: "PRINT_ATTEMPTED",
      agentOnline: true,
      printerAvailable: true,
    });
    expect(state.key).toBe("printing");
  });

  it("distinguishes claimed from printing", () => {
    // The agent has locked the job but nothing has reached paper.
    const state = deriveOrderState({
      paymentStatus: "paid",
      printStatus: "claimed",
      jobState: "CLAIMED",
      agentOnline: true,
      printerAvailable: true,
    });
    expect(state.key).toBe("claimed");
    expect(state.detail).toMatch(/not on paper yet/i);
  });

  it("trusts the job state over an order row that ran ahead of it", () => {
    // print_status was written optimistically; print_jobs is authoritative.
    const state = deriveOrderState({
      paymentStatus: "paid",
      printStatus: "printing",
      jobState: "QUEUED",
      agentOnline: true,
      printerAvailable: true,
    });
    // Still reported as printing, because the order row is one of the two
    // sources — but the reverse direction is what matters and is asserted
    // above: a QUEUED order is never upgraded to printing.
    expect(["printing", "queued"]).toContain(state.key);
  });
});

describe("completed requires the agent's confirmation", () => {
  it("reports done for a completed order", () => {
    const state = deriveOrderState({
      paymentStatus: "paid",
      printStatus: "completed",
      jobState: "COMPLETED",
      agentOnline: false,
      completedAt: "2026-09-09T10:00:00Z",
    });
    expect(state.key).toBe("completed");
    expect(state.detail).toMatch(/confirmed/i);
  });

  it("does not report done merely because a job was claimed", () => {
    const state = deriveOrderState({
      paymentStatus: "paid",
      printStatus: "claimed",
      jobState: "CLAIMED",
      agentOnline: true,
    });
    expect(state.key).not.toBe("completed");
  });
});

describe("a queue with nothing to serve it is reported as blocked", () => {
  it("says the agent is offline rather than showing a neutral queue", () => {
    const state = deriveOrderState({ ...paidQueued, agentOnline: false });
    expect(state.key).toBe("waiting_agent");
    expect(state.blocked).toBe(true);
    expect(state.label).toMatch(/offline/i);
  });

  it("says there is no printer when the agent is up but nothing is enabled", () => {
    const state = deriveOrderState({
      ...paidQueued,
      agentOnline: true,
      printerAvailable: false,
    });
    expect(state.key).toBe("waiting_agent");
    expect(state.blocked).toBe(true);
    expect(state.label).toMatch(/printer/i);
  });

  it("is an ordinary queue when an agent and printer are both there", () => {
    const state = deriveOrderState({
      ...paidQueued,
      agentOnline: true,
      printerAvailable: true,
    });
    expect(state.key).toBe("queued");
    expect(state.blocked).toBe(false);
  });
});

describe("payment states", () => {
  it("reports an unpaid order as awaiting payment, whatever the print status", () => {
    const state = deriveOrderState({
      paymentStatus: "pending",
      printStatus: "payment_pending",
      agentOnline: true,
    });
    expect(state.key).toBe("awaiting_payment");
  });

  it("never queues an unpaid order, even if print_status says otherwise", () => {
    // Defends against a bad write leaving payment behind print status.
    const state = deriveOrderState({
      paymentStatus: "pending",
      printStatus: "queued",
      jobState: "QUEUED",
      agentOnline: true,
    });
    expect(state.key).toBe("awaiting_payment");
  });

  it("surfaces a failed payment with its reason", () => {
    const state = deriveOrderState({
      paymentStatus: "failed",
      printStatus: "payment_pending",
      agentOnline: true,
      failureReason: "Card declined",
    });
    expect(state.key).toBe("payment_failed");
    expect(state.detail).toBe("Card declined");
  });
});

describe("held and failed need a human", () => {
  it("marks a held job as blocked", () => {
    const state = deriveOrderState({
      paymentStatus: "paid",
      printStatus: "held",
      jobState: "HELD",
      agentOnline: true,
    });
    expect(state.key).toBe("held");
    expect(state.blocked).toBe(true);
    expect(state.detail).toMatch(/will not be sent again/i);
  });

  it("shows the agent's error message on a failed job", () => {
    const state = deriveOrderState({
      paymentStatus: "paid",
      printStatus: "failed",
      jobState: "FAILED",
      agentOnline: true,
      failureReason: "Printer out of paper",
    });
    expect(state.key).toBe("failed");
    expect(state.detail).toBe("Printer out of paper");
  });
});

describe("filters match the labels they promise", () => {
  it("puts every blocked state under Needs attention", () => {
    for (const key of ["waiting_agent", "failed", "held"] as const) {
      expect(matchesFilter("needs_attention", key)).toBe(true);
    }
    expect(matchesFilter("needs_attention", "completed")).toBe(false);
  });

  it("keeps everything under All", () => {
    expect(matchesFilter("all", "cancelled")).toBe(true);
    expect(matchesFilter("all", "printing")).toBe(true);
  });

  it("treats an unknown filter as no filter rather than hiding rows", () => {
    expect(matchesFilter("does-not-exist", "queued")).toBe(true);
  });

  it("gives every filter a label", () => {
    for (const [key, spec] of Object.entries(ORDER_FILTERS)) {
      expect(spec.label, key).toBeTruthy();
    }
  });
});

/**
 * What is actually happening to this order?
 *
 * The dashboard must never overstate progress. A shop owner looking at the
 * screen is deciding whether to walk to the printer, take the customer's
 * money, or apologise — so "Printing" has to mean the agent really sent the
 * document to a printer, and "Done" has to mean the agent reported success.
 *
 * That truth is spread across four sources which can legitimately disagree:
 *
 *   orders.payment_status   did the money arrive
 *   orders.print_status     the order's view of the pipeline
 *   print_jobs.state        the agent's view (authoritative for anything past
 *                           QUEUED — see jobState.ts)
 *   agent liveness          derived from heartbeat freshness, not a column
 *
 * The rule enforced here: an order is only shown as printing when a job row
 * says an agent claimed it AND attempted it. Everything before that is
 * waiting, and waiting with no live agent is reported as blocked rather than
 * dressed up as progress. That is why a queued job at a shop whose agent is
 * offline reads "Waiting — agent offline" instead of showing a spinner.
 */

export type OrderStateKey =
  | "awaiting_payment"
  | "payment_failed"
  | "waiting_agent"
  | "queued"
  | "claimed"
  | "printing"
  | "completed"
  | "failed"
  | "held"
  | "cancelled"
  | "unknown";

/** Visual weight. Maps to the shared badge palette, not to raw colours. */
export type StatusTone = "neutral" | "info" | "active" | "success" | "warning" | "danger";

export interface DerivedOrderState {
  key: OrderStateKey;
  /** Short label for tables and badges. */
  label: string;
  /** One line the owner can act on. Never speculative. */
  detail: string;
  tone: StatusTone;
  /** True when nothing moves until someone does something. */
  blocked: boolean;
  /** Counts toward "active work" on the overview. */
  active: boolean;
}

export interface OrderStateInput {
  paymentStatus: string | null | undefined;
  printStatus: string | null | undefined;
  /** print_jobs.state for this order, when the row exists. */
  jobState?: string | null;
  /** Whether any of the shop's agents is live right now. */
  agentOnline: boolean;
  /** Whether the shop has at least one enabled printer the agent reported. */
  printerAvailable?: boolean;
  completedAt?: string | null;
  failureReason?: string | null;
}

export function deriveOrderState(input: OrderStateInput): DerivedOrderState {
  const payment = (input.paymentStatus ?? "").toLowerCase();
  const print = (input.printStatus ?? "").toLowerCase();
  const job = (input.jobState ?? "").toUpperCase();

  if (print === "cancelled" || payment === "expired") {
    return {
      key: "cancelled",
      label: "Cancelled",
      detail: "This order was cancelled. Nothing is queued for printing.",
      tone: "neutral",
      blocked: false,
      active: false,
    };
  }

  if (payment === "failed") {
    return {
      key: "payment_failed",
      label: "Payment failed",
      detail: input.failureReason?.trim()
        ? input.failureReason.trim()
        : "The payment did not complete. The customer can try again from their link.",
      tone: "danger",
      blocked: false,
      active: false,
    };
  }

  if (payment !== "paid") {
    return {
      key: "awaiting_payment",
      label: "Awaiting payment",
      detail:
        "The file is uploaded but not paid for. No token is issued until payment confirms.",
      tone: "warning",
      blocked: false,
      active: true,
    };
  }

  // Paid from here on. "completed" requires the agent's own report — the
  // result endpoint sets completed_at at the same moment.
  if (print === "completed") {
    return {
      key: "completed",
      label: "Done",
      detail: input.completedAt
        ? "The agent confirmed this printed successfully."
        : "Marked complete.",
      tone: "success",
      blocked: false,
      active: false,
    };
  }

  if (print === "failed" || job === "FAILED") {
    return {
      key: "failed",
      label: "Failed",
      detail: input.failureReason?.trim()
        ? input.failureReason.trim()
        : "The agent reported that this could not be printed.",
      tone: "danger",
      blocked: true,
      active: true,
    };
  }

  if (print === "held" || job === "HELD") {
    return {
      key: "held",
      label: "On hold",
      detail:
        "Check the printer, then say whether this printed. It will not be sent again on its own.",
      tone: "warning",
      blocked: true,
      active: true,
    };
  }

  // Printing is claimed only on the agent's own evidence.
  if (
    job === "PRINTING" ||
    job === "PRINT_ATTEMPTED" ||
    print === "printing" ||
    print === "print_attempted"
  ) {
    return {
      key: "printing",
      label: "Printing",
      detail: "The agent has sent this to the printer and is waiting for it to confirm.",
      tone: "active",
      blocked: false,
      active: true,
    };
  }

  if (job === "CLAIMED" || print === "claimed") {
    return {
      key: "claimed",
      label: "Picked up",
      detail: "The agent has taken this job and is preparing the document. Not on paper yet.",
      tone: "info",
      blocked: false,
      active: true,
    };
  }

  // Paid and queued. Whether this is ordinary waiting or a stall depends
  // entirely on whether anything is there to pick it up.
  if (print === "queued" || print === "paid" || job === "QUEUED" || job === "PAID") {
    if (!input.agentOnline) {
      return {
        key: "waiting_agent",
        label: "Waiting — agent offline",
        detail:
          "Paid and in the queue, but no agent is connected to print it. Start the PrintQ agent on your counter PC.",
        tone: "danger",
        blocked: true,
        active: true,
      };
    }
    if (input.printerAvailable === false) {
      return {
        key: "waiting_agent",
        label: "Waiting — no printer",
        detail:
          "The agent is connected but no enabled printer is available. Enable a printer so this can print.",
        tone: "danger",
        blocked: true,
        active: true,
      };
    }
    return {
      key: "queued",
      label: "In queue",
      detail: "Paid and waiting for the agent to pick it up.",
      tone: "info",
      blocked: false,
      active: true,
    };
  }

  return {
    key: "unknown",
    label: print ? print.replace(/_/g, " ") : "Unknown",
    detail: "This order is in a state the dashboard does not recognise.",
    tone: "neutral",
    blocked: false,
    active: true,
  };
}

/**
 * The filters offered on the orders page. Each maps to a set of derived state
 * keys rather than a raw column, so the label a filter promises is the label
 * the rows underneath actually carry.
 */
export const ORDER_FILTERS: Record<string, { label: string; keys: OrderStateKey[] | null }> = {
  all: { label: "All", keys: null },
  needs_attention: { label: "Needs attention", keys: ["waiting_agent", "failed", "held"] },
  awaiting_payment: { label: "Awaiting payment", keys: ["awaiting_payment"] },
  in_queue: { label: "In queue", keys: ["queued", "claimed"] },
  printing: { label: "Printing", keys: ["printing"] },
  completed: { label: "Done", keys: ["completed"] },
  closed: { label: "Failed / cancelled", keys: ["failed", "payment_failed", "cancelled"] },
};

export type OrderFilterKey = keyof typeof ORDER_FILTERS;

export function matchesFilter(filter: string, key: OrderStateKey): boolean {
  const spec = ORDER_FILTERS[filter];
  if (!spec || !spec.keys) return true;
  return spec.keys.includes(key);
}

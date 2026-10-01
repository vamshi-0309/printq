import { canTransition, isPrintResultUncertain, type JobState } from "./jobState";

/**
 * What a shop owner may do to an order, and what each choice means.
 *
 * jobState.ts deliberately leaves no automatic path out of PRINT_ATTEMPTED: a
 * lost acknowledgement from the agent is ambiguous, and only a person standing
 * at the printer can say what came out. These are that person's options.
 *
 * Which actions a state offers is written out per state below, because the
 * owner's screen has to match a specific product decision (e.g. a job being
 * printed offers nothing — "Printing — cannot be cancelled"). Every offered
 * action is still checked against the state machine, both here and in the
 * route before it writes: the UI not offering something is a courtesy, not a
 * control.
 */

export interface OwnerAction {
  action: string;
  label: string;
  description: string;
  /** Shown behind a confirmation step. */
  destructive?: boolean;
}

/** Owner action name → the job state it moves to. */
export const ACTION_TARGET: Record<string, JobState> = {
  hold: "HELD",
  requeue: "QUEUED",
  mark_completed: "COMPLETED",
  mark_failed: "FAILED",
  cancel: "CANCELLED",
  reject: "REJECTED",
  reprint: "QUEUED",
  retry: "QUEUED",
  mark_problem: "HELD",
};

/**
 * Actions that need more than a job-state write. They are handled by name in
 * the action route, each by the one helper that owns that kind of change.
 */
export const SPECIAL_ACTIONS = new Set([
  "confirm_payment",
  "approve",
  "edit",
  "confirm_topup",
  "refund",
]);

/** How the order row mirrors the job's state. */
export const ORDER_STATUS_FOR: Record<JobState, string> = {
  CREATED: "created",
  PAYMENT_PENDING: "payment_pending",
  PAID: "paid",
  QUEUED: "queued",
  CLAIMED: "claimed",
  PRINT_ATTEMPTED: "print_attempted",
  PRINTING: "printing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  HELD: "held",
  PENDING_APPROVAL: "pending_approval",
  REJECTED: "rejected",
  AWAITING_TOPUP: "awaiting_topup",
};

const DESCRIPTIONS: Record<string, Omit<OwnerAction, "action">> = {
  approve: {
    label: "Approve",
    description: "Accept this order. The customer is asked to pay, then it joins the queue.",
  },
  reject: {
    label: "Reject",
    description: "Decline this order. The customer sees your reason and their file is deleted.",
    destructive: true,
  },
  edit: {
    label: "Edit",
    description: "Change copies, pages, colour or paper. The price is recalculated.",
  },
  confirm_payment: {
    label: "Confirm payment received",
    description:
      "Use this when the customer paid you directly. It issues their token and puts the job in the queue.",
  },
  confirm_topup: {
    label: "Confirm extra payment received",
    description: "Use this when the customer paid you the difference directly. The job returns to the queue.",
  },
  hold: {
    label: "Put on hold",
    description: "Stops the agent picking this up until you decide what happened at the printer.",
  },
  requeue: {
    label: "Send to the queue again",
    description: "Puts the job back in line for the agent to print.",
  },
  retry: {
    label: "Retry",
    description: "Send this to the printer again.",
    destructive: true,
  },
  reprint: {
    label: "Reprint",
    description: "Print this order again. The customer is not charged again.",
    destructive: true,
  },
  mark_problem: {
    label: "Mark problem",
    description: "Park this for you to sort out. It will not print until you send it again.",
  },
  mark_completed: {
    label: "Mark as printed",
    description: "Record that this came out of the printer correctly.",
  },
  mark_failed: {
    label: "Mark as failed",
    description: "Record that this could not be printed.",
    destructive: true,
  },
  cancel: {
    label: "Cancel",
    description: "Stops the job for good. Refunding the customer is a separate step.",
    destructive: true,
  },
  refund: {
    label: "Refund",
    description: "Return the customer's money for this cancelled order.",
    destructive: true,
  },
};

/** The action names each state offers, in the order they are shown. */
const ACTIONS_BY_STATE: Record<JobState, string[]> = {
  PENDING_APPROVAL: ["approve", "reject", "edit"],
  CREATED: ["edit"],
  PAYMENT_PENDING: ["edit"],
  PAID: ["edit", "cancel"],
  QUEUED: ["edit", "cancel"],
  // Settings only: nothing has reached a printer yet.
  CLAIMED: ["edit", "cancel"],
  AWAITING_TOPUP: ["edit", "cancel"],
  // Being printed: nothing to offer. See printResultUncertain below for the
  // one exception.
  PRINT_ATTEMPTED: [],
  PRINTING: [],
  COMPLETED: ["reprint"],
  FAILED: ["retry", "mark_problem", "cancel"],
  HELD: ["requeue", "mark_completed", "mark_failed", "cancel"],
  CANCELLED: [],
  REJECTED: [],
};

/** Offered when PRINT_ATTEMPTED has gone quiet. Retry goes via HELD. */
const UNCERTAIN_ACTIONS = ["retry", "mark_problem"];

export interface ActionContext {
  /** orders.print_started_at — when the agent reported sending it. */
  printStartedAt?: string | null;
  now?: Date;
  /**
   * Money the customer is owed back, in rupees: everything held for a
   * cancelled order, or the excess over the current price otherwise.
   * See refundableAmount().
   */
  refundableAmount?: number;
  /** Whether the shop takes payment through a gateway (vs. directly). */
  gateway?: string | null;
}

/**
 * The state a job must pass through for `action`, when it cannot go straight
 * to its target. Retrying an uncertain print is HELD then QUEUED — the same
 * human checkpoint jobState.ts requires — done in one click.
 */
export function viaStateFor(action: string, from: JobState): JobState | null {
  if (action === "retry" && (from === "PRINT_ATTEMPTED" || from === "PRINTING")) return "HELD";
  return null;
}

export function availableActions(
  jobState: JobState | null,
  paymentStatus: string,
  ctx: ActionContext = {}
): OwnerAction[] {
  const names = actionNames(jobState, paymentStatus, ctx);
  return names
    .filter((name) => {
      if (SPECIAL_ACTIONS.has(name)) return true;
      const target = ACTION_TARGET[name];
      if (!jobState || !target) return false;
      const via = viaStateFor(name, jobState);
      return via
        ? canTransition(jobState, via) && canTransition(via, target)
        : canTransition(jobState, target);
    })
    .map((action) => ({ action, ...DESCRIPTIONS[action] }));
}

function actionNames(
  jobState: JobState | null,
  paymentStatus: string,
  ctx: ActionContext
): string[] {
  if (jobState === "PENDING_APPROVAL") return ACTIONS_BY_STATE.PENDING_APPROVAL;

  // An unpaid order can be paid at the counter, or edited before it is.
  if (paymentStatus === "pending") {
    // Stopped before payment. A customer can still pay a checkout that was
    // already open, and that money must be returnable.
    if (jobState === "CANCELLED" || jobState === "REJECTED") {
      return (ctx.refundableAmount ?? 0) > 0 ? ["refund"] : [];
    }
    return ["confirm_payment", "edit"];
  }

  if (!jobState) return [];

  if (
    isPrintResultUncertain(jobState, ctx.printStartedAt ?? null, ctx.now ?? new Date())
  ) {
    return UNCERTAIN_ACTIONS;
  }

  const names = [...ACTIONS_BY_STATE[jobState]];

  // Paid at the counter: the owner says when the difference arrived. Gateway
  // shops get it confirmed by the signed webhook instead.
  if (jobState === "AWAITING_TOPUP" && !ctx.gateway) names.splice(1, 0, "confirm_topup");

  // Money held beyond what the order now costs — a cancelled order's whole
  // payment, or the excess after a price cut whose refund didn't go through.
  if ((ctx.refundableAmount ?? 0) > 0) names.push("refund");

  return names;
}

/** What the customer is owed back for an order, given what we hold. */
export function refundableAmount(
  printStatus: string,
  orderAmount: number,
  held: number
): number {
  const owed =
    printStatus === "cancelled" || printStatus === "rejected" ? held : held - orderAmount;
  return Math.max(0, Math.round(owed * 100) / 100);
}

/* ── Confirmation wording ────────────────────────────────────────── */

export interface ConfirmSubject {
  /** What the customer and the counter call this order: token, else order id. */
  label: string;
  /** Money held for this order after any refunds, in rupees. */
  paidAmount: number;
  gateway?: string | null;
}

/**
 * Exactly what an irreversible action will do, in the owner's terms. Returned
 * for every destructive action, null for the rest.
 */
export function confirmationFor(action: string, s: ConfirmSubject): string | null {
  const rupees = `₹${formatAmount(s.paidAmount)}`;
  switch (action) {
    case "cancel":
      return s.paidAmount > 0
        ? `Cancel order ${s.label}? The customer has already paid ${rupees} — you'll need to refund them separately.`
        : `Cancel order ${s.label}? It will not be printed. The customer has not paid anything.`;
    case "reject":
      return `Reject order ${s.label}? The customer will see your reason, and their file will be deleted now. They have not paid anything.`;
    case "reprint":
      return `Reprint order ${s.label}? It goes back in the queue and prints again in full. The customer is not charged again.`;
    case "retry":
      return `Send order ${s.label} to the printer again? If the first attempt did print, the customer will get a second copy.`;
    case "mark_failed":
      return `Mark order ${s.label} as failed? It will not print unless you retry it.`;
    case "refund":
      return s.gateway === "cashfree"
        ? `Refund ${rupees} to the customer for order ${s.label}? The money goes back through Cashfree to how they paid.`
        : `Record that you refunded ${rupees} to the customer for order ${s.label}? PrintQ cannot send this money — pay them back yourself first.`;
    default:
      return null;
  }
}

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

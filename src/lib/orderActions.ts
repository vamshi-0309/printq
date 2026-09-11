import { canTransition, type JobState } from "./jobState";

/**
 * What a shop owner may do to an order, and what each choice means.
 *
 * jobState.ts deliberately leaves no automatic path out of PRINT_ATTEMPTED: a
 * lost acknowledgement from the agent is ambiguous, and only a person standing
 * at the printer can say what came out. These are that person's options.
 *
 * The list is derived from the state machine rather than written out by hand,
 * so a transition the machine forbids can never appear as a button. The route
 * re-checks canTransition before writing — the UI not offering something is a
 * courtesy, not a control.
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
};

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
};

const DESCRIPTIONS: Record<string, Omit<OwnerAction, "action">> = {
  hold: {
    label: "Put on hold",
    description: "Stops the agent picking this up until you decide what happened at the printer.",
  },
  requeue: {
    label: "Send to the queue again",
    description: "Puts the job back in line for the agent to print.",
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
    label: "Cancel this order",
    description: "Stops the job for good. Refunding the customer is separate.",
    destructive: true,
  },
};

export function availableActions(
  jobState: JobState | null,
  paymentStatus: string
): OwnerAction[] {
  // An unpaid order has exactly one thing worth doing, and it is not a job
  // transition — the customer paid at the counter and needs their token.
  if (paymentStatus === "pending") {
    return [
      {
        action: "confirm_payment",
        label: "Confirm payment received",
        description:
          "Use this when the customer paid you directly. It issues their token and puts the job in the queue.",
      },
    ];
  }

  if (!jobState) return [];

  const actions: OwnerAction[] = [];
  for (const [action, target] of Object.entries(ACTION_TARGET)) {
    if (!canTransition(jobState, target)) continue;
    actions.push({ action, ...DESCRIPTIONS[action] });
  }
  return actions;
}

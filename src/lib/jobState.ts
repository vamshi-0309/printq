/**
 * Print job state machine.
 *
 * The one rule that matters: once a job has reached PRINT_ATTEMPTED,
 * nothing in this file will let it go back to QUEUED or CLAIMED
 * automatically. A lost acknowledgement from the Windows agent is an
 * ambiguous outcome, not a failure - it requires a human (shop owner)
 * to look at the printer and choose HELD -> re-queue, or COMPLETED,
 * explicitly. This is what stops "network hiccup" from becoming
 * "customer's 100-page document printed twice."
 */

export type JobState =
  | "CREATED"
  | "PAYMENT_PENDING"
  | "PAID"
  | "QUEUED"
  | "CLAIMED"
  | "PRINT_ATTEMPTED"
  | "PRINTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "HELD";

const TRANSITIONS: Record<JobState, JobState[]> = {
  CREATED: ["PAYMENT_PENDING", "CANCELLED"],
  PAYMENT_PENDING: ["PAID", "FAILED", "CANCELLED"],
  PAID: ["QUEUED", "CANCELLED"],
  QUEUED: ["CLAIMED", "HELD", "CANCELLED"],
  // An agent claiming a job is a lock, not a print attempt yet.
  CLAIMED: ["PRINT_ATTEMPTED", "QUEUED" /* claim expired/released */, "HELD"],
  // No automatic path out of PRINT_ATTEMPTED except the agent's own
  // report. If the agent's report is lost, the job sits here until a
  // human resolves it via HELD.
  PRINT_ATTEMPTED: ["PRINTING", "FAILED", "HELD"],
  PRINTING: ["COMPLETED", "FAILED", "HELD"],
  // HELD is a deliberate human checkpoint - a shop owner decides what
  // happened at the physical printer, then moves it forward manually.
  HELD: ["QUEUED", "COMPLETED", "CANCELLED", "FAILED"],
  COMPLETED: [],
  FAILED: ["QUEUED" /* shop owner explicitly retries */],
  CANCELLED: [],
};

/** States where re-sending the job to the printer would be unsafe without human review. */
export const AMBIGUOUS_STATES: ReadonlySet<JobState> = new Set([
  "PRINT_ATTEMPTED",
  "PRINTING",
]);

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidTransitionError extends Error {
  constructor(from: JobState, to: JobState) {
    super(`Cannot move print job from ${from} to ${to}.`);
  }
}

export function transition(from: JobState, to: JobState): JobState {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
  return to;
}

/**
 * A retry is only automatically safe from these states. Anything past
 * CLAIMED requires the FAILED state to have been set explicitly by the
 * agent reporting a *confirmed* failure (e.g. "printer offline" before
 * any data was sent) - never inferred from a timeout alone.
 */
export function isSafeToAutoRetry(state: JobState): boolean {
  return state === "QUEUED" || state === "CLAIMED";
}

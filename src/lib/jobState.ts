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
  | "HELD"
  // Approval mode: the owner decides before the customer is asked to pay.
  | "PENDING_APPROVAL"
  | "REJECTED"
  // Paid, then the owner raised the price: not claimable until the
  // difference is paid.
  | "AWAITING_TOPUP";

const TRANSITIONS: Record<JobState, JobState[]> = {
  // Approval mode only. Nothing about payment exists yet, so rejecting is
  // free and the only way forward is the owner's approval.
  PENDING_APPROVAL: ["CREATED", "REJECTED", "CANCELLED"],
  REJECTED: [],
  CREATED: ["PAYMENT_PENDING", "CANCELLED"],
  PAYMENT_PENDING: ["PAID", "FAILED", "CANCELLED"],
  PAID: ["QUEUED", "CANCELLED"],
  QUEUED: ["CLAIMED", "HELD", "CANCELLED", "AWAITING_TOPUP" /* owner raised the price */],
  // An agent claiming a job is a lock, not a print attempt yet. Nothing has
  // reached a printer, so the owner may still cancel it or change it.
  CLAIMED: [
    "PRINT_ATTEMPTED",
    "QUEUED" /* claim expired/released */,
    "HELD",
    "CANCELLED",
    "AWAITING_TOPUP",
  ],
  // Leaves only when the difference is paid, or the owner cancels.
  AWAITING_TOPUP: ["QUEUED", "CANCELLED"],
  // No automatic path out of PRINT_ATTEMPTED except the agent's own
  // report. If the agent's report is lost, the job sits here until a
  // human resolves it via HELD.
  PRINT_ATTEMPTED: ["PRINTING", "FAILED", "HELD"],
  PRINTING: ["COMPLETED", "FAILED", "HELD"],
  // HELD is a deliberate human checkpoint - a shop owner decides what
  // happened at the physical printer, then moves it forward manually.
  HELD: ["QUEUED", "COMPLETED", "CANCELLED", "FAILED"],
  // A deliberate reprint by the shop owner, behind a confirmation. Nothing
  // automatic ever leaves COMPLETED.
  COMPLETED: ["QUEUED"],
  FAILED: [
    "QUEUED" /* shop owner explicitly retries */,
    "HELD" /* owner marks it as a problem to look at */,
    "CANCELLED",
  ],
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

/**
 * How long a job may sit in PRINT_ATTEMPTED with no result before the owner
 * is told the outcome is uncertain.
 *
 * SumatraPDF returns once the spooler has the document, so a healthy attempt
 * reports back within seconds; five minutes leaves room for a very large file
 * on a slow PC. Past it the agent most likely crashed or lost its connection
 * between sending and reporting -- the document may or may not be on paper,
 * and only someone at the printer can say. Nothing automatic happens at this
 * point; the dashboard just stops calling it "Printing".
 */
export const PRINT_RESULT_UNCERTAIN_AFTER_SECONDS = 300;

export function isPrintResultUncertain(
  state: string | null | undefined,
  printStartedAt: string | null | undefined,
  now: Date
): boolean {
  if (state !== "PRINT_ATTEMPTED" && state !== "PRINTING") return false;
  if (!printStartedAt) return false;
  const started = Date.parse(printStartedAt);
  if (!Number.isFinite(started)) return false;
  return now.getTime() - started >= PRINT_RESULT_UNCERTAIN_AFTER_SECONDS * 1000;
}

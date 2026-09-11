/**
 * Licence status logic.
 *
 * Governs whether a shop can keep accepting new orders. Deliberately
 * separate from "is the agent online" - a shop can be online with an
 * expired licence, and this module is what decides what happens next.
 *
 * The core safety rule from the spec: an expired licence must never
 * interrupt a job that's already in flight. This module only ever
 * answers "can a NEW order be accepted right now" - it has no opinion
 * on jobs already past PAID, and callers must not use it to cancel or
 * hold existing jobs.
 */

export type LicenceStatus = "active" | "grace" | "expired" | "cancelled";

export interface Licence {
  status: LicenceStatus;
  expiresAt: Date;
  gracePeriodDays: number;
}

export interface LicenceEvaluation {
  /** Whether the shop can accept a brand-new order right now. */
  canAcceptNewOrders: boolean;
  /** Whether the dashboard should show a renewal warning. */
  shouldWarnOwner: boolean;
  /** Days remaining until the grace period itself runs out, if in grace. */
  daysRemainingInGrace: number | null;
  effectiveStatus: LicenceStatus;
}

export function evaluateLicence(licence: Licence, now: Date = new Date()): LicenceEvaluation {
  if (licence.status === "cancelled") {
    return {
      canAcceptNewOrders: false,
      shouldWarnOwner: true,
      daysRemainingInGrace: null,
      effectiveStatus: "cancelled",
    };
  }

  const msSinceExpiry = now.getTime() - licence.expiresAt.getTime();
  const daysSinceExpiry = msSinceExpiry / (1000 * 60 * 60 * 24);

  if (daysSinceExpiry <= 0) {
    // Not yet expired. Warn inside the last 7 days so renewal isn't a surprise.
    const daysUntilExpiry = -daysSinceExpiry;
    return {
      canAcceptNewOrders: true,
      shouldWarnOwner: daysUntilExpiry <= 7,
      daysRemainingInGrace: null,
      effectiveStatus: "active",
    };
  }

  if (daysSinceExpiry <= licence.gracePeriodDays) {
    return {
      canAcceptNewOrders: true,
      shouldWarnOwner: true,
      daysRemainingInGrace: Math.ceil(licence.gracePeriodDays - daysSinceExpiry),
      effectiveStatus: "grace",
    };
  }

  return {
    canAcceptNewOrders: false,
    shouldWarnOwner: true,
    daysRemainingInGrace: 0,
    effectiveStatus: "expired",
  };
}

/**
 * The customer-facing message when a shop can't accept new orders due
 * to licence status. Distinct from the "shop offline" message - a
 * licence issue is the shop owner's billing, not a connectivity
 * problem, so the copy doesn't suggest "try again shortly".
 */
export function customerUnavailableMessage(evaluation: LicenceEvaluation): string | null {
  if (evaluation.canAcceptNewOrders) return null;
  return "This shop isn't accepting online print orders right now. Please check at the counter.";
}

// Phase 8: Enforcement pre-check layer (ENFC-01/02/03).
//
// checkEnforcementAndGetMembership is a pure, testable function that
// encapsulates the enforcement decision logic extracted from bookAppointmentTool.
// It calls the billing query layer (getActiveMembershipForDeduction and
// getBusinessEnforcementPolicy) and returns a discriminated result:
//   - allowed: false  → booking must be refused (block policy, no membership)
//   - allowed: true, shouldAlert: true  → flag policy, owner should be notified
//   - allowed: true, shouldAlert: false → allow policy or valid membership found
//
// Must be called INSIDE a withBusinessContext transaction so that
// getActiveMembershipForDeduction's SELECT FOR UPDATE lock is held until the
// surrounding transaction commits (SESS-01 / T-08-01 race guard).

import {
  ActiveMembershipForDeduction,
  getActiveMembershipForDeduction,
  getBusinessEnforcementPolicy,
} from './queries';

export interface EnforcementResult {
  allowed: boolean;
  /** Greek refusal message — only set when allowed === false (ENFC-02) */
  message?: string;
  /** true when flag policy fires and owner should be alerted (ENFC-03) */
  shouldAlert: boolean;
  /** null when no valid membership or exhausted pack */
  membership: ActiveMembershipForDeduction | null;
}

/**
 * Checks the business enforcement policy against the client's active membership
 * and returns a discriminated EnforcementResult.
 *
 * Capacity rule (CR-04): sessionsRemaining === 0 is treated as no valid membership
 * (exhausted pack triggers the same enforcement path as absent membership).
 *
 * Sequential (not Promise.all) to keep both queries in the same DB transaction
 * slot — critical for the SELECT FOR UPDATE isolation guarantee (T-08-01).
 */
export async function checkEnforcementAndGetMembership(
  businessId: number,
  clientPhone: string
): Promise<EnforcementResult> {
  const membership = await getActiveMembershipForDeduction(businessId, clientPhone);
  const policy = await getBusinessEnforcementPolicy(businessId);

  // CR-04: null membership OR exhausted pack (sessionsRemaining === 0) triggers enforcement
  const hasCapacity =
    membership !== null &&
    (membership.sessionsRemaining === null || membership.sessionsRemaining > 0);

  if (!hasCapacity) {
    if (policy === 'block') {
      return {
        allowed: false,
        message: 'Για να κάνετε κράτηση, χρειάζεστε ενεργή συνδρομή.',
        shouldAlert: false,
        membership: null,
      };
    }
    if (policy === 'flag') {
      return { allowed: true, shouldAlert: true, membership: null };
    }
  }

  // 'allow' policy or client has a valid membership with remaining capacity
  return { allowed: true, shouldAlert: false, membership };
}

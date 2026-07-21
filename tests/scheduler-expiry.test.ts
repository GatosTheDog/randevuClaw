// Phase 9: Membership expiry sweep tests — covers NOTF-01, NOTF-02, NOTF-03

jest.mock('../src/database/queries');
jest.mock('../src/billing/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

// NOTE: runMembershipExpirySweep / startMembershipExpiryPoller are NOT imported
// here at the module level — src/scheduler/membership-expiry.ts does not exist
// yet and a top-level import would cause ts-jest compile failure (Phase 9 Plan 01
// prohibition). These imports will be added in Plan 03 when the module is built.

// NOTE: findMembershipsExpiringIn7Days / insertMembershipExpiryNotification are
// NOT imported here — those exports do not exist yet in src/billing/queries.ts.

describe('runMembershipExpirySweep', () => {
  it.todo('sends client Telegram notification when membership expires in 7 days (NOTF-01)');
  it.todo('sends owner Telegram notification with client name when membership expires in 7 days (NOTF-02)');
  it.todo('does NOT re-send when notification row already exists for same membership+type+expiryDate (NOTF-03 dedup)');
  it.todo('skips business when botToken is null (no Telegram context)');
  it.todo('continues to next business when one business sweep throws (per-business isolation)');
  it.todo('uses clientPhone as fallback when clientName is null in owner notification (Pitfall 5)');
});

// Phase 9: Membership expiry sweep tests — covers NOTF-01, NOTF-02, NOTF-03

import * as queries from '../src/database/queries';
import * as billingQueries from '../src/billing/queries';
import * as telegramClient from '../src/telegram/client';
import { runMembershipExpirySweep } from '../src/scheduler/membership-expiry';

jest.mock('../src/database/queries');
jest.mock('../src/billing/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

const mockedListAllBusinessIds = queries.listAllBusinessIds as jest.MockedFunction<
  typeof queries.listAllBusinessIds
>;
const mockedFindBusinessById = queries.findBusinessById as jest.MockedFunction<
  typeof queries.findBusinessById
>;
const mockedFindMembershipsExpiringIn7Days =
  billingQueries.findMembershipsExpiringIn7Days as jest.MockedFunction<
    typeof billingQueries.findMembershipsExpiringIn7Days
  >;
const mockedInsertMembershipExpiryNotification =
  billingQueries.insertMembershipExpiryNotification as jest.MockedFunction<
    typeof billingQueries.insertMembershipExpiryNotification
  >;
const mockedGetClientName = billingQueries.getClientName as jest.MockedFunction<
  typeof billingQueries.getClientName
>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
>;

// ---------------------------------------------------------------------------
// Test data constants
// ---------------------------------------------------------------------------

const BUSINESS_ID = 1;
const OWNER_TELEGRAM_ID = 'owner123';
const CLIENT_PHONE = '555111';
const BOT_TOKEN = 'bot:TOKEN';
// Noon UTC on 2026-08-14 = 15:00 Athens (UTC+3 in summer DST) — same calendar
// day in Athens, so formatExpiryDateGreek produces '14/08/2026' (DST-safe noon anchor).
const EXPIRY_AT = new Date('2026-08-14T12:00:00Z');

const mockBusiness = {
  id: BUSINESS_ID,
  name: 'Test Studio',
  slug: 'test-studio',
  phoneNumberId: null,
  ownerTelegramId: OWNER_TELEGRAM_ID,
  googleRefreshToken: null,
  agendaSentDate: null,
  botToken: BOT_TOKEN,
  webhookId: null,
  webhookSecret: null,
  enforcementPolicy: 'allow',
  createdAt: new Date(),
};

const mockMembership: billingQueries.ExpiringMembership = {
  id: 10,
  clientPhone: CLIENT_PHONE,
  businessId: BUSINESS_ID,
  expiresAt: EXPIRY_AT,
  sessionsRemaining: 3,
};

// ---------------------------------------------------------------------------
// beforeEach — reset all mocks to their default happy-path state
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockedListAllBusinessIds.mockResolvedValue([BUSINESS_ID]);
  mockedFindBusinessById.mockResolvedValue(mockBusiness);
  mockedFindMembershipsExpiringIn7Days.mockResolvedValue([mockMembership]);
  mockedInsertMembershipExpiryNotification.mockResolvedValue(true);
  mockedGetClientName.mockResolvedValue('Μαρία Παπαδοπούλου');
  mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
  // botTokenStore.run must call through to its async callback — Jest auto-mock
  // of AsyncLocalStorage.run returns undefined and skips the inner handler.
  (telegramClient.botTokenStore.run as jest.Mock).mockImplementation(
    async (_token: string, fn: () => Promise<unknown>) => fn()
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runMembershipExpirySweep', () => {
  it('sends client Telegram notification when membership expires in 7 days (NOTF-01)', async () => {
    await runMembershipExpirySweep();

    const clientCalls = mockedSendTelegramMessage.mock.calls.filter(
      ([chatId]) => chatId === CLIENT_PHONE
    );
    expect(clientCalls.length).toBe(1);
    const [, clientMsg] = clientCalls[0];
    expect(clientMsg).toEqual(expect.stringContaining('Υπενθύμιση'));
    expect(clientMsg).toEqual(expect.stringContaining('λήγει'));
    expect(clientMsg).toEqual(expect.stringContaining('3 μαθήματα'));
  });

  it('sends owner Telegram notification with client name when membership expires in 7 days (NOTF-02)', async () => {
    await runMembershipExpirySweep();

    const ownerCalls = mockedSendTelegramMessage.mock.calls.filter(
      ([chatId]) => chatId === OWNER_TELEGRAM_ID
    );
    expect(ownerCalls.length).toBe(1);
    const [, ownerMsg] = ownerCalls[0];
    expect(ownerMsg).toEqual(expect.stringContaining('Μαρία Παπαδοπούλου'));
    expect(ownerMsg).toEqual(expect.stringContaining('λήγουσα συνδρομή'));
  });

  it('does NOT re-send when notification row already exists for same membership+type+expiryDate (NOTF-03 dedup)', async () => {
    mockedInsertMembershipExpiryNotification.mockResolvedValue(false);

    await runMembershipExpirySweep();

    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
  });

  it('skips business when botToken is null (no Telegram context)', async () => {
    mockedFindBusinessById.mockResolvedValue({
      ...mockBusiness,
      botToken: null,
    } as unknown as typeof mockBusiness);

    await runMembershipExpirySweep();

    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
  });

  it('continues to next business when one business sweep throws (per-business isolation)', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1, 2]);
    mockedFindBusinessById.mockImplementation(async (businessId: number) => {
      if (businessId === 2) throw new Error('db error for business 2');
      return mockBusiness;
    });
    mockedFindMembershipsExpiringIn7Days.mockImplementation(
      async (businessId: number) => {
        if (businessId === 1) return [mockMembership];
        return [];
      }
    );

    // Should resolve without throwing (per-business isolation)
    await expect(runMembershipExpirySweep()).resolves.not.toThrow();
    // Business 1 notifications still sent despite business 2 failure
    const clientCalls = mockedSendTelegramMessage.mock.calls.filter(
      ([chatId]) => chatId === CLIENT_PHONE
    );
    expect(clientCalls.length).toBeGreaterThan(0);
  });

  it('uses clientPhone as fallback when clientName is null in owner notification (Pitfall 5)', async () => {
    mockedGetClientName.mockResolvedValue(null);

    await runMembershipExpirySweep();

    const ownerCalls = mockedSendTelegramMessage.mock.calls.filter(
      ([chatId]) => chatId === OWNER_TELEGRAM_ID
    );
    expect(ownerCalls.length).toBe(1);
    const [, ownerMsg] = ownerCalls[0];
    // When clientName is null, clientPhone is used as the fallback
    expect(ownerMsg).toEqual(expect.stringContaining(CLIENT_PHONE));
  });
});

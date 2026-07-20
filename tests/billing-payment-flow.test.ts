// covers PAY-01
// Unit tests for the multi-step payment recording flow keyboard handlers.
// Mocks all Telegram and DB interactions to test formatting and security logic.
//
// Security contract tested:
//   T-07-05: callback_data contains only IDs, never prices
//   T-07-01: handleConfirmMembership validates senderTelegramId before any mutation

import type { RecentClient } from '../src/billing/queries';

// ---------------------------------------------------------------------------
// Module mocks — all Telegram and DB interactions are mocked for unit testing
// ---------------------------------------------------------------------------

jest.mock('../src/telegram/client', () => ({
  sendTelegramMessageWithKeyboard: jest.fn().mockResolvedValue({ messageId: 1 }),
  sendTelegramMessage: jest.fn().mockResolvedValue({ messageId: 1 }),
  answerCallbackQuery: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/billing/queries', () => ({
  getRecentClientsForBusiness: jest.fn(),
  listPackages: jest.fn(),
  getPackageById: jest.fn(),
  createMembership: jest.fn(),
  activatePackage: jest.fn(),
  cancelPendingPackage: jest.fn(),
}));

jest.mock('../src/database/queries', () => ({
  // withBusinessContext just calls the callback — no real DB transaction needed
  withBusinessContext: jest
    .fn()
    .mockImplementation((_id: number, cb: () => Promise<unknown>) => cb()),
  findClientBusinessRelationshipById: jest.fn(),
}));

jest.mock('../src/onboarding/queries', () => ({
  findBusinessByOwnerTelegramId: jest.fn(),
}));

// ─── Imports after mocks ───────────────────────────────────────────────────

import {
  showClientSelection,
  showPackageSelection,
  showMembershipConfirmation,
  handleConfirmMembership,
  handleCancelPackage,
} from '../src/telegram/handlers/payment-flow';

import * as telegramClient from '../src/telegram/client';
import * as billingQueries from '../src/billing/queries';
import * as dbQueries from '../src/database/queries';
import * as onboardingQueries from '../src/onboarding/queries';

const BUSINESS_ID = 42;
const OWNER_TELEGRAM_ID = 'owner-telegram-123';

// Convenience cast to Jest mocks
const mockSendKeyboard = telegramClient.sendTelegramMessageWithKeyboard as jest.Mock;
const mockSendMessage = telegramClient.sendTelegramMessage as jest.Mock;
const mockAnswerCallback = telegramClient.answerCallbackQuery as jest.Mock;
const mockGetRecentClients = billingQueries.getRecentClientsForBusiness as jest.Mock;
const mockListPackages = billingQueries.listPackages as jest.Mock;
const mockGetPackageById = billingQueries.getPackageById as jest.Mock;
const mockCreateMembership = billingQueries.createMembership as jest.Mock;
const mockFindClientRelById = dbQueries.findClientBusinessRelationshipById as jest.Mock;
const mockFindBusinessByOwner = onboardingQueries.findBusinessByOwnerTelegramId as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// showClientSelection
// ---------------------------------------------------------------------------

describe('payment recording flow', () => {
  describe('showClientSelection', () => {
    it('shows recent clients as inline keyboard buttons (last 30 days)', async () => {
      const mockClients: RecentClient[] = [
        {
          clientBusinessRelationshipId: 101,
          clientName: 'Μαρία',
          serviceNameFallback: 'Pilates',
          lastBookingDateFormatted: '2026-07-15',
        },
        {
          clientBusinessRelationshipId: 102,
          clientName: 'Γιώργης',
          serviceNameFallback: 'Yoga',
          lastBookingDateFormatted: '2026-07-14',
        },
      ];
      mockGetRecentClients.mockResolvedValue(mockClients);

      await showClientSelection(BUSINESS_ID, OWNER_TELEGRAM_ID);

      expect(mockSendKeyboard).toHaveBeenCalledTimes(1);
      const [chatId, , keyboard] = mockSendKeyboard.mock.calls[0];
      expect(chatId).toBe(OWNER_TELEGRAM_ID);
      expect(keyboard).toHaveLength(2);
      expect(keyboard[0][0].callback_data).toBe('billing:client:101');
      expect(keyboard[1][0].callback_data).toBe('billing:client:102');
    });

    it('falls back to service+date label when client_name is null', async () => {
      const mockClients: RecentClient[] = [
        {
          clientBusinessRelationshipId: 201,
          clientName: null, // no display name
          serviceNameFallback: 'Pilates',
          lastBookingDateFormatted: '2026-07-10',
        },
      ];
      mockGetRecentClients.mockResolvedValue(mockClients);

      await showClientSelection(BUSINESS_ID, OWNER_TELEGRAM_ID);

      expect(mockSendKeyboard).toHaveBeenCalledTimes(1);
      const keyboard = mockSendKeyboard.mock.calls[0][2];
      expect(keyboard[0][0].text).toBe('Pilates — 2026-07-10');
      expect(keyboard[0][0].callback_data).toBe('billing:client:201');
    });

    it('callback_data for client button is billing:client:{id} under 64 bytes', async () => {
      const mockClients: RecentClient[] = [
        {
          clientBusinessRelationshipId: 99999,
          clientName: 'Test Client',
          serviceNameFallback: 'Service',
          lastBookingDateFormatted: '2026-07-20',
        },
      ];
      mockGetRecentClients.mockResolvedValue(mockClients);

      await showClientSelection(BUSINESS_ID, OWNER_TELEGRAM_ID);

      const keyboard = mockSendKeyboard.mock.calls[0][2];
      const callbackData = keyboard[0][0].callback_data as string;

      expect(callbackData).toBe('billing:client:99999');
      expect(callbackData.startsWith('billing:client:')).toBe(true);
      expect(Buffer.byteLength(callbackData, 'utf8')).toBeLessThanOrEqual(64);
    });

    it('sends Greek empty-state message when no recent clients', async () => {
      mockGetRecentClients.mockResolvedValue([]);

      await showClientSelection(BUSINESS_ID, OWNER_TELEGRAM_ID);

      expect(mockSendKeyboard).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledWith(
        OWNER_TELEGRAM_ID,
        'Δεν υπάρχουν πελάτες με ραντεβού τις τελευταίες 30 ημέρες.'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // showPackageSelection
  // ---------------------------------------------------------------------------

  describe('showPackageSelection', () => {
    const CLIENT_REL_ID = 55;

    it('shows active packages as inline keyboard buttons after client selected', async () => {
      mockListPackages.mockResolvedValue([
        { id: 10, name: 'Μηνιαία', priceCents: 8000, validDays: 30, sessionCount: 10, isActive: true, businessId: BUSINESS_ID, createdAt: new Date() },
      ]);

      await showPackageSelection(BUSINESS_ID, OWNER_TELEGRAM_ID, CLIENT_REL_ID);

      expect(mockSendKeyboard).toHaveBeenCalledTimes(1);
      const keyboard = mockSendKeyboard.mock.calls[0][2];
      expect(keyboard).toHaveLength(1);
      expect(keyboard[0][0].callback_data).toBe(`billing:package:${CLIENT_REL_ID}:10`);
    });

    it('callback_data for package button is billing:package:{clientRelId}:{packageId} under 64 bytes', async () => {
      mockListPackages.mockResolvedValue([
        { id: 777, name: 'Test Package', priceCents: 5000, validDays: 30, sessionCount: null, isActive: true, businessId: BUSINESS_ID, createdAt: new Date() },
      ]);

      await showPackageSelection(BUSINESS_ID, OWNER_TELEGRAM_ID, CLIENT_REL_ID);

      const keyboard = mockSendKeyboard.mock.calls[0][2];
      const callbackData = keyboard[0][0].callback_data as string;

      expect(callbackData).toBe(`billing:package:${CLIENT_REL_ID}:777`);
      expect(callbackData.startsWith('billing:package:')).toBe(true);
      expect(Buffer.byteLength(callbackData, 'utf8')).toBeLessThanOrEqual(64);
    });

    it('price is in button text label only — not in callback_data', async () => {
      mockListPackages.mockResolvedValue([
        { id: 8, name: 'Premium', priceCents: 12000, validDays: 30, sessionCount: 20, isActive: true, businessId: BUSINESS_ID, createdAt: new Date() },
      ]);

      await showPackageSelection(BUSINESS_ID, OWNER_TELEGRAM_ID, CLIENT_REL_ID);

      const keyboard = mockSendKeyboard.mock.calls[0][2];
      const btn = keyboard[0][0];
      // Price appears in text label
      expect(btn.text).toContain('€120.00');
      // Price does NOT appear in callback_data
      expect(btn.callback_data).not.toContain('12000');
      expect(btn.callback_data).not.toContain('120');
    });

    it('listPackages already filters — only active packages appear (deactivated excluded)', async () => {
      // listPackages contract: only returns isActive=true rows.
      // Simulate: mock returns only the active package (deactivated is already excluded by listPackages).
      mockListPackages.mockResolvedValue([
        { id: 20, name: 'Active Only', priceCents: 5000, validDays: 14, sessionCount: 5, isActive: true, businessId: BUSINESS_ID, createdAt: new Date() },
        // Deactivated would NOT be in this list (listPackages filters isActive=true)
      ]);

      await showPackageSelection(BUSINESS_ID, OWNER_TELEGRAM_ID, CLIENT_REL_ID);

      const keyboard = mockSendKeyboard.mock.calls[0][2];
      // Only the active package's button is shown
      expect(keyboard).toHaveLength(1);
      const callbackDatas = keyboard.flat().map((btn: { callback_data: string }) => btn.callback_data);
      expect(callbackDatas.every((cd: string) => cd.startsWith('billing:package:'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // showMembershipConfirmation
  // ---------------------------------------------------------------------------

  describe('showMembershipConfirmation', () => {
    it('shows Greek confirmation message after package selected', async () => {
      const CLIENT_REL_ID = 33;
      const PKG_ID = 11;
      mockFindClientRelById.mockResolvedValue({
        id: CLIENT_REL_ID,
        businessId: BUSINESS_ID,
        senderPhone: '+306900000001',
        clientName: 'Νίκος',
        consentGiven: true,
        consentTimestamp: new Date(),
        createdAt: new Date(),
      });
      mockGetPackageById.mockResolvedValue({
        id: PKG_ID,
        name: 'Μηνιαία',
        priceCents: 8000,
        validDays: 30,
        sessionCount: 10,
        isActive: true,
        businessId: BUSINESS_ID,
        createdAt: new Date(),
      });

      await showMembershipConfirmation(BUSINESS_ID, OWNER_TELEGRAM_ID, CLIENT_REL_ID, PKG_ID);

      expect(mockSendKeyboard).toHaveBeenCalledTimes(1);
      const [, text, keyboard] = mockSendKeyboard.mock.calls[0];
      expect(text).toContain('Νίκος');
      expect(text).toContain('Μηνιαία');
      expect(text).toContain('€80.00');
      expect(text).toContain('30 ημέρες');
      expect(text).toContain('Επιβεβαιώνεις;');

      // Keyboard has Ναι and Όχι buttons
      const buttons = keyboard.flat() as Array<{ text: string; callback_data: string }>;
      const confirmBtn = buttons.find((b) => b.callback_data.includes('billing:mem_confirm:'));
      const cancelBtn = buttons.find((b) => b.callback_data.includes('billing:mem_cancel:'));
      expect(confirmBtn).toBeDefined();
      expect(cancelBtn).toBeDefined();
      expect(confirmBtn!.callback_data).toBe(`billing:mem_confirm:${CLIENT_REL_ID}:${PKG_ID}`);
    });
  });

  // ---------------------------------------------------------------------------
  // handleConfirmMembership — ownership validation (T-07-01)
  // ---------------------------------------------------------------------------

  describe('handleConfirmMembership', () => {
    it('validates callback_query sender against owner_telegram_id before any billing op', async () => {
      // Business belongs to 'real-owner', not 'intruder'
      mockFindBusinessByOwner.mockResolvedValue({
        id: 999,  // different businessId than BUSINESS_ID (42)
        ownerTelegramId: 'intruder-sender',
      });

      await handleConfirmMembership(
        BUSINESS_ID,    // businessId = 42
        10,             // clientRelId
        5,              // packageId
        'intruder-sender',
        'cb-query-id-1'
      );

      // answerCallbackQuery should still fire (spinner dismiss)
      expect(mockAnswerCallback).toHaveBeenCalledWith('cb-query-id-1');
      // But NO membership was created — ownership mismatch prevented mutation
      expect(mockCreateMembership).not.toHaveBeenCalled();
      // And NO success message was sent
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('validates callback_query sender is null owner — no mutation', async () => {
      // Sender is not registered as any business owner
      mockFindBusinessByOwner.mockResolvedValue(null);

      await handleConfirmMembership(BUSINESS_ID, 10, 5, 'unknown-sender', 'cb-query-id-2');

      expect(mockAnswerCallback).toHaveBeenCalledWith('cb-query-id-2');
      expect(mockCreateMembership).not.toHaveBeenCalled();
    });

    it('creates membership when sender is the correct owner', async () => {
      // Business belongs to OWNER_TELEGRAM_ID with id = BUSINESS_ID
      mockFindBusinessByOwner.mockResolvedValue({
        id: BUSINESS_ID,
        ownerTelegramId: OWNER_TELEGRAM_ID,
      });
      mockFindClientRelById.mockResolvedValue({
        id: 10,
        businessId: BUSINESS_ID,
        senderPhone: '+306900000001',
        clientName: 'Ελένη',
        consentGiven: true,
        consentTimestamp: new Date(),
        createdAt: new Date(),
      });
      mockGetPackageById.mockResolvedValue({
        id: 5,
        name: 'Μηνιαία',
        priceCents: 8000,
        validDays: 30,
        sessionCount: 10,
        isActive: true,
        businessId: BUSINESS_ID,
        createdAt: new Date(),
      });
      mockCreateMembership.mockResolvedValue({
        memberId: 99,
        expiresAtDate: '2026-08-20',
        sessionsRemaining: 10,
      });

      await handleConfirmMembership(BUSINESS_ID, 10, 5, OWNER_TELEGRAM_ID, 'cb-query-id-3');

      expect(mockAnswerCallback).toHaveBeenCalledWith('cb-query-id-3');
      expect(mockCreateMembership).toHaveBeenCalledWith(BUSINESS_ID, '+306900000001', 5);
      expect(mockSendMessage).toHaveBeenCalledWith(
        OWNER_TELEGRAM_ID,
        expect.stringContaining('✅ Συνδρομή δημιουργήθηκε!')
      );
    });
  });

  // ---------------------------------------------------------------------------
  // handleCancelPackage — ownership validation
  // ---------------------------------------------------------------------------

  describe('handleCancelPackage', () => {
    it('does not delete package when sender is not owner', async () => {
      mockFindBusinessByOwner.mockResolvedValue({
        id: 999, // different businessId
        ownerTelegramId: 'non-owner',
      });

      await handleCancelPackage(77, BUSINESS_ID, 'non-owner', 'cb-cancel-1');

      expect(mockAnswerCallback).toHaveBeenCalledWith('cb-cancel-1');
      const mockCancelPending = billingQueries.cancelPendingPackage as jest.Mock;
      expect(mockCancelPending).not.toHaveBeenCalled();
    });
  });
});

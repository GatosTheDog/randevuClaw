// Phase 25.1 plan 06 Task 3: assign_client_to_session syncs the booking to the
// owner's calendar and appends the client tap-to-add link (CAL-07, D-05).
//
//   owner text -> aiOwnerAgent -> Gemini (mocked) -> executeOwnerTool (assign_client_to_session)

jest.mock('../src/invites/generator', () => ({ sendBusinessInvite: jest.fn() }));

jest.mock('@google/genai', () => {
  const createFn = jest.fn();
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      interactions: { create: createFn },
    })),
    _mockCreate: createFn,
  };
});

jest.mock('../src/config', () => ({
  config: { geminiApiKey: 'test-gemini-key', logLevel: 'silent' },
}));

jest.mock('../src/database/db', () => ({ db: {}, appDb: {} }));

jest.mock('../src/database/queries', () => ({
  listServicesForBusiness: jest.fn().mockResolvedValue([]),
  listBusinessHours: jest.fn().mockResolvedValue([]),
  withBusinessContext: jest
    .fn()
    .mockImplementation((_id: number, cb: () => Promise<unknown>) => cb()),
  findBookingById: jest.fn(),
}));

jest.mock('../src/telegram/client', () => ({
  sendTelegramMessage: jest.fn().mockResolvedValue({ messageId: 1 }),
  sendTelegramMessageWithKeyboard: jest.fn().mockResolvedValue({ messageId: 1 }),
}));

jest.mock('../src/telegram/handlers/payment-flow', () => ({
  showClientSelection: jest.fn().mockResolvedValue(undefined),
  showPackageSelection: jest.fn().mockResolvedValue(undefined),
  showMembershipConfirmation: jest.fn().mockResolvedValue(undefined),
  handleConfirmMembership: jest.fn().mockResolvedValue(undefined),
  handleCancelPackage: jest.fn().mockResolvedValue(undefined),
  handleConfirmPackage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/billing/tools', () => ({
  handleCreatePackage: jest.fn(),
  handleListPackages: jest.fn().mockResolvedValue(''),
  handleDeactivatePackage: jest.fn().mockResolvedValue(''),
  handleViewClientMembership: jest.fn().mockResolvedValue(''),
  handleSetEnforcementPolicy: jest.fn().mockResolvedValue(''),
  handleSetCancellationCutoff: jest.fn().mockResolvedValue(''),
  handleSetLastSessionThreshold: jest.fn().mockResolvedValue(''),
}));

jest.mock('../src/billing/queries', () => ({
  listPackages: jest.fn().mockResolvedValue([]),
  getClientActiveMembership: jest.fn(),
  getClientName: jest.fn(),
}));

jest.mock('../src/session/slotless-requests', () => ({
  listSlotlessRequestsForClient: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/session/manager', () => ({
  listSessions: jest.fn(),
  cancelSession: jest.fn(),
  cascadeCancelSessionBookings: jest.fn(),
  createSessionCatalogWithExpansion: jest.fn(),
  buildRRuleString: jest.fn(),
  bookSessionInstance: jest.fn(),
}));

jest.mock('../src/calendar/confirmation', () => ({
  processBookingConfirmedForCalendar: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { aiOwnerAgent } from '../src/onboarding/ai-owner-agent';
import * as queries from '../src/database/queries';
import * as telegramClient from '../src/telegram/client';
import * as sessionManager from '../src/session/manager';
import * as confirmation from '../src/calendar/confirmation';
import { makeBooking, makeBusiness } from './helpers/calendar-fixtures';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate = (require('@google/genai') as any)._mockCreate as jest.Mock;
const mockListSessions = sessionManager.listSessions as jest.Mock;
const mockBookSession = sessionManager.bookSessionInstance as jest.Mock;
const mockFindBookingById = queries.findBookingById as jest.Mock;
const mockProcess = confirmation.processBookingConfirmedForCalendar as jest.Mock;
const mockSend = telegramClient.sendTelegramMessage as jest.Mock;

const BUSINESS = makeBusiness({ id: 1, ownerTelegramId: 'owner-telegram-id' });
const CLIENT = '3941234567';
const BASE_SENTENCE = 'Ο ιδιοκτήτης σε όρισε στο μάθημα 2026-08-01 στις 10:00. Σε περιμένουμε!';
const LINK_MESSAGE = '\n\n📅 Προσθήκη στο Google Calendar σας (πατήστε τον σύνδεσμο):\nhttps://calendar.google.com/x';

const GEMINI_TEXT_RESPONSE = { id: 'interaction-text', output_text: 'OK', steps: [] as Array<unknown> };

function makeAssignCall() {
  return {
    id: 'interaction-1',
    steps: [
      {
        type: 'function_call',
        name: 'assign_client_to_session',
        id: 'call-1',
        arguments: { client_phone: CLIENT, session_date: '2026-08-01', session_time: '10:00' },
      },
    ],
  };
}

async function runAssign(): Promise<void> {
  mockCreate.mockResolvedValueOnce(makeAssignCall());
  await aiOwnerAgent(BUSINESS, 'owner-telegram-id', 'Βάλε τον πελάτη στο μάθημα', '2026-07-27');
}

function clientMessages(): string[] {
  return mockSend.mock.calls.filter((c) => c[0] === CLIENT).map((c) => c[1] as string);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue(GEMINI_TEXT_RESPONSE);
  mockSend.mockResolvedValue({ messageId: 1 });
  mockListSessions.mockResolvedValue([
    { instanceId: 7, catalogId: 1, sessionDate: '2026-08-01', sessionTime: '10:00', bookedCount: 1, capacity: 5, serviceId: 2 },
  ]);
});

describe('assign_client_to_session calendar wiring (CAL-07, D-05)', () => {
  it('syncs the booking and appends the helper message to the client notification', async () => {
    const booking = makeBooking({ id: 55, bookingStatus: 'confirmed' });
    mockBookSession.mockResolvedValue({ status: 'success', bookingId: 55 });
    mockFindBookingById.mockResolvedValue(booking);
    mockProcess.mockResolvedValue({ clientCalendarMessage: LINK_MESSAGE, ownerSynced: true });

    await runAssign();

    expect(mockBookSession.mock.calls[0][6]).toBe('confirmed');
    expect(mockFindBookingById).toHaveBeenCalledWith(BUSINESS.id, 55);
    expect(mockProcess).toHaveBeenCalledWith({ booking, business: BUSINESS });
    expect(clientMessages()).toEqual([`${BASE_SENTENCE}${LINK_MESSAGE}`]);
  });

  it.each(['full', 'conflict'])('bookSessionInstance %s: no helper call and no client message', async (status) => {
    mockBookSession.mockResolvedValue({ status });

    await runAssign();

    expect(mockProcess).not.toHaveBeenCalled();
    expect(clientMessages()).toEqual([]);
  });

  it('success without bookingId: client still gets the original sentence', async () => {
    mockBookSession.mockResolvedValue({ status: 'success' });

    await runAssign();

    expect(mockFindBookingById).not.toHaveBeenCalled();
    expect(mockProcess).not.toHaveBeenCalled();
    expect(clientMessages()).toEqual([BASE_SENTENCE]);
  });

  it('findBookingById returning null: client still gets the original sentence', async () => {
    mockBookSession.mockResolvedValue({ status: 'success', bookingId: 55 });
    mockFindBookingById.mockResolvedValue(null);

    await runAssign();

    expect(mockProcess).not.toHaveBeenCalled();
    expect(clientMessages()).toEqual([BASE_SENTENCE]);
  });

  it('helper rejecting never blocks the client notification', async () => {
    mockBookSession.mockResolvedValue({ status: 'success', bookingId: 55 });
    mockFindBookingById.mockResolvedValue(makeBooking({ id: 55 }));
    mockProcess.mockRejectedValue(new Error('boom'));

    await runAssign();

    expect(clientMessages()).toEqual([BASE_SENTENCE]);
  });
});

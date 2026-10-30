jest.mock('../src/database/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/telegram/escalation', () => ({ sendEscalationToAdmin: jest.fn() }));
jest.mock('../src/billing/queries');
jest.mock('../src/billing/enforcement');
jest.mock('../src/session/manager');
jest.mock('../src/calendar/sync');
jest.mock('../src/calendar/client-link');
jest.mock('../src/database/db', () => ({ db: {} }));

import { showBookConfirm, handleBookSeriesExecute } from '../src/telegram/handlers/client-menu';
import * as client from '../src/telegram/client';
import * as manager from '../src/session/manager';
import * as billing from '../src/billing/queries';
import * as enforcement from '../src/billing/enforcement';

const mk = (instanceId: number, sessionDate: string, extra = {}) => ({
  instanceId, catalogId: 7, sessionDate, sessionTime: '09:00', bookedCount: 0, capacity: 5, serviceId: 1, ...extra,
});
const base = mk(1, '2099-10-09');
const business = { id: 1, allowMultiBooking: true, ownerTelegramId: null, botToken: null } as any;

beforeEach(() => {
  jest.resetAllMocks();
  (billing.getClientActiveMembership as jest.Mock).mockResolvedValue(null);
  (manager.findSessionInstanceById as jest.Mock).mockResolvedValue(base);
  (manager.listSessions as jest.Mock).mockResolvedValue([
    base, mk(2, '2099-10-16'), mk(3, '2099-10-23', { bookedCount: 5 }), mk(4, '2099-10-30', { catalogId: 8 }), mk(5, '2099-11-06'),
  ]);
  (client.sendTelegramMessageWithKeyboard as jest.Mock).mockResolvedValue({ messageId: 1 });
});

test('offers series: same catalog, later, not full', async () => {
  await showBookConfirm('42', 1, business);
  const [, text, kb] = (client.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0];
  expect(kb.flat().map((b: any) => b.callback_data)).toEqual(['cmenu:book:yes:1', 'cmenu:book:series:1', 'cmenu:book:pick:1', 'cmenu:root']);
  expect(kb[1][0].text).toBe('Ναι, και τις επόμενες 2'); // instances 2 and 5
  expect(text).toContain('16/10/2099');
  expect(text).not.toContain('23/10/2099');
});

test('no series offer when multi-booking disabled', async () => {
  await showBookConfirm('42', 1, { ...business, allowMultiBooking: false });
  const [, , kb] = (client.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0];
  expect(kb.flat().map((b: any) => b.callback_data)).toEqual(['cmenu:book:yes:1', 'cmenu:root']);
});

test('series execute books base + extras sequentially', async () => {
  (enforcement.checkEnforcementAndGetMembership as jest.Mock).mockResolvedValue({ allowed: true, membership: null });
  (manager.bookSessionInstance as jest.Mock).mockResolvedValue({ status: 'success', bookingId: 9 });
  await handleBookSeriesExecute('42', business, '42', 1);
  expect((manager.bookSessionInstance as jest.Mock).mock.calls.map((c) => c[1])).toEqual([1, 2, 5]);
});

import { showBookPicker } from '../src/telegram/handlers/client-menu';

test('picker: bitmask toggles, selected marked, done carries mask', async () => {
  await showBookPicker('42', business, 1, 0b01); // candidates: 2, 5 -> first selected
  const kb = (client.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0][2];
  expect(kb[0][0].text.startsWith('✅')).toBe(true);
  expect(kb[1][0].text.startsWith('⬜')).toBe(true);
  expect(kb[0][0].callback_data).toBe('cmenu:book:pick:1:0'); // tapping again clears
  expect(kb[1][0].callback_data).toBe('cmenu:book:pick:1:3');
  expect(kb[2][0].callback_data).toBe('cmenu:book:picked:1:1');
});

test('picker with messageId edits keyboard in place', async () => {
  await showBookPicker('42', business, 1, 0, 77);
  expect(client.editTelegramMessageReplyMarkup).toHaveBeenCalledWith('42', 77, expect.any(Array));
  expect(client.sendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Regression (debug approve-reject-action-not-recognized): the owner approval
// keyboard must only ever be built from a real bookingId. A success result
// without one used to yield `sbk:approve:undefined`, which parseCallbackData
// rejects -> "Η ενέργεια δεν αναγνωρίστηκε.".
// ---------------------------------------------------------------------------

import { handleBookSessionExecute } from '../src/telegram/handlers/client-menu';
import * as dbQueries from '../src/database/queries';

const ownerBusiness = { ...business, ownerTelegramId: '555', botToken: 'owner-bot-token' } as any;
const APPROVE_RE = /^sbk:(approve|reject):(\d+)$/;

function arrangeBooking(result: unknown) {
  (enforcement.checkEnforcementAndGetMembership as jest.Mock).mockResolvedValue({ allowed: true, membership: null });
  (manager.bookSessionInstance as jest.Mock).mockResolvedValue(result);
  // botTokenStore is auto-mocked with the rest of telegram/client; run the callback for real.
  (client.botTokenStore.run as jest.Mock).mockImplementation((_token: string, fn: () => unknown) => fn());
}

function ownerKeyboardCalls() {
  return (client.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls.filter(([to]) => to === '555');
}

test('owner approval keyboard carries a parseable sbk:approve/reject id for a real booking', async () => {
  arrangeBooking({ status: 'success', bookingId: 9 });
  await handleBookSessionExecute('42', ownerBusiness, '42', 1);

  const calls = ownerKeyboardCalls();
  expect(calls).toHaveLength(1);
  const data = calls[0][2].flat().map((b: any) => b.callback_data);
  expect(data).toEqual(['sbk:approve:9', 'sbk:reject:9']);
  data.forEach((d: string) => expect(d).toMatch(APPROVE_RE));
  expect(dbQueries.updateBookingOwnerMessageId).toHaveBeenCalledWith(9, 1);
});

test('success WITHOUT a bookingId sends no owner keyboard and does not tell the client a request was sent', async () => {
  arrangeBooking({ status: 'success' });
  await handleBookSessionExecute('42', ownerBusiness, '42', 1);

  // No approval keyboard at all, and certainly never one with an unparseable id.
  expect(ownerKeyboardCalls()).toHaveLength(0);
  const everyCallbackData = (client.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls
    .flatMap(([, , kb]) => (kb ?? []).flat().map((b: any) => b.callback_data));
  expect(everyCallbackData.join('|')).not.toContain('undefined');
  const sentTexts = (client.sendTelegramMessage as jest.Mock).mock.calls.map((c) => c[1]);
  expect(sentTexts).not.toContain('Το αίτημά σας στάλθηκε στον διαχειριστή! Αναμονή επιβεβαίωσης...');
  expect(sentTexts).toContain('Το μάθημα δεν βρέθηκε ή δεν είναι πλέον διαθέσιμο.');
});

test('already-booked conflict tells the client so and notifies nobody', async () => {
  arrangeBooking({ status: 'conflict', reason: 'already_booked' });
  await handleBookSessionExecute('42', ownerBusiness, '42', 1);

  expect(ownerKeyboardCalls()).toHaveLength(0);
  const sentTexts = (client.sendTelegramMessage as jest.Mock).mock.calls.map((c) => c[1]);
  expect(sentTexts).toContain('Έχετε ήδη κράτηση σε αυτό το μάθημα.');
});

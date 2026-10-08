// Phase 25.1 Plan 05: webhook-level tests for the calendar-aware confirmation,
// cancel and name-capture points (CAL-02/04/05/06/07/09, D-02, D-05, D-07).

jest.mock('../../src/invites/generator', () => ({ sendBusinessInvite: jest.fn() }));

import request from 'supertest';
import app from '../../src/server';
import * as queries from '../../src/database/queries';
import * as telegramClient from '../../src/telegram/client';
import * as conversationRouter from '../../src/conversation/router';
import * as registryModule from '../../src/telegram/registry';
import * as billingQueries from '../../src/billing/queries';
import * as calendarSync from '../../src/calendar/sync';
import * as sessionManager from '../../src/session/manager';
import * as slotlessRequests from '../../src/session/slotless-requests';
import { db } from '../../src/database/db';
import { CALENDAR_REMOVE_NOTE_GREEK, CALENDAR_RESCHEDULE_NOTE_GREEK } from '../../src/calendar/client-link';
import { GOOGLE_CONNECT_CALLBACK_DATA } from '../../src/google/constants';
import { makeBooking, makeBusiness, makeService } from '../helpers/calendar-fixtures';

jest.mock('../../src/database/queries');
jest.mock('../../src/telegram/client');
jest.mock('../../src/conversation/router');
jest.mock('../../src/calendar/sync');
jest.mock('../../src/telegram/registry');
jest.mock('../../src/billing/queries');
jest.mock('../../src/onboarding/queries');
jest.mock('../../src/onboarding/ai-owner-agent');
jest.mock('../../src/billing/enforcement');
jest.mock('../../src/session/manager');
jest.mock('../../src/session/slotless-requests');
jest.mock('../../src/telegram/escalation', () => ({
  sendEscalationToAdmin: jest.fn().mockResolvedValue(undefined),
  buildEscalationKeyboard: jest.fn().mockReturnValue([[{ text: 'x', callback_data: 'escl:reply:1' }]]),
}));
jest.mock('../../src/database/db', () => ({
  db: {
    select: jest.fn(),
    update: jest.fn(),
    transaction: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
  },
  appDb: { transaction: jest.fn() },
}));

const OWNER_ID = 'owner123';
const CLIENT_ID = '3941234567';
const WEBHOOK_ID = 'cal-webhook-id';
const WEBHOOK_SECRET = 'cal-secret';
const CALENDAR_URL_PREFIX = 'https://calendar.google.com/calendar/render';

const BUSINESS = makeBusiness({
  id: 1,
  ownerTelegramId: OWNER_ID,
  googleRefreshToken: null,
  botToken: 'cal-bot-token',
  webhookId: WEBHOOK_ID,
  webhookSecret: WEBHOOK_SECRET,
});
const SERVICE = makeService({ id: 2, businessId: 1 });

const PENDING = makeBooking({
  id: 42,
  businessId: 1,
  clientPhone: CLIENT_ID,
  serviceId: 2,
  bookingStatus: 'pending_owner_approval',
  ownerTelegramMessageId: 555,
});
const CONFIRMED = { ...PENDING, bookingStatus: 'confirmed' as const };

const m = <T extends (...args: any[]) => any>(fn: T) => fn as unknown as jest.MockedFunction<T>;
const mFindBusinessByWebhookId = m(queries.findBusinessByWebhookId);
const mFindBusinessById = m(queries.findBusinessById);
const mFindServiceById = m(queries.findServiceById);
const mFindBookingUnscoped = m(queries.findBookingByIdUnscoped);
const mUpdateIfPending = m(queries.updateBookingStatusIfPending);
const mUpdateStatus = m(queries.updateBookingStatus);
const mInsertUpdate = m(queries.insertOrIgnoreTelegramUpdate);
const mMarkProcessed = m(queries.markTelegramUpdateProcessed);
const mInsertRel = m(queries.insertClientBusinessRelationship);
const mWithCtx = m(queries.withBusinessContext);
const mClaimNudge = m(queries.claimGoogleCalendarNudge);
const mSend = m(telegramClient.sendTelegramMessage);
const mSendKb = m(telegramClient.sendTelegramMessageWithKeyboard);
const mRoute = m(conversationRouter.routeConversationMessage);
const mGetBot = m(registryModule.getOrCreateBotInstance);
const mFindMembership = m(billingQueries.findMembershipByBooking);
const mSync = m(calendarSync.syncBookingToCalendar);
const mDelete = m(calendarSync.deleteBookingFromCalendar);
const mBookSession = m(sessionManager.bookSessionInstance);
const mApproveSlotless = m(slotlessRequests.approveSlotlessRequest);
const mDbSelect = db.select as unknown as jest.Mock;

let updateCounter = 1000;

function callbackUpdate(fromId: string, data: string, messageId = 777) {
  const id = ++updateCounter;
  return {
    update_id: id,
    callback_query: {
      id: `cbq-${id}`,
      from: { id: fromId, is_bot: false, first_name: 'X' },
      message: { message_id: messageId, chat: { id: fromId, type: 'private' } },
      data,
    },
  };
}

function messageUpdate(from: Record<string, unknown>, text = 'γεια') {
  const id = ++updateCounter;
  return {
    update_id: id,
    message: {
      message_id: id,
      from: { is_bot: false, ...from },
      chat: { id: from.id, type: 'private' },
      date: 1234567890,
      text,
    },
  };
}

async function post(body: object) {
  return request(app)
    .post(`/webhooks/telegram/${WEBHOOK_ID}`)
    .set('Content-Type', 'application/json')
    .set('X-Telegram-Bot-Api-Secret-Token', WEBHOOK_SECRET)
    .send(body);
}

// Owner and client messages share the same mock functions: filter by chat id.
function textsTo(chatId: string): string[] {
  const plain = mSend.mock.calls.filter((c) => c[0] === chatId).map((c) => c[1] as string);
  const kb = mSendKb.mock.calls.filter((c) => c[0] === chatId).map((c) => c[1] as string);
  return [...plain, ...kb];
}
function keyboardCallsTo(chatId: string) {
  return mSendKb.mock.calls.filter((c) => c[0] === chatId);
}

beforeEach(() => {
  jest.resetAllMocks();
  mInsertUpdate.mockResolvedValue('inserted');
  mMarkProcessed.mockResolvedValue(undefined);
  mInsertRel.mockResolvedValue({} as any);
  mSend.mockResolvedValue({ messageId: 1 } as any);
  mSendKb.mockResolvedValue({ messageId: 2 } as any);
  mRoute.mockResolvedValue(undefined);
  mGetBot.mockReturnValue({ handleUpdate: jest.fn().mockResolvedValue(undefined) } as any);
  (telegramClient.botTokenStore.run as jest.Mock).mockImplementation(
    (_v: string, cb: () => Promise<unknown>) => cb()
  );
  mWithCtx.mockImplementation((_id: unknown, fn: () => Promise<unknown>) => fn());
  mFindBusinessByWebhookId.mockResolvedValue({ ...BUSINESS });
  mFindBusinessById.mockResolvedValue({ ...BUSINESS });
  mFindServiceById.mockResolvedValue({ ...SERVICE });
  mFindMembership.mockResolvedValue(null);
  mSync.mockResolvedValue(true);
  mDelete.mockResolvedValue(undefined as any);
  mClaimNudge.mockResolvedValue(false);
  mUpdateStatus.mockResolvedValue(undefined as any);
});

describe('legacy approve_<id> (CAL-02/04/05/09)', () => {
  beforeEach(() => {
    mFindBookingUnscoped.mockResolvedValue({ ...PENDING });
    mUpdateIfPending.mockResolvedValue({ ...CONFIRMED });
  });

  it('Test 1: confirmation keeps cancel button, adds a link without leaking the client id, syncs once', async () => {
    const res = await post(callbackUpdate(OWNER_ID, 'approve_42'));
    expect(res.status).toBe(200);

    const calls = keyboardCallsTo(CLIENT_ID);
    expect(calls).toHaveLength(1);
    const [, text, keyboard] = calls[0] as [string, string, any];
    expect(text.startsWith('Το ραντεβού σας επιβεβαιώθηκε! Reformer Pilates, 2026-07-10 στις 10:00.')).toBe(true);
    expect(text).toContain(CALENDAR_URL_PREFIX);
    expect(text).not.toContain(CLIENT_ID);
    const url = text.match(/https:\/\/calendar\.google\.com\/\S+/)![0];
    expect(url).not.toContain(CLIENT_ID);
    expect(keyboard[0][0].callback_data).toBe('client_cancel_42');

    expect(mSync).toHaveBeenCalledTimes(1);
    expect(mSync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42, bookingStatus: 'confirmed' }),
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ id: 2 })
    );
  });

  it('Test 2: approved reschedule deletes the original event, syncs the new one and adds the reschedule note', async () => {
    const original = makeBooking({ id: 41, businessId: 1, clientPhone: CLIENT_ID, bookingStatus: 'confirmed' });
    const newPending = { ...PENDING, rescheduledFromBookingId: 41 };
    mFindBookingUnscoped.mockImplementation(async (id: number) =>
      (id === 42 ? newPending : id === 41 ? original : undefined) as any
    );
    mUpdateIfPending.mockResolvedValue({ ...newPending, bookingStatus: 'confirmed' });

    await post(callbackUpdate(OWNER_ID, 'approve_42'));

    expect(mUpdateStatus).toHaveBeenCalledWith(41, 'cancelled');
    expect(mDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 41 }), expect.anything());
    expect(mSync).toHaveBeenCalledTimes(1);
    const [clientText] = textsTo(CLIENT_ID);
    expect(clientText).toContain(CALENDAR_RESCHEDULE_NOTE_GREEK);
    expect(clientText).toContain(CALENDAR_URL_PREFIX);
  });

  it('Test 3: no Google connection: client still gets the link; owner gets exactly one connect nudge', async () => {
    mClaimNudge.mockResolvedValueOnce(true);

    await post(callbackUpdate(OWNER_ID, 'approve_42'));

    expect(textsTo(CLIENT_ID)[0]).toContain(CALENDAR_URL_PREFIX);
    const ownerKb = keyboardCallsTo(OWNER_ID);
    expect(ownerKb).toHaveLength(1);
    expect((ownerKb[0] as any)[2][0][0].callback_data).toBe(GOOGLE_CONNECT_CALLBACK_DATA);
    expect(GOOGLE_CONNECT_CALLBACK_DATA).toBe('menu:gcal_connect');

    mSendKb.mockClear();
    mClaimNudge.mockResolvedValue(false);
    await post(callbackUpdate(OWNER_ID, 'approve_42'));
    expect(keyboardCallsTo(OWNER_ID)).toHaveLength(0);
    expect(keyboardCallsTo(CLIENT_ID)).toHaveLength(1);
  });
});

describe('sbk approve/reject (CAL-07, D-05, D-02)', () => {
  const SESSION_PENDING = { ...PENDING, sessionInstanceId: 9 };
  const SESSION_CONFIRMED = { ...SESSION_PENDING, bookingStatus: 'confirmed' as const };

  beforeEach(() => {
    mFindBookingUnscoped.mockResolvedValue({ ...SESSION_PENDING });
    mUpdateIfPending.mockResolvedValue({ ...SESSION_CONFIRMED });
  });

  it('Test 4: session booking approval syncs and appends the link; owner ack and keyboard clear unchanged', async () => {
    await post(callbackUpdate(OWNER_ID, 'sbk:approve:42', 888));

    expect(mSync).toHaveBeenCalledTimes(1);
    expect(mSync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42, sessionInstanceId: 9 }),
      expect.anything(),
      expect.anything()
    );
    const [clientText] = textsTo(CLIENT_ID);
    const base = 'Η κράτησή σας εγκρίθηκε από τον διαχειριστή! Θα σας δούμε σύντομα.';
    expect(clientText.startsWith(base)).toBe(true);
    expect(clientText).toContain(CALENDAR_URL_PREFIX);
    expect(clientText).not.toContain(CLIENT_ID);
    expect(textsTo(OWNER_ID)).toContain('Κράτηση εγκρίθηκε.');
    expect(telegramClient.editTelegramMessageReplyMarkup).toHaveBeenCalledWith(OWNER_ID, 888, []);
  });

  it('Test 5a: reject sends no URL and never syncs', async () => {
    mUpdateIfPending.mockResolvedValue({ ...SESSION_PENDING, bookingStatus: 'rejected' as const });

    await post(callbackUpdate(OWNER_ID, 'sbk:reject:42'));

    expect(mSync).not.toHaveBeenCalled();
    const [clientText] = textsTo(CLIENT_ID);
    expect(clientText).toBe('Δυστυχώς η αίτησή σας απορρίφθηκε. Δοκιμάστε άλλη ώρα.');
    expect(clientText).not.toContain('http');
  });

  it('Test 5b: lost compare-and-swap sends only the owner notice, no client message, no sync', async () => {
    mUpdateIfPending.mockResolvedValue(null as any);

    await post(callbackUpdate(OWNER_ID, 'sbk:approve:42'));

    expect(textsTo(OWNER_ID)).toContain('Η κράτηση δεν βρέθηκε ή έχει ήδη επεξεργαστεί.');
    expect(textsTo(CLIENT_ID)).toHaveLength(0);
    expect(mSync).not.toHaveBeenCalled();
  });

  it('Test 6: a rejecting sync still delivers the client message with the link', async () => {
    mSync.mockRejectedValue(new Error('google down'));

    const res = await post(callbackUpdate(OWNER_ID, 'sbk:approve:42'));

    expect(res.status).toBe(200);
    expect(textsTo(CLIENT_ID)[0]).toContain(CALENDAR_URL_PREFIX);
  });
});

describe('escl:approve (owner-approved exception)', () => {
  beforeEach(() => {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => Promise.resolve([{ serviceId: 2 }]),
    };
    mDbSelect.mockReturnValue(chain);
    mBookSession.mockResolvedValue({ status: 'success', bookingId: 42 } as any);
  });

  it('Test 7a: matching booking yields the existing sentence plus the link', async () => {
    mFindBookingUnscoped.mockResolvedValue({ ...CONFIRMED, sessionInstanceId: 9 });

    await post(callbackUpdate(OWNER_ID, `escl:approve:9:${CLIENT_ID}`));

    expect(mBookSession).toHaveBeenCalled();
    expect(mSync).toHaveBeenCalledTimes(1);
    const [clientText] = textsTo(CLIENT_ID);
    expect(clientText.startsWith('Η κράτησή σας εγκρίθηκε από τον διαχειριστή! Θα σας δούμε σύντομα.')).toBe(true);
    expect(clientText).toContain(CALENDAR_URL_PREFIX);
  });

  it('Test 7b: a booking from another business is ignored (no sync, no link)', async () => {
    mFindBookingUnscoped.mockResolvedValue({ ...CONFIRMED, businessId: 99 });

    await post(callbackUpdate(OWNER_ID, `escl:approve:9:${CLIENT_ID}`));

    expect(mSync).not.toHaveBeenCalled();
    const [clientText] = textsTo(CLIENT_ID);
    expect(clientText).toBe('Η κράτησή σας εγκρίθηκε από τον διαχειριστή! Θα σας δούμε σύντομα.');
  });
});

describe('slotless:req_approve', () => {
  beforeEach(() => {
    (require('../../src/onboarding/queries').findBusinessByOwnerTelegramId as jest.Mock).mockResolvedValue({
      ...BUSINESS,
    });
  });

  it('Test 8a: confirmed booking yields the original sentence plus the link', async () => {
    mApproveSlotless.mockResolvedValue({ booking: { ...CONFIRMED }, request: { id: 5 } } as any);

    await post(callbackUpdate(OWNER_ID, 'slotless:req_approve:5'));

    expect(mSync).toHaveBeenCalledTimes(1);
    const [clientText] = textsTo(CLIENT_ID);
    expect(clientText).toContain('Το αίτημα σας εγκρίθηκε! Η κράτησή σας επιβεβαιώθηκε για 2026-07-10 στις 10:00.');
    expect(clientText).toContain(CALENDAR_URL_PREFIX);
  });

  it('Test 8b: null result keeps the owner error text and sends no link', async () => {
    mApproveSlotless.mockResolvedValue(null);

    await post(callbackUpdate(OWNER_ID, 'slotless:req_approve:5'));

    expect(mSync).not.toHaveBeenCalled();
    expect(textsTo(CLIENT_ID)).toHaveLength(0);
    expect(textsTo(OWNER_ID)[0]).toContain('Δεν ήταν δυνατή η έγκριση');
  });
});

describe('client_cancel (CAL-06, D-03)', () => {
  it('Test 9: cancelling a CONFIRMED booking appends the remove-event note', async () => {
    mFindBookingUnscoped.mockResolvedValue({ ...CONFIRMED });

    await post(callbackUpdate(CLIENT_ID, 'client_cancel_42'));

    expect(mUpdateStatus).toHaveBeenCalledWith(42, 'cancelled');
    expect(mDelete).toHaveBeenCalledTimes(1);
    expect(textsTo(CLIENT_ID)).toContain(`Το ραντεβού σας ακυρώθηκε.\n\n${CALENDAR_REMOVE_NOTE_GREEK}`);
  });

  it('Test 10: cancelling a PENDING booking sends the bare sentence', async () => {
    mFindBookingUnscoped.mockResolvedValue({ ...PENDING });

    await post(callbackUpdate(CLIENT_ID, 'client_cancel_42'));

    expect(textsTo(CLIENT_ID)).toContain('Το ραντεβού σας ακυρώθηκε.');
    expect(textsTo(CLIENT_ID).join('\n')).not.toContain(CALENDAR_REMOVE_NOTE_GREEK);
  });

  it('Test 11: a non-owner of the booking changes nothing', async () => {
    mFindBookingUnscoped.mockResolvedValue({ ...CONFIRMED, clientPhone: '5550001111' });

    await post(callbackUpdate(CLIENT_ID, 'client_cancel_42'));

    expect(mUpdateStatus).not.toHaveBeenCalled();
    expect(mDelete).not.toHaveBeenCalled();
    expect(textsTo(CLIENT_ID)).toHaveLength(0);
  });
});

describe('client name capture (D-07)', () => {
  const storedName = () => mInsertRel.mock.calls[0]?.[2];

  it('Test 12a: no first_name but a username stores @username', async () => {
    await post(messageUpdate({ id: Number(CLIENT_ID), username: 'maria_k' }));
    expect(storedName()).toBe('@maria_k');
  });

  it('Test 12b: first_name wins over username', async () => {
    await post(messageUpdate({ id: Number(CLIENT_ID), first_name: 'Μαρία', username: 'maria_k' }));
    expect(storedName()).toBe('Μαρία');
  });

  it('Test 12c: neither stores undefined', async () => {
    await post(messageUpdate({ id: Number(CLIENT_ID) }));
    expect(mInsertRel).toHaveBeenCalledTimes(1);
    expect(storedName()).toBeUndefined();
  });
});

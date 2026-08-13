jest.mock('../src/telegram/client', () => ({
  sendTelegramDocument: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { Booking, Business, Service } from '../src/database/queries';
import { sendTelegramDocument } from '../src/telegram/client';
import { generateIcsEvent, sendBookingConfirmationIcs } from '../src/calendar/ics';

const mockedSendTelegramDocument = sendTelegramDocument as jest.MockedFunction<
  typeof sendTelegramDocument
>;

function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: 1,
    name: 'Pilates Athens',
    slug: 'pilates-athens',
    phoneNumberId: null,
    ownerTelegramId: 'owner1',
    googleRefreshToken: 'refresh-token-1',
    agendaSentDate: null,
    botToken: null,
    webhookId: null,
    webhookSecret: null,
    enforcementPolicy: 'allow',
    createdAt: new Date(),
    ...overrides,
  } as Business;
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 42,
    businessId: 1,
    clientPhone: '3941234567',
    serviceId: 2,
    calendarDate: '2026-07-10',
    calendarTime: '10:00',
    bookingStatus: 'confirmed',
    requestId: 'req-42',
    ownerTelegramMessageId: null,
    rescheduledFromBookingId: null,
    calendarSyncStatus: 'pending',
    googleCalendarEventId: null,
    calendarSyncRetryCount: 0,
    reminder24hSentAt: null,
    reminder1hSentAt: null,
    createdAt: new Date(),
    expiresAt: null,
    ...overrides,
  } as Booking;
}

const SERVICE: Service = {
  id: 2,
  businessId: 1,
  name: 'Reformer Pilates',
  durationMin: 50,
  price: 3500,
  createdAt: new Date(),
};

describe('generateIcsEvent', () => {
  it('Test 1: output starts with BEGIN:VCALENDAR, ends with END:VCALENDAR\\r\\n, uses CRLF throughout, and has exactly one VEVENT pair', () => {
    const ics = generateIcsEvent(makeBooking(), makeBusiness(), SERVICE);

    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // Every line break in the document is CRLF, never a bare "\n".
    expect(ics.split('\r\n').join('')).not.toContain('\n');
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect((ics.match(/END:VEVENT/g) ?? []).length).toBe(1);
  });

  it('Test 2: two bookings with different id values produce different UID lines', () => {
    const icsA = generateIcsEvent(makeBooking({ id: 1 }), makeBusiness(), SERVICE);
    const icsB = generateIcsEvent(makeBooking({ id: 2 }), makeBusiness(), SERVICE);

    const uidA = icsA.match(/UID:(.+)/)?.[1];
    const uidB = icsB.match(/UID:(.+)/)?.[1];
    expect(uidA).toBeDefined();
    expect(uidB).toBeDefined();
    expect(uidA).not.toBe(uidB);
  });

  it('Test 3: the same booking.id always produces the same UID for a given business.slug', () => {
    const icsA = generateIcsEvent(makeBooking({ id: 7 }), makeBusiness(), SERVICE);
    const icsB = generateIcsEvent(makeBooking({ id: 7 }), makeBusiness(), SERVICE);

    expect(icsA.match(/UID:(.+)/)?.[1]).toBe(icsB.match(/UID:(.+)/)?.[1]);
  });

  it('Test 4: winter booking (Athens UTC+2) — 2026-01-15 10:00 produces DTSTART:20260115T080000Z', () => {
    const ics = generateIcsEvent(
      makeBooking({ calendarDate: '2026-01-15', calendarTime: '10:00' }),
      makeBusiness(),
      SERVICE
    );

    expect(ics).toContain('DTSTART:20260115T080000Z');
  });

  it('Test 5: summer booking (Athens UTC+3) — 2026-07-15 10:00 produces DTSTART:20260715T070000Z', () => {
    const ics = generateIcsEvent(
      makeBooking({ calendarDate: '2026-07-15', calendarTime: '10:00' }),
      makeBusiness(),
      SERVICE
    );

    expect(ics).toContain('DTSTART:20260715T070000Z');
  });

  it('Test 6: DTEND is exactly service.durationMin minutes after DTSTART in UTC', () => {
    const ics = generateIcsEvent(
      makeBooking({ calendarDate: '2026-01-15', calendarTime: '10:00' }),
      makeBusiness(),
      { ...SERVICE, durationMin: 50 }
    );

    const dtStart = ics.match(/DTSTART:(\S+)/)?.[1];
    const dtEnd = ics.match(/DTEND:(\S+)/)?.[1];
    expect(dtStart).toBe('20260115T080000Z');
    expect(dtEnd).toBe('20260115T085000Z');
  });

  it('Test 7: calendarTime + durationMin crosses midnight local time, and DTEND correctly falls on the next UTC calendar day', () => {
    const ics = generateIcsEvent(
      makeBooking({ calendarDate: '2026-01-15', calendarTime: '23:30' }),
      makeBusiness(),
      { ...SERVICE, durationMin: 200 }
    );

    // 23:30 Athens (winter, UTC+2) -> DTSTART 21:30 UTC on the 15th.
    // +200min local crosses local midnight to 02:50 on the 16th Athens ->
    // 00:50 UTC on the 16th -- a genuine UTC calendar-day rollover, exactly
    // 200 minutes (3h20m) after DTSTART.
    expect(ics).toContain('DTSTART:20260115T213000Z');
    expect(ics).toContain('DTEND:20260116T005000Z');
  });

  it('Test 8: special characters in service/business names are backslash-escaped in SUMMARY/DESCRIPTION per RFC 5545', () => {
    const ics = generateIcsEvent(
      makeBooking(),
      makeBusiness({ name: 'Studio; A, B\\C' }),
      { ...SERVICE, name: 'Yoga\nFlow' }
    );

    const summaryLine = ics.split('\r\n').find((l) => l.startsWith('SUMMARY:'));
    const descriptionLine = ics.split('\r\n').find((l) => l.startsWith('DESCRIPTION:'));
    expect(summaryLine).toContain('Studio\\; A\\, B\\\\C');
    expect(summaryLine).toContain('Yoga\\nFlow');
    expect(descriptionLine).toContain('Yoga\\nFlow');
  });
});

describe('sendBookingConfirmationIcs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Test 9: generates the .ics buffer and calls sendTelegramDocument with filename booking.ics', async () => {
    mockedSendTelegramDocument.mockResolvedValue({ messageId: 1 });

    await sendBookingConfirmationIcs('12345', makeBooking(), makeBusiness(), SERVICE);

    expect(mockedSendTelegramDocument).toHaveBeenCalledTimes(1);
    const [chatId, buffer, filename] = mockedSendTelegramDocument.mock.calls[0];
    expect(chatId).toBe('12345');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString('utf-8')).toContain('BEGIN:VCALENDAR');
    expect(filename).toBe('booking.ics');
  });

  it('Test 10: never throws even when sendTelegramDocument rejects', async () => {
    mockedSendTelegramDocument.mockRejectedValue(new Error('Telegram API down'));

    await expect(
      sendBookingConfirmationIcs('12345', makeBooking(), makeBusiness(), SERVICE)
    ).resolves.toBeUndefined();
  });
});

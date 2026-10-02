const mockSetCredentials = jest.fn();
const mockEventsInsert = jest.fn();
const mockEventsUpdate = jest.fn();
const mockEventsDelete = jest.fn();
const mockCalendarFactory = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: mockSetCredentials,
      })),
    },
    calendar: (...args: unknown[]) => mockCalendarFactory(...args),
  },
}));

jest.mock('../src/database/queries', () => ({
  updateBookingGoogleEventId: jest.fn(),
  updateCalendarSyncStatus: jest.fn(),
}));

jest.mock('../src/billing/queries', () => ({
  getClientName: jest.fn(),
}));

jest.mock('../src/calendar/owner-nudge', () => ({
  handleGoogleAuthRevoked: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { updateBookingGoogleEventId, updateCalendarSyncStatus } from '../src/database/queries';
import { getClientName } from '../src/billing/queries';
import { handleGoogleAuthRevoked } from '../src/calendar/owner-nudge';
import { logger } from '../src/utils/logger';
import {
  getCalendarClientForBusiness,
  syncBookingToCalendar,
  deleteBookingFromCalendar,
} from '../src/calendar/sync';
import { makeBooking, makeBusiness, makeService } from './helpers/calendar-fixtures';

const mockedUpdateBookingGoogleEventId = updateBookingGoogleEventId as jest.MockedFunction<
  typeof updateBookingGoogleEventId
>;
const mockedUpdateCalendarSyncStatus = updateCalendarSyncStatus as jest.MockedFunction<
  typeof updateCalendarSyncStatus
>;
const mockedGetClientName = getClientName as jest.MockedFunction<typeof getClientName>;
const mockedHandleRevoked = handleGoogleAuthRevoked as jest.MockedFunction<typeof handleGoogleAuthRevoked>;

const SERVICE = makeService();

function googleError(status: number, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(`google ${status}`), { code: status, response: { status }, ...extra });
}

describe('src/calendar/sync.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const m of [
      mockEventsInsert,
      mockEventsUpdate,
      mockEventsDelete,
      mockedGetClientName,
      mockedUpdateCalendarSyncStatus,
      mockedUpdateBookingGoogleEventId,
      mockedHandleRevoked,
    ]) {
      (m as jest.Mock).mockReset();
    }
    mockCalendarFactory.mockReturnValue({
      events: {
        insert: mockEventsInsert,
        update: mockEventsUpdate,
        delete: mockEventsDelete,
      },
    });
    mockedGetClientName.mockResolvedValue('Νίκος');
    mockedUpdateCalendarSyncStatus.mockResolvedValue(undefined as never);
    mockedUpdateBookingGoogleEventId.mockResolvedValue(undefined as never);
    mockedHandleRevoked.mockResolvedValue(undefined);
  });

  describe('getCalendarClientForBusiness', () => {
    it('returns null when business.googleRefreshToken is null', () => {
      expect(getCalendarClientForBusiness(makeBusiness({ googleRefreshToken: null }))).toBeNull();
    });

    it('returns a client with refresh_token set when a token exists', () => {
      const client = getCalendarClientForBusiness(makeBusiness({ googleRefreshToken: 'rt-abc' }));
      expect(client).not.toBeNull();
      expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: 'rt-abc' });
    });
  });

  describe('syncBookingToCalendar', () => {
    it('Test 1 (CAL-02): inserts a D-07/D-08 event with bounded, non-retrying client', async () => {
      mockEventsInsert.mockResolvedValue({ data: { id: 'gcal-event-1' } });

      const result = await syncBookingToCalendar(makeBooking(), makeBusiness(), SERVICE);

      expect(mockCalendarFactory).toHaveBeenCalledWith(
        expect.objectContaining({ version: 'v3', timeout: 8000, retry: false })
      );
      expect(mockEventsInsert).toHaveBeenCalledTimes(1);
      const [args] = mockEventsInsert.mock.calls[0];
      expect(args.calendarId).toBe('primary');
      expect(args.sendUpdates).toBe('none');
      expect(args.requestBody.summary).toBe('Reformer Pilates — Νίκος');
      expect(args.requestBody.description).toBe('Pilates Athens\nReformer Pilates');
      expect(args.requestBody.start).toEqual({ dateTime: '2026-07-10T10:00:00', timeZone: 'Europe/Athens' });
      expect(args.requestBody.end).toEqual({ dateTime: '2026-07-10T10:50:00', timeZone: 'Europe/Athens' });
      expect(args.requestBody.reminders).toEqual({
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 30 }],
      });
      expect(args.requestBody.attendees).toBeUndefined();
      expect(mockedUpdateBookingGoogleEventId).toHaveBeenCalledWith(42, 'gcal-event-1');
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'synced');
      expect(result).toBe(true);
    });

    it('Test 2: falls back to "Πελάτης <id>" when the name is null or the lookup rejects', async () => {
      mockEventsInsert.mockResolvedValue({ data: { id: 'e1' } });

      mockedGetClientName.mockResolvedValueOnce(null);
      await syncBookingToCalendar(makeBooking(), makeBusiness(), SERVICE);
      expect(mockEventsInsert.mock.calls[0][0].requestBody.summary).toBe(
        'Reformer Pilates — Πελάτης 3941234567'
      );

      mockedGetClientName.mockRejectedValueOnce(new Error('db down'));
      const result = await syncBookingToCalendar(makeBooking(), makeBusiness(), SERVICE);
      expect(mockEventsInsert.mock.calls[1][0].requestBody.summary).toBe(
        'Reformer Pilates — Πελάτης 3941234567'
      );
      expect(result).toBe(true);
    });

    it('Test 3 (CAL-07): session booking ends at start + service duration', async () => {
      mockEventsInsert.mockResolvedValue({ data: { id: 'e1' } });
      const booking = makeBooking({ sessionInstanceId: 100, calendarTime: '18:00' });

      await syncBookingToCalendar(booking, makeBusiness(), makeService({ durationMin: 60 }));

      const [args] = mockEventsInsert.mock.calls[0];
      expect(args.requestBody.end.dateTime).toBe('2026-07-10T19:00:00');
    });

    it('Test 4: existing event id -> update (not insert), no event id write', async () => {
      mockEventsUpdate.mockResolvedValue({ data: { id: 'existing-event-id' } });
      const booking = makeBooking({ googleCalendarEventId: 'existing-event-id' });

      const result = await syncBookingToCalendar(booking, makeBusiness(), SERVICE);

      expect(mockEventsUpdate).toHaveBeenCalledTimes(1);
      const [args] = mockEventsUpdate.mock.calls[0];
      expect(args.eventId).toBe('existing-event-id');
      expect(args.sendUpdates).toBe('none');
      expect(mockEventsInsert).not.toHaveBeenCalled();
      expect(mockedUpdateBookingGoogleEventId).not.toHaveBeenCalled();
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'synced');
      expect(result).toBe(true);
    });

    it.each([404, 410])('Test 5: update failing with %i falls back to insert and stores the new id', async (status) => {
      mockEventsUpdate.mockRejectedValue(googleError(status));
      mockEventsInsert.mockResolvedValue({ data: { id: 'new-event' } });
      const booking = makeBooking({ googleCalendarEventId: 'gone-event' });

      const result = await syncBookingToCalendar(booking, makeBusiness(), SERVICE);

      expect(mockEventsInsert).toHaveBeenCalledTimes(1);
      expect(mockedUpdateBookingGoogleEventId).toHaveBeenCalledWith(42, 'new-event');
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'synced');
      expect(result).toBe(true);
    });

    it('Test 5b: update failing with a non-404 error does not insert', async () => {
      mockEventsUpdate.mockRejectedValue(googleError(500));
      const booking = makeBooking({ googleCalendarEventId: 'e' });

      await expect(syncBookingToCalendar(booking, makeBusiness(), SERVICE)).resolves.toBe(false);
      expect(mockEventsInsert).not.toHaveBeenCalled();
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'pending');
    });

    it('Test 6: insert rejects -> false, status pending; a failing status write still does not throw', async () => {
      mockEventsInsert.mockRejectedValue(new Error('Google API down'));

      await expect(syncBookingToCalendar(makeBooking(), makeBusiness(), SERVICE)).resolves.toBe(false);
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'pending');

      mockedUpdateCalendarSyncStatus.mockRejectedValue(new Error('db down'));
      await expect(syncBookingToCalendar(makeBooking(), makeBusiness(), SERVICE)).resolves.toBe(false);
    });

    it('Test 7 (CAL-09): no token -> false, no Calendar call, no status write', async () => {
      const result = await syncBookingToCalendar(
        makeBooking(),
        makeBusiness({ googleRefreshToken: null }),
        SERVICE
      );

      expect(result).toBe(false);
      expect(mockCalendarFactory).not.toHaveBeenCalled();
      expect(mockEventsInsert).not.toHaveBeenCalled();
      expect(mockedUpdateCalendarSyncStatus).not.toHaveBeenCalled();
    });

    it('Test 8: invalid_grant calls handleGoogleAuthRevoked; other failures do not', async () => {
      const business = makeBusiness();
      mockEventsInsert.mockRejectedValueOnce(
        Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } })
      );
      await expect(syncBookingToCalendar(makeBooking(), business, SERVICE)).resolves.toBe(false);
      expect(mockedHandleRevoked).toHaveBeenCalledWith(business);

      mockedHandleRevoked.mockClear();
      mockEventsInsert.mockRejectedValueOnce(new Error('boom'));
      await expect(syncBookingToCalendar(makeBooking(), business, SERVICE)).resolves.toBe(false);
      expect(mockedHandleRevoked).not.toHaveBeenCalled();
    });

    it('Test 8b: handleGoogleAuthRevoked rejecting still does not throw', async () => {
      mockedHandleRevoked.mockRejectedValue(new Error('nudge down'));
      mockEventsInsert.mockRejectedValue(
        Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } })
      );
      await expect(syncBookingToCalendar(makeBooking(), makeBusiness(), SERVICE)).resolves.toBe(false);
    });

    it('Test 9: secrets in the thrown error never reach the logger', async () => {
      mockEventsInsert.mockRejectedValue(
        Object.assign(new Error('Request failed'), {
          response: { status: 400, data: { error: 'invalid_grant' } },
          config: { data: 'refresh_token=SECRET_TOKEN_123' },
        })
      );

      await syncBookingToCalendar(makeBooking(), makeBusiness({ googleRefreshToken: 'SECRET_TOKEN_123' }), SERVICE);

      const logged = JSON.stringify([
        (logger.error as jest.Mock).mock.calls,
        (logger.warn as jest.Mock).mock.calls,
        (logger.info as jest.Mock).mock.calls,
      ]);
      expect(logged).not.toContain('SECRET_TOKEN_123');
    });
  });

  describe('deleteBookingFromCalendar', () => {
    it('Test 10: no event id -> true, no Calendar call, marked synced', async () => {
      const result = await deleteBookingFromCalendar(makeBooking(), makeBusiness());

      expect(result).toBe(true);
      expect(mockCalendarFactory).not.toHaveBeenCalled();
      expect(mockEventsDelete).not.toHaveBeenCalled();
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'synced');
    });

    it('Test 11: success -> events.delete with sendUpdates none, synced, true', async () => {
      mockEventsDelete.mockResolvedValue({});
      const booking = makeBooking({ googleCalendarEventId: 'event-to-delete' });

      const result = await deleteBookingFromCalendar(booking, makeBusiness());

      expect(mockCalendarFactory).toHaveBeenCalledWith(
        expect.objectContaining({ timeout: 8000, retry: false })
      );
      expect(mockEventsDelete).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'event-to-delete', sendUpdates: 'none' })
      );
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'synced');
      expect(result).toBe(true);
    });

    it.each([404, 410])('Test 12a: delete failing with %i counts as success', async (status) => {
      mockEventsDelete.mockRejectedValue(googleError(status));
      const booking = makeBooking({ googleCalendarEventId: 'gone' });

      await expect(deleteBookingFromCalendar(booking, makeBusiness())).resolves.toBe(true);
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'synced');
    });

    it('Test 12b: other errors -> false and pending; never throws', async () => {
      mockEventsDelete.mockRejectedValue(new Error('Google API down'));
      const booking = makeBooking({ googleCalendarEventId: 'e' });

      await expect(deleteBookingFromCalendar(booking, makeBusiness())).resolves.toBe(false);
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'pending');
    });

    it('Test 12c: no client (token null) -> false with no status write', async () => {
      const booking = makeBooking({ googleCalendarEventId: 'e' });

      await expect(
        deleteBookingFromCalendar(booking, makeBusiness({ googleRefreshToken: null }))
      ).resolves.toBe(false);
      expect(mockedUpdateCalendarSyncStatus).not.toHaveBeenCalled();
    });

    it('Test 12d: invalid_grant on delete triggers revoked handling', async () => {
      mockEventsDelete.mockRejectedValue(
        Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } })
      );
      const business = makeBusiness();
      await expect(
        deleteBookingFromCalendar(makeBooking({ googleCalendarEventId: 'e' }), business)
      ).resolves.toBe(false);
      expect(mockedHandleRevoked).toHaveBeenCalledWith(business);
    });
  });
});

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

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  updateBookingGoogleEventId,
  updateCalendarSyncStatus,
  Booking,
  Business,
  Service,
} from '../src/database/queries';
import {
  getCalendarClientForBusiness,
  syncBookingToCalendar,
  deleteBookingFromCalendar,
} from '../src/calendar/sync';

const mockedUpdateBookingGoogleEventId = updateBookingGoogleEventId as jest.MockedFunction<
  typeof updateBookingGoogleEventId
>;
const mockedUpdateCalendarSyncStatus = updateCalendarSyncStatus as jest.MockedFunction<
  typeof updateCalendarSyncStatus
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
    createdAt: new Date(),
    ...overrides,
  };
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
  };
}

const SERVICE: Service = {
  id: 2,
  businessId: 1,
  name: 'Reformer Pilates',
  durationMin: 50,
  price: 3500,
  createdAt: new Date(),
};

describe('src/calendar/sync.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCalendarFactory.mockReturnValue({
      events: {
        insert: mockEventsInsert,
        update: mockEventsUpdate,
        delete: mockEventsDelete,
      },
    });
  });

  describe('getCalendarClientForBusiness', () => {
    it('Test 3a: returns null when business.googleRefreshToken is null', () => {
      const client = getCalendarClientForBusiness(makeBusiness({ googleRefreshToken: null }));
      expect(client).toBeNull();
    });

    it('Test 3b: returns a non-null client with refresh_token set when googleRefreshToken is a non-null string', () => {
      const client = getCalendarClientForBusiness(makeBusiness({ googleRefreshToken: 'rt-abc' }));
      expect(client).not.toBeNull();
      expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: 'rt-abc' });
    });
  });

  describe('syncBookingToCalendar', () => {
    it('Test 4: no existing event -> calls events.insert with D-08 summary and Europe/Athens timeZone, stores event id, marks synced, resolves true', async () => {
      const booking = makeBooking({ googleCalendarEventId: null });
      mockEventsInsert.mockResolvedValue({ data: { id: 'gcal-event-1' } });

      const result = await syncBookingToCalendar(booking, makeBusiness(), SERVICE);

      expect(mockEventsInsert).toHaveBeenCalledTimes(1);
      const [args] = mockEventsInsert.mock.calls[0];
      expect(args.requestBody.summary).toBe('Reformer Pilates — Client 3941234567');
      expect(args.requestBody.start.timeZone).toBe('Europe/Athens');
      expect(mockedUpdateBookingGoogleEventId).toHaveBeenCalledWith(42, 'gcal-event-1');
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'synced');
      expect(result).toBe(true);
    });

    it('Test 5: existing event id -> calls events.update (not insert) with that eventId, does not call updateBookingGoogleEventId', async () => {
      const booking = makeBooking({ googleCalendarEventId: 'existing-event-id' });
      mockEventsUpdate.mockResolvedValue({ data: { id: 'existing-event-id' } });

      const result = await syncBookingToCalendar(booking, makeBusiness(), SERVICE);

      expect(mockEventsUpdate).toHaveBeenCalledTimes(1);
      const [args] = mockEventsUpdate.mock.calls[0];
      expect(args.eventId).toBe('existing-event-id');
      expect(mockEventsInsert).not.toHaveBeenCalled();
      expect(mockedUpdateBookingGoogleEventId).not.toHaveBeenCalled();
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'synced');
      expect(result).toBe(true);
    });

    it('Test 6: events.insert rejects -> resolves false (never throws), marks pending', async () => {
      const booking = makeBooking({ googleCalendarEventId: null });
      mockEventsInsert.mockRejectedValue(new Error('Google API down'));

      await expect(syncBookingToCalendar(booking, makeBusiness(), SERVICE)).resolves.toBe(false);
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'pending');
    });

    it('Test 7: business.googleRefreshToken is null -> resolves false without calling any calendar.events.* method', async () => {
      const booking = makeBooking();
      const business = makeBusiness({ googleRefreshToken: null });

      const result = await syncBookingToCalendar(booking, business, SERVICE);

      expect(result).toBe(false);
      expect(mockEventsInsert).not.toHaveBeenCalled();
      expect(mockEventsUpdate).not.toHaveBeenCalled();
    });
  });

  describe('deleteBookingFromCalendar', () => {
    it('Test 8: booking.googleCalendarEventId is null -> resolves true without calling any Calendar API method', async () => {
      const booking = makeBooking({ googleCalendarEventId: null });

      const result = await deleteBookingFromCalendar(booking, makeBusiness());

      expect(result).toBe(true);
      expect(mockEventsDelete).not.toHaveBeenCalled();
    });

    it('Test 9: calls events.delete with the stored eventId, marks synced, resolves true on success', async () => {
      const booking = makeBooking({ googleCalendarEventId: 'event-to-delete' });
      mockEventsDelete.mockResolvedValue({});

      const result = await deleteBookingFromCalendar(booking, makeBusiness());

      expect(mockEventsDelete).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'event-to-delete' })
      );
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'synced');
      expect(result).toBe(true);
    });

    it('deleteBookingFromCalendar resolves false (never throws) when events.delete rejects', async () => {
      const booking = makeBooking({ googleCalendarEventId: 'event-to-delete' });
      mockEventsDelete.mockRejectedValue(new Error('Google API down'));

      await expect(deleteBookingFromCalendar(booking, makeBusiness())).resolves.toBe(false);
      expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'pending');
    });
  });
});

jest.mock('../src/calendar/sync', () => ({
  syncBookingToCalendar: jest.fn(),
}));

jest.mock('../src/calendar/owner-nudge', () => ({
  maybeSendGoogleCalendarNudge: jest.fn(),
}));

jest.mock('../src/database/queries', () => ({
  findServiceById: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { syncBookingToCalendar } from '../src/calendar/sync';
import { maybeSendGoogleCalendarNudge } from '../src/calendar/owner-nudge';
import { findServiceById } from '../src/database/queries';
import { CALENDAR_RESCHEDULE_NOTE_GREEK } from '../src/calendar/client-link';
import { processBookingConfirmedForCalendar } from '../src/calendar/confirmation';
import { makeBooking, makeBusiness, makeService } from './helpers/calendar-fixtures';

const mockSync = syncBookingToCalendar as jest.MockedFunction<typeof syncBookingToCalendar>;
const mockNudge = maybeSendGoogleCalendarNudge as jest.MockedFunction<typeof maybeSendGoogleCalendarNudge>;
const mockFindService = findServiceById as jest.MockedFunction<typeof findServiceById>;

const SERVICE = makeService();

describe('processBookingConfirmedForCalendar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSync.mockReset();
    mockNudge.mockReset();
    mockFindService.mockReset();
    mockSync.mockResolvedValue(true);
    mockNudge.mockResolvedValue(true);
    mockFindService.mockResolvedValue(SERVICE);
  });

  it('Test 1: confirmed + token -> sync once, no nudge, message has a calendar render URL', async () => {
    const booking = makeBooking();
    const business = makeBusiness();

    const result = await processBookingConfirmedForCalendar({ booking, business, service: SERVICE });

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith(booking, business, SERVICE);
    expect(mockNudge).not.toHaveBeenCalled();
    expect(result.ownerSynced).toBe(true);
    expect(result.clientCalendarMessage).toContain('calendar.google.com/calendar/render');
  });

  it('Test 2 (CAL-09): no token -> sync still called, nudge called once, client link still produced', async () => {
    mockSync.mockResolvedValue(false);
    const business = makeBusiness({ googleRefreshToken: null });

    const result = await processBookingConfirmedForCalendar({
      booking: makeBooking(),
      business,
      service: SERVICE,
    });

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockNudge).toHaveBeenCalledTimes(1);
    expect(mockNudge).toHaveBeenCalledWith(business);
    expect(result.ownerSynced).toBe(false);
    expect(result.clientCalendarMessage).toContain('calendar.google.com/calendar/render');
  });

  it.each(['pending_owner_approval', 'rejected', 'cancelled'])(
    'Test 3 (D-02): %s booking -> empty message, no sync, no nudge',
    async (status) => {
      const result = await processBookingConfirmedForCalendar({
        booking: makeBooking({ bookingStatus: status as never }),
        business: makeBusiness({ googleRefreshToken: null }),
        service: SERVICE,
      });

      expect(result).toEqual({ clientCalendarMessage: '', ownerSynced: false });
      expect(mockSync).not.toHaveBeenCalled();
      expect(mockNudge).not.toHaveBeenCalled();
    }
  );

  it('Test 4: sync or nudge rejecting never throws and the link is still returned', async () => {
    mockSync.mockRejectedValue(new Error('sync boom'));
    mockNudge.mockRejectedValue(new Error('nudge boom'));

    const result = await processBookingConfirmedForCalendar({
      booking: makeBooking(),
      business: makeBusiness({ googleRefreshToken: null }),
      service: SERVICE,
    });

    expect(result.ownerSynced).toBe(false);
    expect(result.clientCalendarMessage).toContain('calendar.google.com/calendar/render');
  });

  it('Test 5: service omitted -> looked up; not found -> empty result and no sync', async () => {
    const booking = makeBooking();
    const business = makeBusiness();

    await processBookingConfirmedForCalendar({ booking, business });
    expect(mockFindService).toHaveBeenCalledWith(booking.businessId, booking.serviceId);
    expect(mockSync).toHaveBeenCalledWith(booking, business, SERVICE);

    mockSync.mockClear();
    mockFindService.mockResolvedValue(null);
    const result = await processBookingConfirmedForCalendar({ booking, business });
    expect(result).toEqual({ clientCalendarMessage: '', ownerSynced: false });
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('Test 6 (D-03): reschedule adds the removal note; a plain booking does not', async () => {
    const business = makeBusiness();

    const viaFk = await processBookingConfirmedForCalendar({
      booking: makeBooking({ rescheduledFromBookingId: 7 }),
      business,
      service: SERVICE,
    });
    expect(viaFk.clientCalendarMessage).toContain(CALENDAR_RESCHEDULE_NOTE_GREEK);

    const viaFlag = await processBookingConfirmedForCalendar({
      booking: makeBooking(),
      business,
      service: SERVICE,
      isReschedule: true,
    });
    expect(viaFlag.clientCalendarMessage).toContain(CALENDAR_RESCHEDULE_NOTE_GREEK);

    const plain = await processBookingConfirmedForCalendar({
      booking: makeBooking(),
      business,
      service: SERVICE,
    });
    expect(plain.clientCalendarMessage).not.toContain(CALENDAR_RESCHEDULE_NOTE_GREEK);
  });

  it('Test 7 (data minimisation): message carries neither the client phone nor a client name', async () => {
    const booking = makeBooking({ clientPhone: '3941234567' });

    const result = await processBookingConfirmedForCalendar({
      booking,
      business: makeBusiness(),
      service: SERVICE,
    });

    expect(result.clientCalendarMessage).not.toContain(booking.clientPhone);
    expect(result.clientCalendarMessage).not.toContain('Νίκος');
  });
});

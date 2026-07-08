import * as queries from '../src/database/queries';
import { checkAvailability } from '../src/business/availability';
import type { Service, BusinessHours, BookingSlot } from '../src/database/queries';

jest.mock('../src/database/queries');

const mockedFindServiceById = queries.findServiceById as jest.MockedFunction<
  typeof queries.findServiceById
>;
const mockedFindBusinessHoursForDay = queries.findBusinessHoursForDay as jest.MockedFunction<
  typeof queries.findBusinessHoursForDay
>;
const mockedFindActiveBookingSlotsForDate =
  queries.findActiveBookingSlotsForDate as jest.MockedFunction<
    typeof queries.findActiveBookingSlotsForDate
  >;
const mockedExpireStalePendingBookings = queries.expireStalePendingBookings as jest.MockedFunction<
  typeof queries.expireStalePendingBookings
>;

const BUSINESS_ID = 1;
// 2026-07-13 is a Monday (weekdayOfIsoDate === 1), matching the seeded
// Pilates Athens fixture's Monday hours (08:00-21:00).
const MONDAY_DATE = '2026-07-13';
// Far from MONDAY_DATE so the "don't offer a slot that already passed
// today" filter in checkAvailability never interferes with these tests.
const REFERENCE_NOW = new Date('2020-01-01T10:00:00Z');

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: 1,
    businessId: BUSINESS_ID,
    name: 'Ομαδικό Pilates',
    durationMin: 55,
    price: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeMondayHours(overrides: Partial<BusinessHours> = {}): BusinessHours {
  return {
    id: 1,
    businessId: BUSINESS_ID,
    dayOfWeek: 1,
    openTime: '08:00',
    closeTime: '21:00',
    isClosed: false,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedExpireStalePendingBookings.mockResolvedValue([]);
});

describe('checkAvailability', () => {
  it('Test 1: returns hourly 08:00..20:00 slots for a 55-minute service with zero existing bookings', async () => {
    mockedFindServiceById.mockResolvedValue(makeService({ id: 1, durationMin: 55 }));
    mockedFindBusinessHoursForDay.mockResolvedValue(makeMondayHours());
    mockedFindActiveBookingSlotsForDate.mockResolvedValue([]);

    const result = await checkAvailability(BUSINESS_ID, 1, MONDAY_DATE, REFERENCE_NOW);

    const expectedSlots = [
      '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00',
      '15:00', '16:00', '17:00', '18:00', '19:00', '20:00',
    ];
    expect(result).toEqual({ availableSlots: expectedSlots, closed: false });
  });

  it("Test 2: excludes 10:00 using the EXISTING booking's own 55-minute duration, not the requested 50-minute service's duration", async () => {
    // The existing booking is for a DIFFERENT (55-minute) service than the
    // one being requested here (50-minute) — findActiveBookingSlotsForDate
    // returns the existing booking's own durationMin, proving the conflict
    // check reads that field rather than the caller's requested duration.
    mockedFindServiceById.mockResolvedValue(makeService({ id: 2, durationMin: 50 }));
    mockedFindBusinessHoursForDay.mockResolvedValue(makeMondayHours());
    const existingBooking: BookingSlot = { calendarTime: '10:00', durationMin: 55, bookingId: 1 };
    mockedFindActiveBookingSlotsForDate.mockResolvedValue([existingBooking]);

    const result = await checkAvailability(BUSINESS_ID, 2, MONDAY_DATE, REFERENCE_NOW);

    expect(result.availableSlots).not.toContain('10:00');
    expect(result.closed).toBe(false);
  });

  it("Test 3: a 'rejected' booking does not occupy its slot (checkAvailability trusts findActiveBookingSlotsForDate's own status filter, applying no additional filtering)", async () => {
    // findActiveBookingSlotsForDate only ever returns
    // pending_owner_approval/confirmed rows — a rejected booking at 10:00
    // is never returned by it, so this mock returns an empty array, and
    // checkAvailability must not independently re-exclude 10:00.
    mockedFindServiceById.mockResolvedValue(makeService({ id: 1, durationMin: 55 }));
    mockedFindBusinessHoursForDay.mockResolvedValue(makeMondayHours());
    mockedFindActiveBookingSlotsForDate.mockResolvedValue([]);

    const result = await checkAvailability(BUSINESS_ID, 1, MONDAY_DATE, REFERENCE_NOW);

    expect(result.availableSlots).toContain('10:00');
  });

  it('Test 4: a closed day returns zero slots with closed: true', async () => {
    mockedFindServiceById.mockResolvedValue(makeService());
    mockedFindBusinessHoursForDay.mockResolvedValue(
      makeMondayHours({ dayOfWeek: 0, openTime: '00:00', closeTime: '00:00', isClosed: true })
    );

    const result = await checkAvailability(BUSINESS_ID, 1, '2026-07-12', REFERENCE_NOW);

    expect(result).toEqual({ availableSlots: [], closed: true });
  });

  it('Test 5: an unknown serviceId returns a structured service_not_found error, not a throw', async () => {
    mockedFindServiceById.mockResolvedValue(null);

    const result = await checkAvailability(BUSINESS_ID, 9999, MONDAY_DATE, REFERENCE_NOW);

    expect(result).toEqual({ availableSlots: [], closed: false, error: 'service_not_found' });
  });

  it('Test 6: sweeps stale pending bookings (2 hours) before reading active bookings', async () => {
    mockedFindServiceById.mockResolvedValue(makeService());
    mockedFindBusinessHoursForDay.mockResolvedValue(makeMondayHours());
    mockedFindActiveBookingSlotsForDate.mockResolvedValue([]);

    await checkAvailability(BUSINESS_ID, 1, MONDAY_DATE, REFERENCE_NOW);

    expect(mockedExpireStalePendingBookings).toHaveBeenCalledWith(BUSINESS_ID, 7200000);
  });

  it('does not throw and still returns a structured result when expireStalePendingBookings fails', async () => {
    mockedExpireStalePendingBookings.mockRejectedValue(new Error('db down'));
    mockedFindServiceById.mockResolvedValue(makeService());
    mockedFindBusinessHoursForDay.mockResolvedValue(makeMondayHours());
    mockedFindActiveBookingSlotsForDate.mockResolvedValue([]);

    const result = await checkAvailability(BUSINESS_ID, 1, MONDAY_DATE, REFERENCE_NOW);

    expect(result.closed).toBe(false);
    expect(result.availableSlots.length).toBeGreaterThan(0);
  });

  it('never offers a slot that has already passed today (Athens wall-clock)', async () => {
    mockedFindServiceById.mockResolvedValue(makeService({ durationMin: 55 }));
    mockedFindBusinessHoursForDay.mockResolvedValue(makeMondayHours());
    mockedFindActiveBookingSlotsForDate.mockResolvedValue([]);

    // 2026-07-13T11:30:00+03:00 Athens (summer, UTC+3) == 08:30:00Z.
    const todayReferenceNow = new Date('2026-07-13T08:30:00Z');

    const result = await checkAvailability(BUSINESS_ID, 1, MONDAY_DATE, todayReferenceNow);

    expect(result.availableSlots).not.toContain('08:00');
    expect(result.availableSlots).not.toContain('09:00');
    expect(result.availableSlots).not.toContain('10:00');
    expect(result.availableSlots).not.toContain('11:00');
    expect(result.availableSlots).toContain('12:00');
  });
});

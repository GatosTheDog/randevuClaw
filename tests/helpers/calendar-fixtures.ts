// Every Phase 25.1 calendar test builds its fixtures here so they stay
// type-correct when the Business/Booking/Service interfaces grow. Type-only
// import: no runtime dependency on the database layer.
import type { Booking, Business, Service } from '../../src/database/queries';

export function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: 1,
    name: 'Pilates Athens',
    slug: 'pilates-athens',
    phoneNumberId: null,
    ownerTelegramId: 'owner1',
    googleRefreshToken: 'refresh-token-1',
    agendaSentDate: null,
    botToken: 'bot-token-1',
    webhookId: 'webhook-id-1',
    webhookSecret: 'webhook-secret-1',
    enforcementPolicy: 'allow',
    bookingMode: 'fixed_sessions',
    allowMultiBooking: false,
    cancellationCutoffEnabled: false,
    cancellationCutoffHours: 8,
    slotlessRequestsEnabled: false,
    lastSessionThresholdEnabled: false,
    lastSessionThresholdCount: 1,
    onboardingCompleted: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 42,
    businessId: 1,
    clientPhone: '3941234567',
    serviceId: 2,
    sessionInstanceId: null,
    calendarDate: '2026-07-10',
    calendarTime: '10:00',
    bookingStatus: 'confirmed',
    requestId: 'request-id-1',
    ownerTelegramMessageId: null,
    rescheduledFromBookingId: null,
    calendarSyncStatus: 'pending',
    googleCalendarEventId: null,
    calendarSyncRetryCount: 0,
    reminder24hSentAt: null,
    reminder1hSentAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    expiresAt: null,
    ...overrides,
  };
}

export function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: 2,
    businessId: 1,
    name: 'Reformer Pilates',
    durationMin: 50,
    price: 3500,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

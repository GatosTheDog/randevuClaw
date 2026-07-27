// Phase 10 test fixtures — session catalog and instance helpers for integration tests.
// Uses admin db (bypasses RLS) for direct test data setup. Pattern: billing-fixtures.ts.

import { db } from '../../src/database/db';
import { sessionCatalog, sessionInstances, bookings } from '../../src/database/schema';
import { isoDateInAthens } from '../../src/utils/timezone';

export interface TestSessionCatalogOptions {
  rruleString?: string;
  startTime?: string;
  capacity?: number;
  isActive?: boolean;
}

export interface TestSessionInstanceOptions {
  sessionDate?: string;
  sessionTime?: string;
  bookedCount?: number;
  isCancelled?: boolean;
  idempotencyKey?: string;
}

/**
 * Inserts a session_catalog row directly for test setup.
 * Defaults: rruleString='FREQ=WEEKLY;BYDAY=MO', startTime='10:00', capacity=10, isActive=true.
 * Uses admin db (not getConn) to bypass RLS — matches billing-fixtures.ts pattern.
 */
export async function insertTestSessionCatalog(
  businessId: number,
  serviceId: number,
  overrides?: TestSessionCatalogOptions
): Promise<typeof sessionCatalog.$inferSelect> {
  const rows = await db
    .insert(sessionCatalog)
    .values({
      businessId,
      serviceId,
      rruleString: overrides?.rruleString ?? 'FREQ=WEEKLY;BYDAY=MO',
      startTime: overrides?.startTime ?? '10:00',
      capacity: overrides?.capacity !== undefined ? overrides.capacity : 10,
      isActive: overrides?.isActive !== undefined ? overrides.isActive : true,
    })
    .returning();
  return rows[0];
}

/**
 * Inserts a session_instances row directly for test setup.
 * Defaults: sessionDate=today in Athens, sessionTime='10:00', bookedCount=0,
 * isCancelled=false, idempotencyKey='test:{Date.now()}'.
 * Uses admin db (not getConn) to bypass RLS — matches billing-fixtures.ts pattern.
 */
export async function insertTestSessionInstance(
  catalogId: number,
  overrides?: TestSessionInstanceOptions
): Promise<typeof sessionInstances.$inferSelect> {
  const defaultDate = isoDateInAthens(new Date());
  const key = overrides?.idempotencyKey ?? `test:${catalogId}:${Date.now()}`;

  const rows = await db
    .insert(sessionInstances)
    .values({
      catalogId,
      sessionDate: overrides?.sessionDate ?? defaultDate,
      sessionTime: overrides?.sessionTime ?? '10:00',
      bookedCount: overrides?.bookedCount !== undefined ? overrides.bookedCount : 0,
      isCancelled: overrides?.isCancelled !== undefined ? overrides.isCancelled : false,
      idempotencyKey: key,
    })
    .returning();
  return rows[0];
}

export interface TestSessionBookingOptions {
  bookingStatus?: string;
  createdAt?: Date;
  calendarDate?: string;
  calendarTime?: string;
}

/**
 * Inserts a bookings row directly for test setup, with sessionInstanceId set
 * (a session-class booking). Needed because bookSessionInstance() always
 * uses defaultNow() for createdAt, but expiry tests need a booking whose
 * createdAt is backdated past the 2-hour expiry cutoff — mirrors the
 * direct-insert pattern in tests/cancellation-cutoff.test.ts.
 * Uses admin db (not getConn) to bypass RLS — matches this file's own pattern.
 */
export async function insertTestSessionBooking(
  businessId: number,
  sessionInstanceId: number,
  clientPhone: string,
  serviceId: number,
  overrides?: TestSessionBookingOptions
): Promise<typeof bookings.$inferSelect> {
  const defaultDate = isoDateInAthens(new Date());
  const requestId = `session-booking-fixture:${sessionInstanceId}:${clientPhone}:${Date.now()}:${Math.random()}`;

  const rows = await db
    .insert(bookings)
    .values({
      businessId,
      clientPhone,
      serviceId,
      sessionInstanceId,
      calendarDate: overrides?.calendarDate ?? defaultDate,
      calendarTime: overrides?.calendarTime ?? '10:00',
      bookingStatus: overrides?.bookingStatus ?? 'pending_owner_approval',
      requestId,
      createdAt: overrides?.createdAt ?? new Date(),
    })
    .returning();
  return rows[0];
}

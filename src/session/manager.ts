// Phase 10: Session Catalog query layer. All session DB operations for session_catalog
// and session_instances go through this module. Read functions use getConn() for
// RLS-enforced connections; write mutations use withBusinessContext + getConn().

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { sessionCatalog, sessionInstances, bookings } from '../database/schema';
import { getConn, withBusinessContext } from '../database/queries';
import { getActiveMembershipForDeduction, deductSession } from '../billing/queries';
import type { ActiveMembershipForDeduction } from '../billing/queries';
import { isoDateInAthens, addCalendarDays } from '../utils/timezone';
import { logger } from '../utils/logger';
import { RRule } from 'rrule';

// ---------------------------------------------------------------------------
// Exported TypeScript interfaces
// ---------------------------------------------------------------------------

export interface SessionInstance {
  instanceId: number;
  catalogId: number;
  sessionDate: string;
  sessionTime: string;
  bookedCount: number;
  capacity: number;
  serviceId: number;
}

export interface BookSessionResult {
  status: 'success' | 'full' | 'conflict';
  bookingId?: number;
}

// ---------------------------------------------------------------------------
// Greek weekday → RFC 5545 BYDAY code mapping
// ---------------------------------------------------------------------------

const GREEK_TO_BYDAY: Record<string, string> = {
  'Δευτέρα': 'MO',
  'Τρίτη': 'TU',
  'Τετάρτη': 'WE',
  'Πέμπτη': 'TH',
  'Παρασκευή': 'FR',
  'Σάββατο': 'SA',
  'Κυριακή': 'SU',
};

/**
 * Maps Greek weekday names to an RFC 5545 RRULE BYDAY string.
 * Unrecognized weekday strings are silently filtered out.
 */
export function buildRRuleString(weekdays: string[], startTime: string): string {
  const codes = weekdays
    .map((day) => GREEK_TO_BYDAY[day])
    .filter((code): code is string => code !== undefined);
  return `FREQ=WEEKLY;BYDAY=${codes.join(',')}`;
}

// ---------------------------------------------------------------------------
// createSessionCatalogWithExpansion
// ---------------------------------------------------------------------------

export async function createSessionCatalogWithExpansion(
  businessId: number,
  serviceId: number,
  rruleString: string,
  startTime: string,
  capacity: number,
  startDate?: string
): Promise<{ catalogId: number; instanceCount: number }> {
  let parsedRRule: ReturnType<typeof RRule.parseString>;
  try {
    parsedRRule = RRule.parseString(rruleString);
  } catch {
    throw new Error('Μη έγκυρο rrule pattern: ' + rruleString);
  }

  return withBusinessContext(businessId, async () => {
    const catalogRows = await getConn()
      .insert(sessionCatalog)
      .values({
        businessId,
        serviceId,
        rruleString,
        startTime,
        capacity,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [sessionCatalog.businessId, sessionCatalog.serviceId],
        targetWhere: sql`is_active = true`,
        set: { rruleString, startTime, capacity, isActive: true },
      })
      .returning({ id: sessionCatalog.id });

    const catalogId = catalogRows[0].id;

    const expansionStart = startDate ?? isoDateInAthens(new Date());
    const expansionEnd = addCalendarDays(expansionStart, 90);

    const rrule = new RRule({
      ...parsedRRule,
      dtstart: new Date(`${expansionStart}T${startTime}:00Z`),
    });

    const instances = rrule.between(
      new Date(`${expansionStart}T00:00:00Z`),
      new Date(`${expansionEnd}T23:59:59Z`)
    );

    if (instances.length > 0) {
      const sessionRows = instances.map((utcDate) => {
        const sessionDate = isoDateInAthens(utcDate);
        return {
          catalogId,
          sessionDate,
          sessionTime: startTime,
          bookedCount: 0,
          isCancelled: false,
          idempotencyKey: `catalog:${catalogId}:${sessionDate}:${startTime}`,
        };
      });

      await getConn()
        .insert(sessionInstances)
        .values(sessionRows)
        .onConflictDoNothing();
    }

    logger.info(
      { catalogId, instanceCount: instances.length, businessId },
      'session catalog expanded'
    );

    return { catalogId, instanceCount: instances.length };
  });
}

// ---------------------------------------------------------------------------
// bookSessionInstance
// ---------------------------------------------------------------------------

export async function bookSessionInstance(
  businessId: number,
  sessionInstanceId: number,
  clientPhone: string,
  serviceId: number,
  idempotencyKey: string,
  activeMembership?: ActiveMembershipForDeduction | null
): Promise<BookSessionResult> {
  return withBusinessContext(businessId, async () => {
    const instanceRows = await getConn()
      .select({
        id: sessionInstances.id,
        catalogId: sessionInstances.catalogId,
        sessionDate: sessionInstances.sessionDate,
        sessionTime: sessionInstances.sessionTime,
        bookedCount: sessionInstances.bookedCount,
        isCancelled: sessionInstances.isCancelled,
      })
      .from(sessionInstances)
      .where(
        and(
          eq(sessionInstances.id, sessionInstanceId),
          inArray(
            sessionInstances.catalogId,
            getConn()
              .select({ id: sessionCatalog.id })
              .from(sessionCatalog)
              .where(eq(sessionCatalog.businessId, businessId))
          )
        )
      )
      .for('update')
      .limit(1);

    const instance = instanceRows[0];

    if (!instance || instance.isCancelled) {
      return { status: 'conflict' };
    }

    const catalogRows = await getConn()
      .select({ capacity: sessionCatalog.capacity })
      .from(sessionCatalog)
      .where(eq(sessionCatalog.id, instance.catalogId))
      .limit(1);

    const capacity = catalogRows[0]?.capacity ?? 0;

    if (instance.bookedCount >= capacity) {
      return { status: 'full' };
    }

    const bookingRows = await getConn()
      .insert(bookings)
      .values({
        businessId,
        clientPhone,
        serviceId,
        sessionInstanceId,
        calendarDate: instance.sessionDate,
        calendarTime: instance.sessionTime,
        bookingStatus: 'confirmed',
        requestId: idempotencyKey,
        expiresAt: null,
      })
      .onConflictDoNothing()
      .returning({ id: bookings.id });

    if (bookingRows.length === 0) {
      const existingRows = await getConn()
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.requestId, idempotencyKey))
        .limit(1);
      return { status: 'success', bookingId: existingRows[0]?.id };
    }

    await getConn()
      .update(sessionInstances)
      .set({ bookedCount: sql`${sessionInstances.bookedCount} + 1` })
      .where(eq(sessionInstances.id, sessionInstanceId));

    const bookingId = bookingRows[0].id;

    const membership =
      activeMembership !== undefined
        ? activeMembership
        : await getActiveMembershipForDeduction(businessId, clientPhone);

    if (membership !== null && membership !== undefined && membership.sessionsRemaining !== null) {
      await deductSession(membership.id, bookingId, `booking:${bookingId}:deduction`);
      logger.info(
        { businessId, sessionInstanceId, clientPhone, membershipId: membership.id },
        'session credit deducted on session booking'
      );
    }

    return { status: 'success', bookingId };
  });
}

// ---------------------------------------------------------------------------
// cancelSession
// ---------------------------------------------------------------------------

export async function cancelSession(
  businessId: number,
  sessionInstanceId: number
): Promise<boolean> {
  return withBusinessContext(businessId, async () => {
    const rows = await getConn()
      .update(sessionInstances)
      .set({ isCancelled: true })
      .where(
        and(
          eq(sessionInstances.id, sessionInstanceId),
          eq(sessionInstances.isCancelled, false),
          inArray(
            sessionInstances.catalogId,
            getConn()
              .select({ id: sessionCatalog.id })
              .from(sessionCatalog)
              .where(eq(sessionCatalog.businessId, businessId))
          )
        )
      )
      .returning({ id: sessionInstances.id });

    return rows.length > 0;
  });
}

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

export async function listSessions(
  businessId: number,
  limitDays = 90
): Promise<SessionInstance[]> {
  const today = isoDateInAthens(new Date());
  const endDate = addCalendarDays(today, limitDays);

  const rows = await getConn()
    .select({
      instanceId: sessionInstances.id,
      catalogId: sessionInstances.catalogId,
      sessionDate: sessionInstances.sessionDate,
      sessionTime: sessionInstances.sessionTime,
      bookedCount: sessionInstances.bookedCount,
      capacity: sessionCatalog.capacity,
      serviceId: sessionCatalog.serviceId,
    })
    .from(sessionInstances)
    .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
    .where(
      and(
        eq(sessionCatalog.businessId, businessId),
        eq(sessionInstances.isCancelled, false),
        gte(sessionInstances.sessionDate, today),
        sql`${sessionInstances.sessionDate} <= ${endDate}`
      )
    )
    .orderBy(sessionInstances.sessionDate, sessionInstances.sessionTime)
    .limit(200);

  return rows;
}

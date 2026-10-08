// quick-261008-gqb: list_previous_month_slots tool + credit-safe multi-booking helper.
// Integration tests against a REAL local Postgres connection (same harness as
// tests/session-booking-flow.test.ts).

const TEST_DATABASE_URL =
  process.env.SESSION_TEST_DATABASE_URL ??
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db } = require('../src/database/db');
const { eq, and } = require('drizzle-orm');
const { memberships, membershipLedger, bookings, services, businesses } = require('../src/database/schema');
const { executeTool } = require('../src/conversation/function-executor');
const { previousMonthRange, GREEK_WEEKDAY_NAMES } = require('../src/session/rebook');
const { isoDateInAthens, addCalendarDays, weekdayOfIsoDate } = require('../src/utils/timezone');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
const {
  insertTestSessionCatalog,
  insertTestSessionInstance,
  insertTestSessionBooking,
} = require('./helpers/session-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

let counter = 0;
function uniquePhone(): string {
  counter += 1;
  return `rebook-client-${Date.now()}-${counter}-${Math.random().toString(36).slice(2)}`;
}

function buildToolContext(
  business: { id: number; name: string },
  clientPhone: string,
  overrides: { enforcementPolicy?: string; bookingMode?: string; allowMultiBooking?: boolean } = {}
) {
  counter += 1;
  return {
    business: {
      id: business.id,
      name: business.name ?? 'Test Business',
      ownerTelegramId: null,
      enforcementPolicy: overrides.enforcementPolicy ?? 'allow',
      bookingMode: overrides.bookingMode ?? 'fixed_sessions',
      allowMultiBooking: overrides.allowMultiBooking ?? true,
    },
    clientPhone,
    requestId: 'rebook-req-' + counter,
    idempotencyKey: `rebook-idem-${Date.now()}-${counter}`,
  };
}

/** First date >= fromIso (inclusive) with the given weekday (0=Sunday). */
function firstWeekdayOnOrAfter(fromIso: string, weekday: number): string {
  let d = fromIso;
  while (weekdayOfIsoDate(d) !== weekday) d = addCalendarDays(d, 1);
  return d;
}

interface Scenario {
  business: { id: number; name: string };
  serviceId: number;
  catalogId: number;
  clientPhone: string;
  mondays: { id: number; date: string }[];
  wednesdays: { id: number; date: string }[];
  thursday: { id: number; date: string };
}

async function setupScenario(opts: { withDistractors?: boolean } = {}): Promise<Scenario> {
  const business = await insertTestBusiness();
  await db.update(businesses).set({ allowMultiBooking: true }).where(eq(businesses.id, business.id));
  const svcRows = await db.select({ id: services.id }).from(services).where(eq(services.businessId, business.id)).limit(1);
  const serviceId = svcRows[0].id as number;
  const catalog = await insertTestSessionCatalog(business.id, serviceId, { capacity: 10 });
  const catalogId = catalog.id as number;
  const clientPhone = uniquePhone();

  const today = isoDateInAthens(new Date());
  const range = previousMonthRange(today);

  // Previous month: two Mondays 18:00 and one Wednesday 19:00, all confirmed.
  const prevMon1 = firstWeekdayOnOrAfter(range.start, 1);
  const prevMon2 = addCalendarDays(prevMon1, 7);
  const prevWed1 = firstWeekdayOnOrAfter(range.start, 3);
  let seq = 0;
  const key = (label: string) => `rebook:${label}:${catalogId}:${++seq}:${Math.random()}`;

  const past: { date: string; time: string }[] = [
    { date: prevMon1, time: '18:00' },
    { date: prevMon2, time: '18:00' },
    { date: prevWed1, time: '19:00' },
  ];
  for (const p of past) {
    const inst = await insertTestSessionInstance(catalogId, {
      sessionDate: p.date,
      sessionTime: p.time,
      idempotencyKey: key('past'),
    });
    await insertTestSessionBooking(business.id, inst.id, clientPhone, serviceId, {
      bookingStatus: 'confirmed',
      calendarDate: p.date,
      calendarTime: p.time,
    });
  }

  if (opts.withDistractors) {
    const otherPhone = uniquePhone();
    const dayBeforeRange = addCalendarDays(range.start, -1);
    const firstOfCurrent = `${today.slice(0, 8)}01`;
    const distractors: { date: string; time: string; status: string; phone: string }[] = [
      { date: addCalendarDays(range.start, 2), time: '07:00', status: 'cancelled', phone: clientPhone },
      { date: addCalendarDays(range.start, 3), time: '08:00', status: 'pending_owner_approval', phone: clientPhone },
      { date: addCalendarDays(range.start, 4), time: '11:00', status: 'confirmed', phone: otherPhone },
      { date: dayBeforeRange, time: '12:00', status: 'confirmed', phone: clientPhone },
      { date: firstOfCurrent, time: '13:00', status: 'confirmed', phone: clientPhone },
    ];
    for (const d of distractors) {
      const inst = await insertTestSessionInstance(catalogId, {
        sessionDate: d.date,
        sessionTime: d.time,
        idempotencyKey: key('distractor'),
      });
      await insertTestSessionBooking(business.id, inst.id, d.phone, serviceId, {
        bookingStatus: d.status,
        calendarDate: d.date,
        calendarTime: d.time,
      });
    }
  }

  // Upcoming: next two Mondays 18:00, next two Wednesdays 19:00, one Thursday 20:00.
  const tomorrow = addCalendarDays(today, 1);
  const mon1 = firstWeekdayOnOrAfter(tomorrow, 1);
  const wed1 = firstWeekdayOnOrAfter(tomorrow, 3);
  const thu1 = firstWeekdayOnOrAfter(tomorrow, 4);
  const mk = async (date: string, time: string, extra: { bookedCount?: number } = {}) => {
    const inst = await insertTestSessionInstance(catalogId, {
      sessionDate: date,
      sessionTime: time,
      bookedCount: extra.bookedCount,
      idempotencyKey: key('up'),
    });
    return { id: inst.id as number, date };
  };
  const mondays = [await mk(mon1, '18:00'), await mk(addCalendarDays(mon1, 7), '18:00')];
  const wednesdays = [await mk(wed1, '19:00'), await mk(addCalendarDays(wed1, 7), '19:00')];
  const thursday = await mk(thu1, '20:00');

  return { business, serviceId, catalogId, clientPhone, mondays, wednesdays, thursday };
}

async function giveMembership(s: Scenario, overrides: { sessionsRemaining?: number | null; expiresAt?: Date } = {}) {
  const pkg = await insertTestPackage(s.business.id, { sessionCount: 10 });
  return insertTestMembership(s.business.id, s.clientPhone, pkg.id, overrides);
}

describe('list_previous_month_slots', () => {
  it('1. returns previous weekly slots with upcoming instances and alternatives', async () => {
    const s = await setupScenario();
    const result = await executeTool(
      'list_previous_month_slots',
      { business_id: s.business.id },
      buildToolContext(s.business, s.clientPhone)
    );

    expect(result.success).toBe(true);
    expect(result.has_previous_slots).toBe(true);
    expect(result.previous_slots).toHaveLength(2);

    const [mon, wed] = result.previous_slots;
    expect(mon.weekday_name).toBe('Δευτέρα');
    expect(mon.time).toBe('18:00');
    expect(mon.previous_month_count).toBe(2);
    expect(mon.upcoming_instances.map((i: { instance_id: number }) => i.instance_id)).toEqual(
      s.mondays.map((m) => m.id)
    );
    expect(wed.weekday_name).toBe('Τετάρτη');
    expect(wed.previous_month_count).toBe(1);

    const otherNames = result.other_weekly_slots.map((o: { weekday_name: string }) => o.weekday_name);
    expect(otherNames).toContain('Πέμπτη');
    expect(otherNames).not.toContain('Δευτέρα');
    expect(otherNames).not.toContain('Τετάρτη');
    const thursdaySlot = result.other_weekly_slots.find((o: { weekday_name: string }) => o.weekday_name === 'Πέμπτη');
    expect(thursdaySlot.upcoming_instances[0].instance_id).toBe(s.thursday.id);

    expect(result.summary_lines).toHaveLength(2);
    expect(result.summary_lines[0].startsWith('Δευτέρα')).toBe(true);
    expect(result.summary_lines[1].startsWith('Τετάρτη')).toBe(true);
    expect(typeof result.suggested_question).toBe('string');
    expect(result.suggested_question.length).toBeGreaterThan(0);

    for (const slot of [...result.previous_slots, ...result.other_weekly_slots]) {
      for (const inst of slot.upcoming_instances) {
        expect(GREEK_WEEKDAY_NAMES[weekdayOfIsoDate(inst.session_date)]).toBe(slot.weekday_name);
      }
    }
  });

  it('2. ignores cancelled/pending/other-client/out-of-range history; empty history gives has_previous_slots false', async () => {
    const s = await setupScenario({ withDistractors: true });
    const result = await executeTool(
      'list_previous_month_slots',
      { business_id: s.business.id },
      buildToolContext(s.business, s.clientPhone)
    );
    expect(result.success).toBe(true);
    expect(result.previous_slots).toHaveLength(2);
    expect(result.previous_slots.map((p: { weekday_name: string }) => p.weekday_name)).toEqual(['Δευτέρα', 'Τετάρτη']);
    expect(result.previous_slots[0].previous_month_count).toBe(2);
    expect(result.previous_slots[1].previous_month_count).toBe(1);

    const empty = await executeTool(
      'list_previous_month_slots',
      { business_id: s.business.id },
      buildToolContext(s.business, uniquePhone())
    );
    expect(empty.success).toBe(true);
    expect(empty.has_previous_slots).toBe(false);
    expect(typeof empty.message).toBe('string');
    expect(empty.message.length).toBeGreaterThan(0);
  });

  it('3. reports already_booked, full and after_membership_expiry instances as unavailable', async () => {
    const s = await setupScenario();
    // Client already holds the first Monday (pending).
    await insertTestSessionBooking(s.business.id, s.mondays[0].id, s.clientPhone, s.serviceId, {
      bookingStatus: 'pending_owner_approval',
      calendarDate: s.mondays[0].date,
      calendarTime: '18:00',
    });
    // Expiry between the two upcoming Mondays.
    const expiry = new Date(`${addCalendarDays(s.mondays[0].date, 3)}T12:00:00Z`);
    await giveMembership(s, { expiresAt: expiry, sessionsRemaining: 10 });

    // A full Wednesday instance (same catalog): make the first Wednesday full.
    const { sessionInstances } = require('../src/database/schema');
    await db.update(sessionInstances).set({ bookedCount: 10 }).where(eq(sessionInstances.id, s.wednesdays[0].id));

    const result = await executeTool(
      'list_previous_month_slots',
      { business_id: s.business.id },
      buildToolContext(s.business, s.clientPhone)
    );
    expect(result.success).toBe(true);
    const mon = result.previous_slots[0];
    const reasons = mon.unavailable.map((u: { session_date: string; reason: string }) => [u.session_date, u.reason]);
    expect(reasons).toContainEqual([s.mondays[0].date, 'already_booked']);
    expect(reasons).toContainEqual([s.mondays[1].date, 'after_membership_expiry']);
    expect(mon.upcoming_instances).toEqual([]);

    const wed = result.previous_slots[1];
    expect(wed.unavailable.map((u: { session_date: string; reason: string }) => [u.session_date, u.reason])).toContainEqual([
      s.wednesdays[0].date,
      s.wednesdays[0].date > isoDateInAthens(expiry) ? 'after_membership_expiry' : 'full',
    ]);
  });

  it('3b. a full instance within membership validity is reported as full', async () => {
    const s = await setupScenario();
    await giveMembership(s, { sessionsRemaining: 10 });
    const { sessionInstances } = require('../src/database/schema');
    await db.update(sessionInstances).set({ bookedCount: 10 }).where(eq(sessionInstances.id, s.mondays[0].id));
    const result = await executeTool(
      'list_previous_month_slots',
      { business_id: s.business.id },
      buildToolContext(s.business, s.clientPhone)
    );
    const mon = result.previous_slots[0];
    expect(mon.unavailable).toContainEqual({
      session_date: s.mondays[0].date,
      session_time: '18:00',
      reason: 'full',
    });
    expect(mon.upcoming_instances.map((i: { instance_id: number }) => i.instance_id)).toEqual([s.mondays[1].id]);
  });

  it('4. gating errors', async () => {
    const s = await setupScenario();

    const disabled = await executeTool(
      'list_previous_month_slots',
      { business_id: s.business.id },
      buildToolContext(s.business, s.clientPhone, { allowMultiBooking: false })
    );
    expect(disabled.success).toBe(false);
    expect(disabled.error).toBe('multi_booking_disabled');

    const open = await executeTool(
      'list_previous_month_slots',
      { business_id: s.business.id },
      buildToolContext(s.business, s.clientPhone, { bookingMode: 'open_slots' })
    );
    expect(open.success).toBe(false);
    expect(open.error).toBe('not_fixed_sessions');

    const blocked = await executeTool(
      'list_previous_month_slots',
      { business_id: s.business.id },
      buildToolContext(s.business, s.clientPhone, { enforcementPolicy: 'block' })
    );
    expect(blocked.success).toBe(false);
    expect(blocked.error).toBe('no_membership');

    const cross = await executeTool(
      'list_previous_month_slots',
      { business_id: s.business.id + 999999 },
      buildToolContext(s.business, s.clientPhone)
    );
    expect(cross.error).toBe('cross_tenant_denied');
  });

  it('5. reports membership credits', async () => {
    const s = await setupScenario();
    await giveMembership(s, { sessionsRemaining: 2 });
    const finite = await executeTool(
      'list_previous_month_slots',
      { business_id: s.business.id },
      buildToolContext(s.business, s.clientPhone)
    );
    expect(finite.membership.sessions_remaining).toBe(2);
    expect(finite.max_bookable).toBe(2);
    expect(finite.total_proposed_sessions).toBe(4);
    expect(finite.exceeds_credits).toBe(true);

    const s2 = await setupScenario();
    await giveMembership(s2, { sessionsRemaining: null });
    const unlimited = await executeTool(
      'list_previous_month_slots',
      { business_id: s2.business.id },
      buildToolContext(s2.business, s2.clientPhone)
    );
    expect(unlimited.membership.sessions_remaining).toBeNull();
    expect(unlimited.max_bookable).toBeNull();
    expect(unlimited.exceeds_credits).toBe(false);
  });

  it('6. end to end: rebooking the proposed instances via book_session', async () => {
    const s = await setupScenario();
    const membership = await giveMembership(s, { sessionsRemaining: 10 });
    const ctx = buildToolContext(s.business, s.clientPhone);
    const listed = await executeTool('list_previous_month_slots', { business_id: s.business.id }, ctx);
    const ids: number[] = listed.previous_slots.flatMap((p: { upcoming_instances: { instance_id: number }[] }) =>
      p.upcoming_instances.map((i) => i.instance_id)
    );
    expect(ids).toHaveLength(4);

    const booked = await executeTool('book_session', { business_id: s.business.id, session_instance_ids: ids }, ctx);
    expect(booked.success).toBe(true);
    expect(booked.booked_count).toBe(ids.length);
    expect(booked.insufficient_credit_instance_ids).toEqual([]);

    const rows = await db
      .select()
      .from(bookings)
      .where(and(eq(bookings.businessId, s.business.id), eq(bookings.clientPhone, s.clientPhone), eq(bookings.bookingStatus, 'pending_owner_approval')));
    expect(rows).toHaveLength(ids.length);

    const m = await db.select({ r: memberships.sessionsRemaining }).from(memberships).where(eq(memberships.id, membership.id));
    expect(m[0].r).toBe(10 - ids.length);

    const again = await executeTool('list_previous_month_slots', { business_id: s.business.id }, buildToolContext(s.business, s.clientPhone));
    for (const slot of again.previous_slots) {
      expect(slot.upcoming_instances).toEqual([]);
      expect(slot.unavailable.every((u: { reason: string }) => u.reason === 'already_booked')).toBe(true);
    }
  });

  it('7. book_session multi path stops at remaining credits', async () => {
    const s = await setupScenario();
    const membership = await giveMembership(s, { sessionsRemaining: 2 });
    const ctx = buildToolContext(s.business, s.clientPhone);
    // Supplied out of chronological order on purpose.
    const ids = [s.wednesdays[0].id, s.mondays[1].id, s.mondays[0].id];
    const chronological = [
      { id: s.mondays[0].id, date: s.mondays[0].date, t: '18:00' },
      { id: s.mondays[1].id, date: s.mondays[1].date, t: '18:00' },
      { id: s.wednesdays[0].id, date: s.wednesdays[0].date, t: '19:00' },
    ].sort((a, b) => (a.date + a.t < b.date + b.t ? -1 : 1));

    const result = await executeTool('book_session', { business_id: s.business.id, session_instance_ids: ids }, ctx);
    expect(result.booked_count).toBe(2);
    expect(result.insufficient_credit_instance_ids).toEqual([chronological[2].id]);
    expect(result.booked_instance_ids).toEqual([chronological[0].id, chronological[1].id]);

    const m = await db.select({ r: memberships.sessionsRemaining }).from(memberships).where(eq(memberships.id, membership.id));
    expect(m[0].r).toBe(0);
    const ledger = await db
      .select()
      .from(membershipLedger)
      .where(and(eq(membershipLedger.membershipId, membership.id), eq(membershipLedger.operationType, 'session_deducted')));
    expect(ledger).toHaveLength(2);
  });

  it('8. duplicate ids are booked once', async () => {
    const s = await setupScenario();
    await giveMembership(s, { sessionsRemaining: 5 });
    const ctx = buildToolContext(s.business, s.clientPhone);
    const result = await executeTool(
      'book_session',
      { business_id: s.business.id, session_instance_ids: [s.mondays[0].id, s.mondays[0].id, s.mondays[1].id, s.mondays[1].id] },
      ctx
    );
    expect(result.booked_count).toBe(2);
    expect(result.conflict_instance_ids).toEqual([]);
  });
});

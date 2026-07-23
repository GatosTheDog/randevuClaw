// covers CANC-01, CANC-02, CANC-03, CANC-04, CANC-05
// Integration tests against a REAL local Postgres connection.
// Requires migrations 0006 (billing), 0007 (enforcement), 0010 (session catalog),
// and the cancellation_cutoff columns on businesses to be applied.
//
// Setup (one-time, local dev machine):
//   psql postgresql://manolis@localhost:5432/randevuclaw_test \
//     -f migrations/0010_session_catalog_schema.sql

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
const {
  businesses,
  membershipLedger,
  bookings,
  services,
} = require('../src/database/schema');
const { executeTool } = require('../src/conversation/function-executor');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
const {
  insertTestSessionCatalog,
  insertTestSessionInstance,
} = require('./helpers/session-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniquePhone(): string {
  return `cutoff-client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Compute Athens wall-clock date and time N hours from now.
 * Uses Intl.DateTimeFormat to convert the future timestamp to Europe/Athens
 * date/time components — correctly handles DST boundaries.
 */
function athensTimeNHoursFromNow(hoursFromNow: number): { sessionDate: string; sessionTime: string } {
  const futureMs = Date.now() + hoursFromNow * 3_600_000;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(futureMs));
  const get = (t: string) => parts.find((p: { type: string; value: string }) => p.type === t)!.value;
  const sessionDate = `${get('year')}-${get('month')}-${get('day')}`;
  // hour12: false may produce "24" for midnight; normalise to "00"
  const rawHour = get('hour');
  const sessionTime = `${rawHour === '24' ? '00' : rawHour.padStart(2, '0')}:${get('minute')}`;
  return { sessionDate, sessionTime };
}

/**
 * Build a ToolContext with cutoff fields.
 * Mirrors the buildToolContext helper in session-booking-flow.test.ts and
 * extends it with Phase 12 cancellationCutoff fields.
 */
function buildToolContextWithCutoff(
  business: {
    id: number;
    name: string;
    enforcementPolicy?: string;
    bookingMode?: string;
    allowMultiBooking?: boolean;
  },
  clientPhone: string,
  cutoffEnabled: boolean,
  cutoffHours: number,
  idempotencyKey?: string
) {
  return {
    business: {
      id: business.id,
      name: business.name ?? 'Test Business',
      ownerTelegramId: null,
      enforcementPolicy: business.enforcementPolicy ?? 'allow',
      bookingMode: business.bookingMode ?? 'fixed_sessions',
      allowMultiBooking: business.allowMultiBooking ?? false,
      cancellationCutoffEnabled: cutoffEnabled,
      cancellationCutoffHours: cutoffHours,
    },
    clientPhone,
    requestId: 'test-req-' + Date.now(),
    idempotencyKey: idempotencyKey ?? 'test-idem-' + Date.now(),
  };
}

async function getTestServiceId(businessId: number): Promise<number> {
  const rows = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.businessId, businessId))
    .limit(1);
  return rows[0].id as number;
}

/**
 * Insert a confirmed booking linked to a session instance, plus a membership
 * and a session_deducted ledger row (simulates the state after a booking was
 * made and credit was deducted at booking time).
 *
 * Returns { bookingId, membership }.
 */
async function setupConfirmedBookingWithDeduction(
  businessId: number,
  clientPhone: string,
  serviceId: number,
  packageId: number,
  catalogId: number,
  sessionDate: string,
  sessionTime: string
) {
  // Insert session instance
  const instance = await insertTestSessionInstance(catalogId, {
    sessionDate,
    sessionTime,
    idempotencyKey: `cutoff-inst:${catalogId}:${Date.now()}:${Math.random()}`,
  });

  // Insert confirmed booking linked to this session instance.
  // Each test uses unique clientPhone + unique requestId to avoid unique index violations.
  const bookingRows = await db
    .insert(bookings)
    .values({
      businessId,
      clientPhone,
      serviceId,
      sessionInstanceId: instance.id,
      calendarDate: sessionDate,
      calendarTime: sessionTime,
      bookingStatus: 'confirmed',
      requestId: `cutoff-req-${Date.now()}-${Math.random()}`,
    })
    .returning();
  const bookingId = bookingRows[0].id as number;

  // Insert membership
  const membership = await insertTestMembership(businessId, clientPhone, packageId, {
    sessionsRemaining: 5,
  });

  // Insert session_deducted ledger row to simulate the deduction at booking time.
  // findMembershipByBooking looks for operationType='session_deducted' with this bookingId.
  await db.insert(membershipLedger).values({
    membershipId: membership.id,
    bookingId,
    operationType: 'session_deducted',
    sessionsDeducted: 1,
    idempotencyKey: `deduct-${bookingId}-${Date.now()}`,
  });

  return { bookingId, membership };
}

// ---------------------------------------------------------------------------
// Test 1 — CANC-03: outside cutoff window → credit restored
// ---------------------------------------------------------------------------

describe('CANC-03: cancellation outside cutoff window restores credit', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;
  let packageId: number;
  let clientPhone: string;
  let bookingId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;

    // Set cancellationCutoffEnabled=true, cutoffHours=8
    await db
      .update(businesses)
      .set({ cancellationCutoffEnabled: true, cancellationCutoffHours: 8 })
      .where(eq(businesses.id, businessId));

    serviceId = await getTestServiceId(businessId);

    const catalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 10 });
    catalogId = catalog.id;

    const pkg = await insertTestPackage(businessId, {
      name: `CANC-03 pkg ${Date.now()}`,
      sessionCount: 10,
    });
    packageId = pkg.id;

    clientPhone = uniquePhone();

    // Session 7 days from now — well outside the 8h cutoff window
    const { sessionDate, sessionTime } = athensTimeNHoursFromNow(7 * 24);

    const setup = await setupConfirmedBookingWithDeduction(
      businessId,
      clientPhone,
      serviceId,
      packageId,
      catalogId,
      sessionDate,
      sessionTime
    );
    bookingId = setup.bookingId;
  });

  it('outside window — success=true, no credit_forfeited, credit_restored row created', async () => {
    const context = buildToolContextWithCutoff(
      { id: businessId, name: 'Test Business' },
      clientPhone,
      true,
      8
    );

    const result = await executeTool(
      'cancel_appointment',
      { business_id: businessId, booking_id: bookingId },
      context
    );

    expect(result.success).toBe(true);
    expect(result.credit_forfeited).toBeFalsy();

    // Assert credit_restored ledger row exists for this booking
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.bookingId, bookingId),
          eq(membershipLedger.operationType, 'credit_restored')
        )
      );
    expect(ledgerRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — CANC-05: inside window, first call (no confirmed) → pending_confirmation
// ---------------------------------------------------------------------------

describe('CANC-05: inside window, first call → pending_confirmation, no DB mutation', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;
  let packageId: number;
  let clientPhone: string;
  let bookingId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;

    await db
      .update(businesses)
      .set({ cancellationCutoffEnabled: true, cancellationCutoffHours: 8 })
      .where(eq(businesses.id, businessId));

    serviceId = await getTestServiceId(businessId);

    const catalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 10 });
    catalogId = catalog.id;

    const pkg = await insertTestPackage(businessId, {
      name: `CANC-05 pkg ${Date.now()}`,
      sessionCount: 10,
    });
    packageId = pkg.id;

    clientPhone = uniquePhone();

    // Session 2 hours from now in Athens — inside the 8h cutoff window
    const { sessionDate, sessionTime } = athensTimeNHoursFromNow(2);

    const setup = await setupConfirmedBookingWithDeduction(
      businessId,
      clientPhone,
      serviceId,
      packageId,
      catalogId,
      sessionDate,
      sessionTime
    );
    bookingId = setup.bookingId;
  });

  it('first call without confirmed → pending_confirmation=true, booking still confirmed, no credit_restored', async () => {
    const context = buildToolContextWithCutoff(
      { id: businessId, name: 'Test Business' },
      clientPhone,
      true,
      8
    );

    const result = await executeTool(
      'cancel_appointment',
      { business_id: businessId, booking_id: bookingId },
      context
    );

    expect(result.pending_confirmation).toBe(true);
    // warning must mention 'session' (cutoff warning message contains the word)
    expect(typeof result.warning).toBe('string');
    expect((result.warning as string).toLowerCase()).toContain('session');

    // Booking must still be 'confirmed' — no DB mutation occurred
    const bookingRows = await db
      .select({ bookingStatus: bookings.bookingStatus })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(bookingRows[0].bookingStatus).toBe('confirmed');

    // No credit_restored ledger row should exist
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.bookingId, bookingId),
          eq(membershipLedger.operationType, 'credit_restored')
        )
      );
    expect(ledgerRows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — CANC-04: inside window, confirmed=true → credit forfeited
// ---------------------------------------------------------------------------

describe('CANC-04: inside window, confirmed=true → credit forfeited, no credit_restored', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;
  let packageId: number;
  let clientPhone: string;
  let bookingId: number;

  // SEPARATE beforeAll — owns its own booking, not shared with Test 2
  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;

    await db
      .update(businesses)
      .set({ cancellationCutoffEnabled: true, cancellationCutoffHours: 8 })
      .where(eq(businesses.id, businessId));

    serviceId = await getTestServiceId(businessId);

    const catalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 10 });
    catalogId = catalog.id;

    const pkg = await insertTestPackage(businessId, {
      name: `CANC-04 pkg ${Date.now()}`,
      sessionCount: 10,
    });
    packageId = pkg.id;

    clientPhone = uniquePhone();

    // Session 2 hours from now — inside the 8h cutoff window
    const { sessionDate, sessionTime } = athensTimeNHoursFromNow(2);

    const setup = await setupConfirmedBookingWithDeduction(
      businessId,
      clientPhone,
      serviceId,
      packageId,
      catalogId,
      sessionDate,
      sessionTime
    );
    bookingId = setup.bookingId;
  });

  it('confirmed=true inside window → success, credit_forfeited=true, booking cancelled, no credit_restored row', async () => {
    const context = buildToolContextWithCutoff(
      { id: businessId, name: 'Test Business' },
      clientPhone,
      true,
      8
    );

    const result = await executeTool(
      'cancel_appointment',
      { business_id: businessId, booking_id: bookingId, confirmed: true },
      context
    );

    expect(result.success).toBe(true);
    expect(result.credit_forfeited).toBe(true);

    // Booking must be 'cancelled'
    const bookingRows = await db
      .select({ bookingStatus: bookings.bookingStatus })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    expect(bookingRows[0].bookingStatus).toBe('cancelled');

    // NO credit_restored ledger row for this booking
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.bookingId, bookingId),
          eq(membershipLedger.operationType, 'credit_restored')
        )
      );
    expect(ledgerRows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — CANC-01: cutoff disabled → always restore credit
// ---------------------------------------------------------------------------

describe('CANC-01: cutoff disabled → credit always restored regardless of timing', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;
  let packageId: number;
  let clientPhone: string;
  let bookingId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;

    // cancellationCutoffEnabled=false (opt-out, restore always)
    await db
      .update(businesses)
      .set({ cancellationCutoffEnabled: false, cancellationCutoffHours: 8 })
      .where(eq(businesses.id, businessId));

    serviceId = await getTestServiceId(businessId);

    const catalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 10 });
    catalogId = catalog.id;

    const pkg = await insertTestPackage(businessId, {
      name: `CANC-01 pkg ${Date.now()}`,
      sessionCount: 10,
    });
    packageId = pkg.id;

    clientPhone = uniquePhone();

    // Session 1 hour from now — would be inside the 8h window if cutoff were enabled
    const { sessionDate, sessionTime } = athensTimeNHoursFromNow(1);

    const setup = await setupConfirmedBookingWithDeduction(
      businessId,
      clientPhone,
      serviceId,
      packageId,
      catalogId,
      sessionDate,
      sessionTime
    );
    bookingId = setup.bookingId;
  });

  it('cutoff disabled → success, no credit_forfeited, credit_restored row created', async () => {
    // Context explicitly carries cutoffEnabled=false
    const context = buildToolContextWithCutoff(
      { id: businessId, name: 'Test Business' },
      clientPhone,
      false,
      8
    );

    const result = await executeTool(
      'cancel_appointment',
      { business_id: businessId, booking_id: bookingId },
      context
    );

    expect(result.success).toBe(true);
    expect(result.credit_forfeited).toBeFalsy();

    // credit_restored row must exist
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.bookingId, bookingId),
          eq(membershipLedger.operationType, 'credit_restored')
        )
      );
    expect(ledgerRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — CANC-02: owner toggles cutoff off → credit restored on next cancel
// ---------------------------------------------------------------------------

describe('CANC-02: owner toggles cutoff off → subsequent cancellations restore credit', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;
  let packageId: number;
  let clientPhone: string;
  let bookingId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;

    // Business starts with cutoff enabled (4h window)
    await db
      .update(businesses)
      .set({ cancellationCutoffEnabled: true, cancellationCutoffHours: 4 })
      .where(eq(businesses.id, businessId));

    serviceId = await getTestServiceId(businessId);

    const catalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 10 });
    catalogId = catalog.id;

    const pkg = await insertTestPackage(businessId, {
      name: `CANC-02 pkg ${Date.now()}`,
      sessionCount: 10,
    });
    packageId = pkg.id;

    clientPhone = uniquePhone();

    // Session 1 hour from now — inside the 4h window
    const { sessionDate, sessionTime } = athensTimeNHoursFromNow(1);

    const setup = await setupConfirmedBookingWithDeduction(
      businessId,
      clientPhone,
      serviceId,
      packageId,
      catalogId,
      sessionDate,
      sessionTime
    );
    bookingId = setup.bookingId;

    // Simulate owner toggling cutoff OFF (admin DB update — owner changed their mind)
    await db
      .update(businesses)
      .set({ cancellationCutoffEnabled: false })
      .where(eq(businesses.id, businessId));
  });

  it('after owner toggle off, cancellation inside former window restores credit', async () => {
    // Context reflects the NEW state: cutoff now disabled
    const context = buildToolContextWithCutoff(
      { id: businessId, name: 'Test Business' },
      clientPhone,
      false, // cutoff toggled off by owner
      4
    );

    const result = await executeTool(
      'cancel_appointment',
      { business_id: businessId, booking_id: bookingId },
      context
    );

    expect(result.success).toBe(true);
    expect(result.credit_forfeited).toBeFalsy();

    // credit_restored row must exist
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.bookingId, bookingId),
          eq(membershipLedger.operationType, 'credit_restored')
        )
      );
    expect(ledgerRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — DST / timing classification: 2h-away session with 8h cutoff → inside window
// ---------------------------------------------------------------------------

describe('DST/timing: session 2 hours away classified as inside 8h cutoff window', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;
  let packageId: number;
  let clientPhone: string;
  let bookingId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;

    await db
      .update(businesses)
      .set({ cancellationCutoffEnabled: true, cancellationCutoffHours: 8 })
      .where(eq(businesses.id, businessId));

    serviceId = await getTestServiceId(businessId);

    const catalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 10 });
    catalogId = catalog.id;

    const pkg = await insertTestPackage(businessId, {
      name: `DST-timing pkg ${Date.now()}`,
      sessionCount: 10,
    });
    packageId = pkg.id;

    clientPhone = uniquePhone();

    // Session 2 hours from now in Athens wall-clock — inside the 8h cutoff window.
    // athensTimeNHoursFromNow uses Intl.DateTimeFormat('Europe/Athens') which
    // correctly handles the DST boundary (Oct 25 2026: clocks fall back from
    // UTC+3 to UTC+2 at 04:00). hoursUntilSessionInAthens in function-executor.ts
    // uses the same noon-UTC anchor technique, producing the same Athens offset
    // for any given calendar date.
    const { sessionDate, sessionTime } = athensTimeNHoursFromNow(2);

    const setup = await setupConfirmedBookingWithDeduction(
      businessId,
      clientPhone,
      serviceId,
      packageId,
      catalogId,
      sessionDate,
      sessionTime
    );
    bookingId = setup.bookingId;
  });

  it('DST: session 2h from now, cutoffHours=8 → pending_confirmation=true (correctly inside window)', async () => {
    const context = buildToolContextWithCutoff(
      { id: businessId, name: 'Test Business' },
      clientPhone,
      true,
      8
    );

    // First call (no confirmed): must return pending_confirmation because
    // 2h < 8h (inside window). Validates that hoursUntilSessionInAthens
    // correctly classifies timing even across DST boundaries.
    const result = await executeTool(
      'cancel_appointment',
      { business_id: businessId, booking_id: bookingId },
      context
    );

    expect(result.pending_confirmation).toBe(true);
  });
});

# Phase 23: Lesson Deletion & Cascade Cancellation - Pattern Map

**Mapped:** 2026-07-27
**Files analyzed:** 6 (new/modified)
**Analogs found:** 5 / 6 (one new file with no exact analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/telegram/handlers/admin-menu.ts` | controller | request-response | `src/webhooks/telegram.ts` (Phase 22 reject path, lines 576–602) | exact |
| `src/onboarding/ai-owner-agent.ts` | service | request-response | `src/webhooks/telegram.ts` (Phase 22 reject path, lines 576–602) | exact |
| `src/database/queries.ts` | database query | CRUD | `src/scheduler/session-cancellation.ts` (lines 83–98) | high |
| `src/session/manager.ts` | service | CRUD/transaction | `src/session/manager.ts` (existing functions) | high |
| `src/billing/queries.ts` | database query | CRUD | Existing (no changes) | N/A |
| `tests/session-cascade.test.ts` | test | N/A | `tests/session.test.ts` (pattern reference) | partial |

## Pattern Assignments

### `src/telegram/handlers/admin-menu.ts` (controller, request-response)

**Analog:** `src/webhooks/telegram.ts` (Phase 22 session-booking reject handler)

**Current Code (lines 313–327):**
```typescript
export async function handleClassCancelExecute(
  chatId: string,
  business: Business,
  instanceId: number
): Promise<void> {
  const cancelled = await cancelSession(business.id, instanceId);
  if (cancelled) {
    await sendTelegramMessage(chatId, 'Το μάθημα ακυρώθηκε.');
  } else {
    await sendTelegramMessage(chatId, 'Το μάθημα δεν βρέθηκε ή είχε ήδη ακυρωθεί.');
  }
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }],
  ]);
}
```

**Cascade-Cancel Pattern (Phase 22 reject path, `src/webhooks/telegram.ts` lines 576–602):**
```typescript
// sbk.sbkAction === 'reject'
const updated = await updateBookingStatusIfPending(sbk.bookingId, 'rejected');
if (!updated) {
  await sendTelegramMessage(senderTelegramId, 'Η κράτηση δεν βρέθηκε ή έχει ήδη επεξεργαστεί.');
  return;
}

// T-22-04: capacity release + credit restore run inside the ambient
// withBusinessContext transaction that already wraps this entire
// handleCallbackQuery call (see handleTelegramWebhookPost) — true
// single-transaction atomicity, no new wrapper needed here.
if (updated.sessionInstanceId !== null) {
  await releaseSessionCapacity(updated.sessionInstanceId);
  const membershipId = await findMembershipByBooking(updated.id);
  if (membershipId !== null) {
    await restoreCredit(membershipId, updated.id, `booking:${updated.id}:credit`);
  }
}

try {
  await sendTelegramMessage(updated.clientPhone, 'Δυστυχώς η αίτησή σας απορρίφθηκε. Δοκιμάστε άλλη ώρα.');
} catch (err) {
  logger.error({ err, bookingId: updated.id }, 'sbk reject: client notification failed (best-effort)');
}
await sendTelegramMessage(senderTelegramId, 'Κράτηση απορρίφθηκε.');
```

**Phase 23 Extension Pattern:**
After `cancelSession()` succeeds, call a new `cascadeCancelSessionBookings()` function that:
1. Finds all active bookings for the instance (from `findActiveBookingsForSessionInstance`)
2. Loops over each booking and applies the cascade pattern (status → capacity → credit → notify)
3. Returns the count of affected bookings for admin confirmation

**Admin confirmation message structure:**
```typescript
const affectedCount = await cascadeCancelSessionBookings(business, instanceId);
const confirmMsg = affectedCount === 0 
  ? 'Το μάθημα ακυρώθηκε (δεν υπήρχαν κρατήσεις).'
  : `Το μάθημα ακυρώθηκε. ${affectedCount} πελάτες ειδοποιήθησαν.`;
await sendTelegramMessage(chatId, confirmMsg);
```

---

### `src/onboarding/ai-owner-agent.ts` (service, request-response)

**Analog:** Phase 22 reject pattern (same as above)

**Current Code (lines 729–750):**
```typescript
case 'cancel_session': {
  const session_date = args.session_date ?? '';
  const session_time = args.session_time ?? '';
  if (!session_date || !session_time) {
    return 'Μη έγκυρα δεδομένα ημερομηνίας/ώρας.';
  }
  // Find the matching instance via in-memory filter (bounded list ~90 days)
  const allSessions = await listSessions(business.id);
  const target = allSessions.find(
    (s) => s.sessionDate === session_date && s.sessionTime === session_time
  );
  if (!target) {
    return `Δεν βρέθηκε μάθημα στις ${session_date} ${session_time}.`;
  }
  // cancelSession calls withBusinessContext internally (ownership guard via FK chain)
  const cancelled = await cancelSession(business.id, target.instanceId);
  if (!cancelled) {
    return `Το μάθημα στις ${session_date} ${session_time} ήταν ήδη ακυρωμένο.`;
  }
  // NOTE: do NOT call sendTelegramMessage here — async notification poller handles it
  return `Το μάθημα στις ${session_date} ${session_time} ακυρώθηκε. Οι κρατημένοι πελάτες θα ειδοποιηθούν αυτόματα.`;
}
```

**Phase 23 Extension:**
After `cancelSession()` succeeds, call `cascadeCancelSessionBookings()` and update the return message:
```typescript
const affectedCount = await cascadeCancelSessionBookings(business, target.instanceId);
const notifyMsg = affectedCount > 0 
  ? `${affectedCount} πελάτες ειδοποιήθησαν αμέσως.`
  : 'Δεν υπήρχαν κρατήσεις να ακυρωθούν.';
return `Το μάθημα στις ${session_date} ${session_time} ακυρώθηκε. ${notifyMsg}`;
```

---

### `src/database/queries.ts` (database query, CRUD)

**Analog:** Existing query pattern from `src/scheduler/session-cancellation.ts` (lines 83–98)

**Query Pattern (find active bookings for a session instance):**
```typescript
// Source: src/scheduler/session-cancellation.ts lines 83–98
// Reuse this pattern; extract as a reusable helper function

const bookedClients = await db
  .select({ 
    clientPhone: bookings.clientPhone,
    bookingId: bookings.id,
    calendarDate: bookings.calendarDate,
    calendarTime: bookings.calendarTime,
  })
  .from(bookings)
  .innerJoin(
    clientBusinessRelationships,
    and(
      eq(bookings.clientPhone, clientBusinessRelationships.senderPhone),
      eq(bookings.businessId, clientBusinessRelationships.businessId)
    )
  )
  .where(
    and(
      eq(bookings.sessionInstanceId, instanceId),
      inArray(bookings.bookingStatus, ['confirmed', 'pending_owner_approval'])
    )
  );
```

**New Function to Extract:**
Add `findActiveBookingsForSessionInstance(businessId: number, sessionInstanceId: number)` to `src/database/queries.ts` or `src/session/manager.ts`:
- Returns array of booking objects with fields: `id`, `clientPhone`, `calendarDate`, `calendarTime`, `bookingStatus`
- Filters for `confirmed` + `pending_owner_approval` statuses only
- Uses inner join with `clientBusinessRelationships` to enforce client-business association

**Key imports needed:**
```typescript
import { and, eq, inArray } from 'drizzle-orm';
import { bookings, clientBusinessRelationships } from '../database/schema';
```

---

### `src/session/manager.ts` (service, CRUD/transaction)

**Analog:** Existing functions (`bookSessionInstance`, `cancelSession`) + Phase 22 reject pattern

**New Function Signature:**
```typescript
export async function cascadeCancelSessionBookings(
  business: Business,
  sessionInstanceId: number
): Promise<number>
```

**Implementation Pattern (mirrors Phase 22 reject loop, from `src/telegram/handlers/client-menu.ts` lines 390–481):**

```typescript
export async function cascadeCancelSessionBookings(
  business: Business,
  sessionInstanceId: number
): Promise<number> {
  return withBusinessContext(business.id, async () => {
    // 1. Find all active bookings for this session instance
    const affectedBookings = await findActiveBookingsForSessionInstance(
      business.id,
      sessionInstanceId
    );

    let processedCount = 0;

    for (const booking of affectedBookings) {
      // 2. Update booking status to 'cancelled'
      await updateBookingStatus(booking.id, 'cancelled');

      // 3. Restore credit (idempotent via idempotencyKey)
      const membershipId = await findMembershipByBooking(booking.id);
      if (membershipId !== null) {
        await restoreCredit(
          membershipId,
          booking.id,
          `lesson-deletion:${sessionInstanceId}:booking:${booking.id}` // Unique per booking (Pitfall 4)
        );
      }

      // 4. Release session capacity
      await releaseSessionCapacity(sessionInstanceId);

      // 5. Delete from calendar (best-effort, isolated)
      try {
        await deleteBookingFromCalendar(booking, business);
      } catch (err) {
        logger.error(
          { err, bookingId: booking.id, sessionInstanceId },
          'Calendar deletion failed in lesson deletion cascade'
        );
      }

      // 6. Notify client (best-effort, isolated per client)
      try {
        if (business.botToken && business.ownerTelegramId) {
          const clientName = await getClientName(business.id, booking.clientPhone) ?? booking.clientPhone;
          const msg = `Η κράτησή σας για το μάθημα ${booking.calendarDate} ${booking.calendarTime} ακυρώθηκε από την επιχείρηση.`;
          await botTokenStore.run(business.botToken, async () => {
            await sendTelegramMessage(booking.clientPhone, msg);
          });
          processedCount += 1;
        }
      } catch (err) {
        logger.error(
          { err, bookingId: booking.id, sessionInstanceId },
          'Client notification failed in lesson deletion cascade'
        );
      }
    }

    return processedCount;
  });
}
```

**Key patterns to preserve:**
- **Atomicity:** Wrap entire loop in `withBusinessContext()` so all status/credit/capacity changes land in one transaction (matches Phase 22 pattern)
- **Idempotency key:** Use `lesson-deletion:${sessionInstanceId}:booking:${bookingId}` (unique per booking, not instance-level)
- **Isolation:** Each client notification in try/catch; one client's failure never blocks others
- **Best-effort:** Calendar delete and notification are best-effort; DB state is always committed even if either fails

**Required imports:**
```typescript
import { deleteBookingFromCalendar } from '../calendar/sync';
import { findMembershipByBooking, restoreCredit, getClientName } from '../billing/queries';
import { botTokenStore, sendTelegramMessage } from '../telegram/client';
import { logger } from '../utils/logger';
```

---

### `src/billing/queries.ts` (database query, read-only)

**Status:** No changes needed for Phase 23.

**Confirm these functions exist and work (already verified in Phase 8 + Phase 22):**

| Function | Location | Behavior |
|----------|----------|----------|
| `restoreCredit()` | lines 575–628 | Idempotent via idempotencyKey UNIQUE constraint; guards: membership not found, unlimited (sessionsRemaining === null), expired (expiresAt < now) |
| `findMembershipByBooking()` | lines 445–457 | Looks up membershipId for a booking via session_deducted ledger row; returns null if no session was deducted |

No code changes required; these functions are ready for reuse in Phase 23.

---

### `tests/session-cascade.test.ts` (test file, new)

**Analog:** Existing test structure from `tests/session.test.ts` (pattern reference)

**Test Coverage Map (Wave 0):**

| Requirement | Test Name | Pattern |
|-------------|-----------|---------|
| CLSS-07 | `test('cascadeCancelSessionBookings updates all active bookings to cancelled')` | Setup instance + multiple bookings, call cascadeCancelSessionBookings, assert all have status='cancelled' |
| CLSS-07 | `test('cascadeCancelSessionBookings restores credit for each affected booking (idempotent)')` | Setup booking with deducted credit, call cascade, verify credit restored; call again, verify no double-restore via idempotencyKey uniqueness |
| CLSS-07 | `test('cascadeCancelSessionBookings decrements bookedCount per booking')` | Setup instance with bookedCount=N, call cascade on N bookings, assert bookedCount=0; verify GREATEST(...,0) floor prevents negatives |
| CLSS-07 | `test('cascadeCancelSessionBookings notifies each affected client in Greek')` | Mock botTokenStore, call cascade, verify sendTelegramMessage called once per booking with correct Greek message |
| CLSS-07 | `test('cascadeCancelSessionBookings is idempotent (webhook replay safe)')` | Call cascade once, verify count; call again, verify count=0 (all already cancelled); verify no duplicate ledger entries |
| CLSS-07 | `test('cascadeCancelSessionBookings isolation: one client notification failure doesn\\'t block others')` | Mock botTokenStore to fail on one client, verify others still notified; verify error logged; verify DB state committed |
| CLSS-06 | `test('admin menu handleClassCancelExecute calls cascadeCancelSessionBookings after cancelSession succeeds')` | Mock functions, call handleClassCancelExecute, verify both called; verify confirmation message includes affected count |
| CLSS-06 | `test('AI owner-agent cancel_session tool calls cascadeCancelSessionBookings')` | Mock Gemini request to cancel_session tool, verify Gemini receives updated response with affected count |

**Test Setup Pattern (from existing test files):**
- Use `beforeEach` to create a business, session catalog, instance, and test bookings within `withBusinessContext`
- Mock `botTokenStore.run()` to capture sendTelegramMessage calls
- Mock `deleteBookingFromCalendar()` to verify it's called (best-effort guard)
- Use `expect(...).rejects.toThrow()` for error cases
- Use `db.query(...).where(...)` directly to verify DB state post-operation

**Imports needed:**
```typescript
import { withBusinessContext } from '../src/database/queries';
import { cascadeCancelSessionBookings } from '../src/session/manager';
import { db } from '../src/database/db';
import { bookings, memberships, membershipLedger } from '../src/database/schema';
```

---

## Shared Patterns

### Per-Booking Cascade Loop Pattern
**Source:** `src/webhooks/telegram.ts` (lines 576–602) + `src/telegram/handlers/client-menu.ts` (lines 390–481)

**Apply to:** `src/session/manager.ts` cascadeCancelSessionBookings() + `src/telegram/handlers/admin-menu.ts` handleClassCancelExecute()

The core cascade pattern is:
```typescript
// 1. Status update
await updateBookingStatus(bookingId, 'cancelled');

// 2. Credit restore (idempotent)
const membershipId = await findMembershipByBooking(bookingId);
if (membershipId !== null) {
  await restoreCredit(membershipId, bookingId, `lesson-deletion:${instanceId}:booking:${bookingId}`);
}

// 3. Capacity release
await releaseSessionCapacity(sessionInstanceId);

// 4. Calendar sync (best-effort)
try {
  await deleteBookingFromCalendar(booking, business);
} catch (err) {
  logger.error({ err }, 'Calendar delete failed (best-effort)');
}

// 5. Client notification (best-effort, isolated)
try {
  await botTokenStore.run(business.botToken, async () => {
    await sendTelegramMessage(booking.clientPhone, msg);
  });
} catch (err) {
  logger.error({ err }, 'Client notification failed (best-effort)');
}
```

### Transaction Wrapping
**Source:** Phase 22 (webhooks/telegram.ts) + Phase 8 (billing/queries.ts)

**Apply to:** All mutations in cascadeCancelSessionBookings()

Wrap the entire loop in `withBusinessContext(business.id, async () => { ... })` so:
- Status update + capacity release + credit restore all land in one DB transaction (all-or-nothing)
- RLS enforcement applies (business.id ownership guard)
- Calendar delete and notification run OUTSIDE the transaction (best-effort, don't block DB changes)

### Idempotency Keys
**Source:** Phase 8 restoreCredit pattern (src/billing/queries.ts lines 575–628)

**Apply to:** All restoreCredit() calls in cascadeCancelSessionBookings()

Use booking-level idempotency keys (NOT instance-level):
```typescript
// CORRECT: unique per booking
`lesson-deletion:${sessionInstanceId}:booking:${bookingId}`

// WRONG: reused across bookings, causes idempotency collision
`lesson-deletion:${instanceId}`
```

This prevents Pitfall 4 (double-restore of second booking due to key collision).

### Error Isolation
**Source:** `src/scheduler/session-cancellation.ts` (lines 80–115) + Phase 8 pattern

**Apply to:** Client notifications in cascadeCancelSessionBookings()

Wrap each client notification in try/catch:
```typescript
for (const booking of affectedBookings) {
  // ... status/credit/capacity changes ...
  
  try {
    // notification
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'notification failed (best-effort)');
    // DO NOT re-throw; continue to next booking
  }
}
```

One client's failure never blocks others from being notified.

---

## No Analog Found

Files with no close match in the codebase:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tests/session-cascade.test.ts` | test | N/A | New test file; pattern reference is existing test structure (tests/session.test.ts), but cascade-specific tests are greenfield |

---

## Critical Pitfalls & Mitigations

**Pitfall 1: Double-Releasing Capacity**
- **Pattern:** Call `releaseSessionCapacity(instanceId)` exactly once per affected booking in the loop, NEVER both once per booking and once for the entire instance
- **Mitigation:** Match Phase 22 expiry-poller pattern (conversation/expiry-poller.ts) — per-booking call with GREATEST(...,0) floor guard
- **Applied to:** cascadeCancelSessionBookings() loop

**Pitfall 2: Restoring Credit for Expired Membership**
- **Pattern:** `restoreCredit()` silently skips restore if membership expired; no error surfaces but admin doesn't know what happened
- **Mitigation:** Trust `restoreCredit()`'s idempotent behavior; instrument logging if transparency needed; silence is acceptable for Phase 23 PoC
- **Applied to:** cascadeCancelSessionBookings() credit restore

**Pitfall 3: Lost Notifications on Partial Failure**
- **Pattern:** If one client's notification fails (network error, Telegram API issue), entire loop stops; subsequent clients never get notified
- **Mitigation:** Wrap each client notification in try/catch; log errors; continue to next client
- **Applied to:** cascadeCancelSessionBookings() notification loop

**Pitfall 4: Idempotency Key Collision**
- **Pattern:** If two bookings for the same instance get the same idempotencyKey, second `restoreCredit()` call silently no-ops
- **Mitigation:** Idempotency keys must be unique per booking: `lesson-deletion:${instanceId}:booking:${bookingId}`
- **Applied to:** restoreCredit() calls in cascadeCancelSessionBookings()

**Pitfall 5: Missing `withBusinessContext()` for Cross-Tenant Safety**
- **Pattern:** Querying and cancelling bookings without `withBusinessContext()` bypasses RLS; cross-tenant data leak possible
- **Mitigation:** Wrap all mutation loops in `withBusinessContext(business.id, ...)`
- **Applied to:** cascadeCancelSessionBookings() entire function body

---

## Metadata

**Analog search scope:** `src/telegram/`, `src/session/`, `src/billing/`, `src/scheduler/`, `src/database/`

**Files scanned:** 8 (admin-menu.ts, client-menu.ts, webhooks/telegram.ts, session/manager.ts, billing/queries.ts, scheduler/session-cancellation.ts, ai-owner-agent.ts, database/queries.ts)

**Pattern extraction date:** 2026-07-27

**Valid until:** 2026-08-10 (14 days; cascade patterns stable, unlikely to change before Phase 24)

---

## Key Takeaways for Planning

1. **Reuse Phase 22's reject cascade pattern** — It's proven, tested, and handles all edge cases (idempotency, isolation, atomicity)
2. **Extract `findActiveBookingsForSessionInstance()` to queries layer** — Query pattern already exists in session-cancellation.ts; extract as reusable function
3. **Add `cascadeCancelSessionBookings()` to session/manager.ts** — New function wraps the loop; called from both admin menu and AI tool
4. **Use booking-level idempotency keys** — Not instance-level; prevents double-restore (Pitfall 4)
5. **Test isolation and idempotency thoroughly** — Wave 0 must include tests for notification failure isolation and replay safety

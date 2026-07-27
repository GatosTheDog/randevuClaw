# Phase 23: Lesson Deletion & Cascade Cancellation - Research

**Researched:** 2026-07-27
**Domain:** Admin lesson/session-instance deletion with cascade booking cancellation, credit restoration, and client notification
**Confidence:** HIGH

## Summary

Phase 23 extends the existing session-management layer (Phase 10) and admin Classes menu (Phase 17) to support full lesson deletion with automatic cascade-cancellation of affected bookings. An admin can delete a scheduled lesson instance (soft-delete via `isCancelled = true`); the system must atomically cancel all active bookings on that instance, restore each client's session credit (or skip for unlimited memberships/expired memberships), release the session's capacity, and notify each affected client in Greek.

**Primary recommendation:** Reuse the proven cancellation patterns from Phase 22 (capacity release) and Phase 8 (credit restore) by looping over all active bookings for the instance; no custom bulk-operation logic needed.

## User Constraints

None — Phase 23 has Claude's full discretion per ROADMAP.md.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLSS-06 | Admin can delete/cancel a scheduled lesson from the admin menu or chat | Query to find bookings for sessionInstanceId; AI owner-agent tool design (name/date match vs raw ID) |
| CLSS-07 | Deleting a lesson cancels active bookings, restores credit/capacity, notifies clients in Greek | reusable restoreCredit pattern; releaseSessionCapacity pattern; client notification template |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Lesson instance deletion | Backend API | Admin Telegram menu | Admin requests deletion via menu callback or free-chat AI tool; backend executes hard-delete or soft-cancel; all-tier concern is idempotent replay (webhook retry safety) |
| Booking cascade-cancellation | Backend Database (transaction) | — | Per-booking status update, credit restore, capacity release must all land or all roll back within the same DB transaction for correctness |
| Client notification | Backend messaging | — | Backend sends notifications to each affected client asynchronously (best-effort, isolated per client) after cascade-cancel completes |

## Standard Stack

### Core Session Management (from Phase 10, reused in Phase 23)
| Module | Purpose | Pattern |
|--------|---------|---------|
| `src/session/manager.ts` | Session instance CRUD | `cancelSession()` exists (soft-delete via `isCancelled=true`); `releaseSessionCapacity()` decrements bookedCount atomically |
| `src/database/schema.ts` | sessionInstances table | `isCancelled: boolean` default false; `bookedCount: integer` denormalized for O(1) reads |

### Booking Query Layer (from existing code, gap identified)
| Module | Current Status | Recommendation |
|--------|----------------|-----------------|
| `src/database/queries.ts` | No dedicated `findBookingsBySessionInstanceId()` helper | Extract query from session-cancellation.ts (line 83-98 pattern); add to queries.ts as reusable function |
| `src/session/manager.ts` | No booking cascade — only `cancelSession()` soft-deletes instance | Phase 23 adds new function (e.g., `cascadeCancelSessionBookings()`) that loops over findings and calls restoreCredit/releaseCapacity |

### Credit Restoration (from Phase 8, proven pattern)
| Function | Location | Behavior |
|----------|----------|----------|
| `restoreCredit()` | `src/billing/queries.ts` lines 575–628 | Idempotent via idempotencyKey UNIQUE constraint; guards: membership not found, unlimited (sessionsRemaining === null), expired (expiresAt < now); inserts ledger entry only if all guards pass; increments counter only if ledger insert succeeded |

### Capacity Release (from Phase 22, proven pattern)
| Function | Location | Behavior |
|----------|----------|----------|
| `releaseSessionCapacity()` | `src/session/manager.ts` lines 322–327 | Decrements bookedCount by 1 per call, floored at 0 via `GREATEST(..., 0)`; called once per affected booking during cascade-cancel loop |

### Notification (Greek messaging pattern)
| Pattern | Location | Greek Wording |
|---------|----------|---------------|
| Session cancellation (existing template) | `src/scheduler/session-cancellation.ts` line 102 | "Το μάθημά σας στις ${date} ${time} ακυρώθηκε. Παρακαλώ επικοινωνήστε μαζί μας για νέο ραντεβού." |
| Recommendation for Phase 23 | — | Consider: "Η κράτησή σας για το μάθημα ${date} ${time} ακυρώθηκε από την επιχείρηση." (Your booking for the lesson ${date} ${time} was cancelled by the business.) — distinct from client-initiated cancel to clarify source |

## Architecture Patterns

### Lesson Deletion Cascade Flow

Admin deletes lesson instance → soft-delete instance (isCancelled=true) → find all active bookings for instance → for each booking: cancel status + restore credit + release capacity + notify client (best-effort) → confirm to admin.

**Key invariants:**
1. Idempotent on webhook replay (soft-cancel + idempotencyKey guards prevent duplicate credit restores)
2. Per-booking isolation (one client's notification failure never blocks others)
3. Atomic credit/capacity changes (all land within a single withBusinessContext transaction OR all bail via exception)

### Querying Bookings for a Session Instance

Existing pattern (session-cancellation.ts lines 83–98):
```typescript
// Approved pattern for finding all active bookings for a cancelled session instance
const bookedClients = await db
  .select({ clientPhone: bookings.clientPhone, /* other fields as needed */ })
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

**Recommendation:** Extract this query pattern to `src/database/queries.ts` or `src/session/manager.ts` as `findActiveBookingsForSessionInstance(businessId, sessionInstanceId)` — reusable across Phase 23 admin-deletion and existing Phase 10 session-cancellation poller.

### Per-Booking Cancellation Loop Pattern

Reuse Phase 8/Phase 22 proven pattern from `src/telegram/handlers/client-menu.ts` `handleCancelExecute()` lines 390–481:

```typescript
for (const booking of affectedBookings) {
  // 1. Update status
  await updateBookingStatus(booking.id, 'cancelled');
  
  // 2. Restore credit (idempotent via idempotencyKey)
  const membershipId = await findMembershipByBooking(booking.id);
  if (membershipId !== null) {
    await restoreCredit(membershipId, booking.id, `lesson-deletion:${instanceId}:booking:${booking.id}`);
  }
  
  // 3. Release capacity
  await releaseSessionCapacity(instanceId);
  
  // 4. Delete from calendar (best-effort)
  try {
    await deleteBookingFromCalendar(booking, business);
  } catch (err) {
    logger.error({ err }, 'Calendar deletion failed in lesson deletion cascade');
  }
  
  // 5. Notify client (best-effort, isolated)
  try {
    const clientName = await getClientName(business.id, booking.clientPhone) ?? booking.clientPhone;
    const msg = `Η κράτησή σας για το μάθημα ${booking.calendarDate} ${booking.calendarTime} ακυρώθηκε από την επιχείρηση.`;
    await botTokenStore.run(business.botToken, async () => {
      await sendTelegramMessage(booking.clientPhone, msg);
    });
  } catch (err) {
    logger.error({ err }, 'Client notification failed in lesson deletion cascade');
  }
}
```

### Admin Menu Integration

Extend `src/telegram/handlers/admin-menu.ts`:
- **Current flow (Phase 17):** showClassesMenu → showCancelClassList → showCancelClassConfirm → handleClassCancelExecute (calls only `cancelSession()`)
- **Phase 23 extension:** handleClassCancelExecute calls `cascadeCancelSessionBookings()` BEFORE confirming to admin
- **Callback data convention:** Already established in Phase 17 — `menu:classes:cancel_yes:${instanceId}`; no changes needed

### AI Owner-Agent Tool Design (Optional for Phase 23)

Per STATE.md Phase 07-06 decision: "deactivate_package switched to package_name with case-insensitive partial match — eliminates hallucinated-ID problem."

**If Phase 23 adds a free-chat `delete_lesson` tool** (ai-owner-agent.ts), it should follow the same name/date-match pattern:
- Parameter: `session_date` (ISO "YYYY-MM-DD") + `session_time` ("HH:MM") rather than raw `sessionInstanceId`
- Rationale: Gemini never hallucinates dates; it can reliably match session date/time strings; raw IDs are always risk vectors
- Alternative: Gemini calls `list_sessions()` first to get instanceIds, then calls delete with the ID — safer but wordier

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Finding bookings for a session instance | Custom SQL or manual loop with partial filtering | `findActiveBookingsForSessionInstance()` query helper (new in Phase 23) | Filters, joins, status checks must be correct; pattern already proven in session-cancellation.ts poller |
| Restoring session credit on cancellation | Custom ledger logic or direct UPDATE on memberships counter | `restoreCredit(membershipId, bookingId, idempotencyKey)` from Phase 8 | Handles 4 critical guards (not found, unlimited, expired, idempotency); reuse = correctness + idempotency |
| Releasing session capacity | Manual bookedCount decrement or separate per-instance logic | `releaseSessionCapacity(instanceId)` from Phase 22 | Already atomic with GREATEST floor; prevents negative counts; one source of truth |
| Bulk booking status updates | Custom loop with BEGIN/COMMIT | Wrap loop in `withBusinessContext()` transaction | Atomicity guaranteed; RLS enforcement automatic; single transaction across all mutations |

## Common Pitfalls

### Pitfall 1: Double-Releasing Capacity
**What goes wrong:** If capacity release is called once for the entire lesson (bookedCount -= N) AND once per booking (bookedCount -= 1 in loop), the count gets decremented too much and goes negative, blocking rebooking.

**Why it happens:** Confusion between single-instance accounting vs per-booking accounting when refactoring from poller (single notification batch per instance) to interactive deletion (per-booking cascade).

**How to avoid:** Call `releaseSessionCapacity(instanceId)` exactly once per affected booking, never both. The function already handles GREATEST(..., 0) flooring; trust it. Match the Phase 22 expiry-poller pattern (conversation/expiry-poller.ts lines 60–75).

**Warning signs:** bookedCount shows 0 or negative in logs; clients cannot rebook after admin deletion.

### Pitfall 2: Restoring Credit for Expired Membership
**What goes wrong:** If a client's membership expired AFTER they booked but BEFORE the admin cancelled, `restoreCredit()` correctly skips the restore (per its guard at line 603: `if (membership.expiresAt < new Date()) return`). No error surfaces; but admin sees no confirmation of what happened.

**Why it happens:** `restoreCredit()` is silent on early-exit guards; admin doesn't know if a credit was restored or not.

**How to avoid:** Trust `restoreCredit()`'s idempotent behavior — it's designed for this. Log the return value (void, but caller can instrument). If transparency is needed, return a status from `restoreCredit()` (e.g., 'skipped_expired'). For Phase 23 PoC, silence is acceptable (matches Phase 8 behavior).

**Warning signs:** None visible to admin; no error in logs; expired-membership clients silently get no restore.

### Pitfall 3: Lost Notifications on Partial Failure
**What goes wrong:** If one client's notification fails (network error, Telegram API issue), the loop stops and subsequent clients never get notified.

**Why it happens:** Unguarded `await sendTelegramMessage()` in a loop — first exception propagates and breaks the loop.

**How to avoid:** Wrap each client notification in try/catch; log errors; continue to next client. Per-item isolation pattern (see src/scheduler/membership-expiry.ts or session-cancellation.ts). Never let one client's failure block others.

**Warning signs:** Only first N clients notified, remainder get no message despite successful booking cancel.

### Pitfall 4: Idempotency Key Collision
**What goes wrong:** If two bookings for the same instance get the same idempotencyKey, the second `restoreCredit()` call silently no-ops (by design, per onConflictDoNothing). Credit restore is skipped for that booking.

**Why it happens:** Reusing instance-level key (e.g., `lesson-deletion:${instanceId}`) instead of booking-level key.

**How to avoid:** Idempotency keys must be unique per booking: `lesson-deletion:${instanceId}:booking:${bookingId}`. This matches the existing pattern in client-menu.ts (`booking:${bookingId}:credit`).

**Warning signs:** Multiple bookings on the same lesson; only one client's credit restored; no error in logs (because silent idempotency is correct behavior, but wrong key causes overcollision).

### Pitfall 5: Missing `withBusinessContext()` for Cross-Tenant Safety
**What goes wrong:** Querying and cancelling bookings without `withBusinessContext(businessId, ...)` means RLS (Row-Level Security) is bypassed. If two Telegram accounts own different businesses, a query without RLS could return or mutate bookings from the wrong business.

**Why it happens:** Forgetting that `getConn()` only enforces RLS inside `withBusinessContext`; outside it, queries hit the admin DB (superuser, no RLS).

**How to avoid:** Wrap all mutation and SELECT loops in `withBusinessContext(businessId, async () => { ... })`. Pattern proven in Phase 8 (src/billing/queries.ts) and Phase 22 (src/session/manager.ts). Ownership is verified by the webhook HMAC → route → business lookup, so the businessId passed here is trusted.

**Warning signs:** Cross-tenant data leak if two owners with different businesses are active simultaneously; no unit test catches this without explicit RLS test (currently covered by Phase 4/8 RLS test suite).

## Code Examples

### Finding Active Bookings for a Session Instance

**Approved pattern (existing, from session-cancellation.ts):**
```typescript
// Source: src/scheduler/session-cancellation.ts lines 83–98
// Reuse this query pattern for Phase 23; consider extracting to queries.ts

const bookedClients = await db
  .select({ 
    clientPhone: bookings.clientPhone,
    bookingId: bookings.id,
    // Add other fields as needed: calendarDate, calendarTime, etc.
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

### Per-Booking Cascade-Cancellation Loop

**Approved pattern (from Phase 22 / Phase 8, reused in Phase 23):**
```typescript
// Source: src/telegram/handlers/client-menu.ts handleCancelExecute + src/billing/queries.ts restoreCredit

for (const booking of affectedBookings) {
  // Atomic transaction wraps all mutations for one booking
  await withBusinessContext(business.id, async () => {
    // 1. Status change
    await updateBookingStatus(booking.id, 'cancelled');
    
    // 2. Credit restore (idempotent via idempotencyKey)
    const membershipId = await findMembershipByBooking(booking.id);
    if (membershipId !== null) {
      await restoreCredit(
        membershipId, 
        booking.id, 
        `lesson-deletion:${instanceId}:booking:${booking.id}` // Unique per booking
      );
    }
    
    // 3. Capacity release
    await releaseSessionCapacity(instanceId);
  });
  
  // 4. Calendar sync (best-effort, outside transaction)
  try {
    await deleteBookingFromCalendar(booking, business);
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Calendar deletion failed (best-effort)');
  }
  
  // 5. Client notification (best-effort, isolated per client)
  try {
    if (business.botToken && business.ownerTelegramId) {
      const clientName = await getClientName(business.id, booking.clientPhone) ?? booking.clientPhone;
      const msg = `Η κράτησή σας για το μάθημα ${booking.calendarDate} ${booking.calendarTime} ακυρώθηκε από την επιχείρηση.`;
      await botTokenStore.run(business.botToken, async () => {
        await sendTelegramMessage(booking.clientPhone, msg);
      });
    }
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Client notification failed (best-effort)');
  }
}
```

### Admin Menu Handler (Phase 23 Extension)

**Pattern to extend handleClassCancelExecute:**
```typescript
// Current Phase 17 code (admin-menu.ts lines 313–327):
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
  // ... show menu
}

// Phase 23 extension — after cancelSession, cascade-cancel bookings:
export async function handleClassCancelExecute(
  chatId: string,
  business: Business,
  instanceId: number
): Promise<void> {
  const cancelled = await cancelSession(business.id, instanceId);
  if (!cancelled) {
    await sendTelegramMessage(chatId, 'Το μάθημα δεν βρέθηκε ή είχε ήδη ακυρωθεί.');
    return;
  }
  
  // Phase 23: Cascade-cancel all active bookings for this instance
  const affectedCount = await cascadeCancelSessionBookings(business, instanceId);
  
  const confirmMsg = affectedCount === 0 
    ? 'Το μάθημα ακυρώθηκε (δεν υπήρχαν κρατήσεις).'
    : `Το μάθημα ακυρώθηκε. ${affectedCount} πελάτες ειδοποιήθησαν.`;
  
  await sendTelegramMessage(chatId, confirmMsg);
  // ... show menu
}
```

## Runtime State Inventory

**Trigger:** Phase 23 is greenfield (no rename/refactor of existing systems); no runtime state inventory needed.

## Environment Availability

**Dependency check:** Phase 23 is purely backend database + Telegram messaging. All dependencies (Node.js, Postgres, Telegram Bot API) are already verified in Phase 1-4 setup and remain available.

- ✓ PostgreSQL (Neon) — existing connection verified
- ✓ Telegram Bot API — existing per-business bot tokens available
- ✓ Drizzle ORM — existing transactions via `withBusinessContext()`

**No new external dependencies required.**

## Validation Architecture

Test framework: Jest (existing, Phase 7 convention)

### Test Map

| Req ID | Behavior | Test Type | Automated Command | File Status |
|--------|----------|-----------|-------------------|-------------|
| CLSS-06 | Admin menu shows cancel option for lesson | unit | `jest tests/admin-menu.test.ts --testNamePattern=delete` | Wave 0 |
| CLSS-06 | Admin deletes lesson via menu callback | integration | `jest tests/admin-menu.test.ts --testNamePattern=cascade` | Wave 0 |
| CLSS-07 | All active bookings for deleted lesson get status='cancelled' | integration | `jest tests/session-cascade.test.ts --testNamePattern=booking-status` | Wave 0 |
| CLSS-07 | Session credit restored for each affected booking (idempotent) | integration | `jest tests/session-cascade.test.ts --testNamePattern=credit-restore` | Wave 0 |
| CLSS-07 | Lesson capacity released (bookedCount decremented per booking) | integration | `jest tests/session-cascade.test.ts --testNamePattern=capacity-release` | Wave 0 |
| CLSS-07 | Each affected client notified in Greek | integration | `jest tests/session-cascade.test.ts --testNamePattern=client-notification` | Wave 0 |
| CLSS-07 | Cascade-cancel is idempotent (webhook replay safe) | integration | `jest tests/session-cascade.test.ts --testNamePattern=idempotency` | Wave 0 |
| CLSS-07 | One client's notification failure doesn't block others | integration | `jest tests/session-cascade.test.ts --testNamePattern=isolation` | Wave 0 |

### Wave 0 Gaps

- [ ] `tests/session-cascade.test.ts` — new file covering cascade-cancel logic, idempotency, credit restore, capacity release, notification isolation
- [ ] `tests/admin-menu-cascade.test.ts` — admin menu integration tests for delete button / callback routing
- [ ] Update `tests/admin-menu.test.ts` to cover Phase 23 cascade extend (if not a separate file)

## Security Domain

### ASVS Categories Applicable to Phase 23

| Category | Applies | Standard Control | Implemented Where |
|----------|---------|------------------|-------------------|
| V2 Authentication | no | N/A | Owner Telegram ID verified upstream (Phase 4 webhook routing) |
| V3 Session Management | no | N/A | Not applicable (batch backend operation, not user session) |
| V4 Access Control | **yes** | Row-Level Security (RLS) via withBusinessContext; ownership guard on businessId | `src/database/queries.ts` withBusinessContext; admin-menu.ts route → business lookup |
| V5 Input Validation | **yes** | instanceId parsed from callback_data (integer); date/time validated by schema | admin-menu.ts callback_data parsing; sessionInstances.sessionDate/sessionTime as text (schema validates ISO/HH:MM format) |
| V6 Cryptography | no | N/A | No new crypto in Phase 23; existing HMAC webhook verification (Phase 4) unchanged |
| V9 Communications | no | N/A | Telegram TLS handled by Telegram Bot API SDK |

### Known Threat Patterns for Session Deletion

| Pattern | STRIDE | Standard Mitigation | Implementation |
|---------|--------|---------------------|-----------------|
| Admin deletes lesson for wrong business (cross-tenant) | Tampering | RLS via withBusinessContext + businessId ownership guard | Wrap all mutations in withBusinessContext(business.id, ...); business.id derived from webhook HMAC chain |
| Replay of cascade-cancel webhook causes duplicate credit restore | Tampering | Idempotency keys on ledger (UNIQUE constraint) | restoreCredit() uses idempotencyKey UNIQUE; idempotency key = `lesson-deletion:${instanceId}:booking:${bookingId}` |
| Forged callback_data with wrong instanceId cancels another lesson | Tampering | Webhook HMAC verification (Phase 4) + re-derive business from senderTelegramId | Callback_data contains only instanceId (integer, parsed); business re-derived via findBusinessByOwnerTelegramId before any mutation |
| Notification send failure causes silent data loss (client never notified) | Information Disclosure (privacy) | Per-item try/catch + best-effort pattern + logging | Each client notification in try/catch; errors logged but don't block other clients or DB changes; idempotency keys ensure DB state is correct even if notifications fail |
| Gemini hallucinates sessionInstanceId in free-chat delete tool | Tampering | Use date/time match (not raw ID) if adding AI tool | If AI tool added: Gemini takes date+time string, searches for matching instance by date/time comparison (not provided instance ID) |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hard-delete session instances | Soft-delete via `isCancelled` boolean (Phase 10) | 2026-07-22 (Phase 10) | Audit trail preserved; cascading cancellations possible (Phase 23); easy re-activation if needed |
| Per-admin-action notification (manual message send) | Batch poller for unnotified cancellations (Phase 10, session-cancellation.ts) | 2026-07-22 (Phase 10) | Reliable dedup via UNIQUE constraint; idempotent on poller retry; but admin interactivity lost (Phase 23 must add inline notification option) |
| Client-initiated-only cancellation flow | Owner approve/reject + admin/business-initiated cancellation (Phase 22/23) | 2026-07-26 (Phase 22) + 2026-07-27 (Phase 23 planned) | Businesses gain control; clients get pro-active notice; credit restore logic unified |

## Assumptions Log

| # | Claim | Section | Risk if Wrong | Verification |
|---|-------|---------|---------------|--------------|
| A1 | `findMembershipByBooking(bookingId)` exists and works for both open_slots and fixed_sessions bookings | Code Examples | If it only works for one mode, credit restore will fail for bookings on the other mode | Check src/billing/queries.ts — already used in Phase 8 client-cancel flow, confirmed to work |
| A2 | `releaseSessionCapacity()` is idempotent and safe to call N times for N bookings | Code Examples | If not floored at 0, capacity goes negative and blocks rebooking | Verified: uses GREATEST(...,0) guard; matches Phase 22 expiry-poller pattern |
| A3 | `deleteBookingFromCalendar()` is designed for best-effort and doesn't throw on missing Google Calendar event | Code Examples | If it throws on not-found, cascade-cancel loop breaks and clients aren't notified | Assume yes; if discovered false, wrap in try/catch per Phase 8 billing pattern (already documented as pattern in handleCancelExecute) |
| A4 | Greek notification wording should differentiate business-initiated cancel from client-initiated cancel | Notifications section | If both use same message, clients may not understand why they didn't initiate | Assumed based on "owner-initiated cancellation" distinction in Phase 22 CONTEXT.md; recommend user review wording with Greek UX |

**If this table is empty:** All major claims in this research are verified against current source code (HIGH confidence) — no assumptions needed for planning.

## Open Questions

1. **Should Phase 23 add an AI owner-agent tool for free-chat deletion, or just use the admin menu?**
   - What we know: Phase 21 added Gemini tool-calling for owner workflows; Phase 17 added admin menu
   - Clarification needed: REQUIREMENTS.md says "from the admin menu or chat" — does "chat" mean AI tool or free-text routing?
   - Recommendation: Assume admin menu only for Phase 23; if free-chat tool is needed, add it with date/time name-matching per Phase 07-06 pattern

2. **Should client notification happen synchronously (in the same request) or async (in a poller)?**
   - What we know: Phase 10 session-cancellation poller does async batch notifications; Phase 8 client-cancel does sync try/catch
   - Clarification needed: Admin expects confirmation of how many clients were notified; does this imply sync execution?
   - Recommendation: Sync (inline in handleClassCancelExecute loop) for immediate feedback to admin; matches existing client-cancel pattern

3. **Should Calendar deletion happen before or after client notification?**
   - What we know: Phase 8 does calendar delete before notification (deterministic); Phase 10 poller does no calendar delete (notifications only)
   - Clarification needed: If calendar is already synced and we notify client, should we also delete the calendar event?
   - Recommendation: Yes, delete calendar event AFTER DB status change (atomic) but BEFORE notification (so notification is always accurate); matches client-cancel pattern

## Sources

### Primary (HIGH confidence)
- **Source:** src/database/schema.ts (lines 432–463) — sessionInstances table definition with `isCancelled` and `bookedCount`
- **Source:** src/session/manager.ts (lines 182–327) — bookSessionInstance, releaseSessionCapacity, cancelSession functions
- **Source:** src/billing/queries.ts (lines 575–628) — restoreCredit function with all guards and idempotency
- **Source:** src/telegram/handlers/client-menu.ts (lines 390–481) — handleCancelExecute cascade pattern (status → credit restore → calendar → notification)
- **Source:** src/scheduler/session-cancellation.ts (lines 38–145) — pollSessionCancellations() batch poller with booking query pattern (lines 83–98) and Greek notification template (line 102)
- **Source:** src/telegram/handlers/admin-menu.ts (lines 243–327) — showClassesMenu, showCancelClassList, handleClassCancelExecute current structure
- **Source:** src/onboarding/ai-owner-agent.ts (lines 623–631) — deactivate_package tool using case-insensitive partial name match (Phase 07-06 decision)

### Secondary (MEDIUM confidence)
- **Source:** .planning/STATE.md (lines 220–222) — Phase 23 roadmap goal and success criteria; Phase 23 blocker on line 250
- **Source:** .planning/REQUIREMENTS.md (lines 16–17) — CLSS-06 and CLSS-07 requirement definitions
- **Source:** .planning/ROADMAP.md (lines 179–188) — Phase 23 full description, dependencies, success criteria

## Metadata

**Confidence breakdown:**
- Session deletion mechanism (soft-cancel): HIGH — verified in schema and manager.ts
- Booking cascade query: HIGH — pattern exists in session-cancellation.ts; no custom logic needed
- Credit restore idempotency: HIGH — Phase 8 proven and documented; guards all correct
- Capacity release per-booking: HIGH — Phase 22 proven; GREATEST(...,0) prevents negatives
- Greek notification: HIGH — existing templates in codebase; recommend minor wording tweak for business-initiated clarity
- Admin menu integration: HIGH — Phase 17 established pattern; callback routing proven
- AI tool design (if needed): MEDIUM — Phase 07-06 name-match decision exists; Phase 23 doesn't require it per requirements, but option documented

**Research date:** 2026-07-27
**Valid until:** 2026-08-10 (14 days; session catalog/booking patterns are stable, unlikely to change before Phase 24)

---

## Recommended Next Steps for Planner

1. **Extract query helper:** Add `findActiveBookingsForSessionInstance(businessId: number, instanceId: number): Promise<Booking[]>` to `src/session/manager.ts` or `src/database/queries.ts` (reuses pattern from session-cancellation.ts lines 83–98)

2. **Implement cascade function:** Add `cascadeCancelSessionBookings(business: Business, instanceId: number): Promise<number>` (returns affected count) — the core Phase 23 operation

3. **Extend admin menu handler:** Update `handleClassCancelExecute()` in `src/telegram/handlers/admin-menu.ts` to call `cascadeCancelSessionBookings()` AFTER `cancelSession()` succeeds

4. **Greek wording review:** Confirm client notification message distinguishes business-initiated cancel from client-initiated cancel (recommend: "...ακυρώθηκε από την επιχείρηση" vs existing "...ακυρώθηκε.")

5. **Test scaffold:** Wave 0 should include stubs for `tests/session-cascade.test.ts` covering idempotency, isolation, and credit-restore guards

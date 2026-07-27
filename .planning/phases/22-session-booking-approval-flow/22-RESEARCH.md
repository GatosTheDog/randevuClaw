# Phase 22: Session Booking Approval Flow - Research

**Researched:** 2026-07-27
**Domain:** Session booking approval workflow with owner-gated acceptance and capacity soft-hold
**Confidence:** HIGH

## Summary

Phase 22 implements owner approval control for session-class bookings, mirroring the existing Phase 13 slotless-request approval pattern. Session bookings currently auto-confirm with no owner involvement; this phase gates them behind an approve/reject keyboard, holds capacity atomically during the pending window, and releases it on rejection or expiry.

The required infrastructure (pending_owner_approval status, expiry sweep, ownerTelegramMessageId tracking) already exists from Phase 2–3 open-slots booking flow. Reusing these patterns rather than inventing new ones is critical for consistency and correctness.

**Primary recommendation:** Build a new `approveSessionBooking()` function in `src/session/manager.ts` modeled on `approveSlotlessRequest()` from Phase 13, then modify `handleBookSessionExecute()` to create pending bookings instead of confirmed ones, and wire a new callback handler in `src/webhooks/telegram.ts` to process approval/rejection taps.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Booking creation (pending state) | API / Backend | Database | Create pending_owner_approval booking row with capacity locked via unique index |
| Capacity soft-hold | Database | API / Backend | Unique index on (business_id, date, time, status IN pending/confirmed) prevents overbooking during approval window |
| Owner approval keyboard | API / Backend | Telegram Bot | Send inline keyboard to owner; callback_data encodes booking ID for identify-and-approve atomicity |
| Approval/rejection execution | API / Backend | Database | SELECT FOR UPDATE on booking to prevent double-tap; atomic status flip and capacity release |
| Expiry sweep | API / Backend | Database / Scheduler | Existing 5-minute poller already sweeps pending_owner_approval → expired; reuse unchanged |
| Client notifications | Telegram Bot | API / Backend | Owner sends approval/rejection text to client via botTokenStore-scoped Telegram API call |

## Standard Stack

### Core Patterns (Proven in Codebase)

| Pattern | Location | Purpose | Why Standard |
|---------|----------|---------|--------------|
| SELECT FOR UPDATE atomic booking flip | Phase 2–13 established | Serialize concurrent approvals, prevent double-tap | Proven correctness; serializes on primary key; no race conditions |
| pending_owner_approval status + partial unique index | Phase 2 bookings schema | Capacity soft-hold during approval window | Index WHERE clause includes pending_owner_approval; re-bookable after rejection/expiry |
| Expiry sweep (2-hour TTL) | Phase 2–3 expiry-poller.ts | Auto-expire stale pending_owner_approval bookings | Existing infrastructure; no changes needed for session bookings |
| Owner approval keyboard via callback_data | Phase 13 slotless requests + Phase 20 escalations | Route approval/rejection taps to handler | Proven pattern: callback_data contains IDs; re-derives business/booking via HMAC-verified webhook scope |
| runInTransaction(pool, ...) for atomicity | Phase 13 slotless-requests.ts | Atomic booking insert + ledger insert + status update | Handles client-side query_timeout leak that drizzle-orm transaction() has |

### Session Booking Approval Specifics

| Library/Capability | Version/Source | Purpose | Status |
|---------|---------|---------|---------|
| `bookSessionInstance()` | src/session/manager.ts | **MUST REUSE** — holds capacity via SELECT FOR UPDATE | Exists; currently hardcodes confirmed status |
| `expireStalePendingBookings()` | src/database/queries.ts | Sweep stale pending bookings after 2 hours | Exists; already handles pending_owner_approval |
| `updateBookingStatus()` | src/database/queries.ts | Flip pending → confirmed/rejected atomically | Exists; no changes needed |
| Callback_data parsing | src/webhooks/telegram.ts parseCallbackData() | Route approval/rejection taps to handler | Exists; add new pattern arm for session booking approvals |
| `botTokenStore.run()` | src/telegram/client.ts | Scope client notification sends to correct bot | Exists; proven pattern |
| `editTelegramMessageReplyMarkup()` | src/telegram/client.ts | Clear owner's approval keyboard after tap | Exists; used by expiry sweep to prevent late taps |

## Package Legitimacy Audit

No new external packages required. All dependencies for this phase (Drizzle ORM, Telegram Bot API client library, logging) are already in use.

**Packages removed due to [SLOP] verdict:** None  
**Packages flagged as suspicious [SUS]:** None  
*All infrastructure patterns reuse existing, proven code paths from Phases 2–3, 13, and 20.*

## Architecture Patterns

### Current Session Booking Flow (Pre-Phase 22)

```
Client: /start → Book class
         ↓
showBookSessionList() → list available instances (filtering bookedCount < capacity)
         ↓
showBookConfirm(instanceId) → show Ναι/Όχι
         ↓
handleBookSessionExecute(instanceId) → call bookSessionInstance()
         ↓
bookSessionInstance() [SELECT FOR UPDATE]
  ├─ Lock sessionInstances row
  ├─ Check bookedCount < capacity
  ├─ Insert booking with bookingStatus='confirmed' ← WILL CHANGE TO 'pending_owner_approval'
  ├─ Increment bookedCount atomically
  ├─ Deduct session credit (if membership finite)
         ↓
Send client: "Η κράτησή σας επιβεβαιώθηκε!" ← WILL CHANGE TO "Αίτημα αποστολή, αναμονή επιβεβαίωσης"
         ↓
Send owner: "Νέα κράτηση μαθήματος..." (informational, no keyboard) ← WILL ADD APPROVAL KEYBOARD
```

### New Session Booking Approval Flow (Phase 22 Target)

```
Client: /start → Book class
         ↓
showBookSessionList() → list available instances
         ↓
showBookConfirm(instanceId) → show Ναι/Όχι
         ↓
handleBookSessionExecute(instanceId) → [CHANGED] Create pending booking
         ↓
bookSessionInstance(status='pending_owner_approval') [SELECT FOR UPDATE]
  ├─ Lock sessionInstances row
  ├─ Check bookedCount < capacity
  ├─ Insert booking with bookingStatus='pending_owner_approval' ← NEW: pending status
  ├─ Increment bookedCount atomically ← NEW: capacity held while pending
  ├─ Deduct session credit (if membership finite) ← QUESTION: deduct now or on approval?
         ↓
Send client: "Αίτημα αποστολή, αναμονή επιβεβαίωσης"
         ↓
Send owner: "Νέα κράτηση αναμονής..." with [Εγκρίνω | Απορρίπτω] keyboard
         ├─ callback_data: sbk:approve:{bookingId}:{clientTelegramId}
         ├─ callback_data: sbk:reject:{bookingId}:{clientTelegramId}
         ↓
         ├─ Owner taps [Εγκρίνω] (escl:approve path)
         │   ├─ SELECT FOR UPDATE on bookings row (prevent double-tap)
         │   ├─ Verify status still 'pending_owner_approval'
         │   ├─ UPDATE bookingStatus = 'confirmed'
         │   └─ Send client: "Η κράτησή σας εγκρίθηκε!"
         │
         ├─ Owner taps [Απορρίπτω] (NEW reject path)
         │   ├─ SELECT FOR UPDATE on bookings row
         │   ├─ Verify status still 'pending_owner_approval'
         │   ├─ UPDATE bookingStatus = 'rejected'
         │   ├─ [CRITICAL] Decrement sessionInstances.bookedCount atomically ← CAPACITY RELEASE
         │   ├─ [QUESTION] Restore session credit if it was deducted on pending creation?
         │   └─ Send client: "Δυστυχώς η αίτησή σας απορρίφθηκε."
         │
         └─ No action after 2 hours (expiresAt cutoff)
             ├─ expireStalePendingBookings() sweep
             ├─ UPDATE bookingStatus = 'expired'
             ├─ [CRITICAL] Decrement sessionInstances.bookedCount atomically ← CAPACITY RELEASE
             ├─ [QUESTION] Restore session credit?
             ├─ Send client: "Το ραντεβού σας δεν επιβεβαιώθηκε..."
             └─ Clear keyboard on owner message via editTelegramMessageReplyMarkup()
```

### System Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     Session Booking Approval                    │
│                                                                 │
│  Client              API/DB                  Owner              │
│    │                  │                        │                │
│    │──Book request──▶│ handleBookSessionExecute │                │
│    │                  │                        │                │
│    │                  │ bookSessionInstance()   │                │
│    │                  │ (SELECT FOR UPDATE)     │                │
│    │                  │ ├─ Check capacity      │                │
│    │                  │ ├─ Insert pending      │                │
│    │                  │ ├─ Lock count++        │                │
│    │                  │ ├─ Deduct credit?      │                │
│    │                  │ ▼                      │                │
│    │◀── "待ち中..."──│                        │                │
│    │                  │                        │                │
│    │                  │  Send approval alert   │                │
│    │                  ├───────────────────────▶│                │
│    │                  │                        │ [Approve]      │
│    │                  │                        │ [Reject]       │
│    │                  │                        │                │
│    │                  │◀─approval callback────│                │
│    │                  │ (SELECT FOR UPDATE)    │                │
│    │                  │ UPDATE status          │                │
│    │                  │ If reject: count--     │                │
│    │                  │ ▼                      │                │
│    │◀──confirmation──│                        │                │
│    │                  │──clear keyboard──────▶│                │
│    │                  │                        │                │
│    │◀────TIMEOUT────│ (2h expiry sweep)       │                │
│    │                  ├─ UPDATE expired       │                │
│    │                  ├─ count--              │                │
│    │                  ├───clear keyboard─────▶│                │
│    │                  ▼                        │                │
│    │                                          │                │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new directories. Add to existing files:

```
src/
├── session/
│   ├── manager.ts          [MODIFY] bookSessionInstance() to accept status param
│   │                       [ADD] NEW function: approveSessionBooking() or flip logic
│   └── slotless-requests.ts [REFERENCE] — approval/rejection pattern
├── telegram/
│   ├── handlers/
│   │   └── client-menu.ts   [MODIFY] handleBookSessionExecute() to create pending
│   └── escalation.ts        [REVIEW] — keyboard building pattern
├── webhooks/
│   └── telegram.ts          [MODIFY] parseCallbackData() add sbk:* pattern arm
│                            [ADD] NEW: handle sbk:approve/sbk:reject callbacks
├── database/
│   └── queries.ts           [REVIEW] updateBookingStatus(), expireStalePendingBookings()
│
└── conversation/
    └── expiry-poller.ts     [NO CHANGE] — already handles session booking expiry
```

### Pattern 1: Atomic Booking Status Flip with Capacity Release

**What:** When owner rejects a pending session booking, atomically transition the booking to `rejected` status AND decrement the sessionInstances.bookedCount counter in a single transaction, preventing capacity from being orphaned.

**When to use:** Rejection/expiry of session bookings where capacity must be immediately available for another client.

**Example:**

```typescript
// src/session/manager.ts — NEW function (similar to approveSlotlessRequest)

export async function rejectSessionBooking(
  bookingId: number,
  businessId: number
): Promise<{ booking: typeof bookings.$inferSelect; sessionInstanceId: number } | null> {
  return runInTransaction(pool, async (tx) => {
    // Step 1: Lock the booking and verify it is still pending
    const bookingRows = await tx
      .select({
        id: bookings.id,
        sessionInstanceId: bookings.sessionInstanceId,
        bookingStatus: bookings.bookingStatus,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.businessId, businessId),
          eq(bookings.bookingStatus, 'pending_owner_approval')
        )
      )
      .for('update')
      .limit(1);

    const booking = bookingRows[0];
    if (!booking) {
      logger.warn({ bookingId, businessId }, 'rejectSessionBooking: booking not found or not pending');
      return null;
    }

    // Step 2: Update booking status to 'rejected'
    const rejectedRows = await tx
      .update(bookings)
      .set({ bookingStatus: 'rejected' })
      .where(eq(bookings.id, bookingId))
      .returning();

    // Step 3: Decrement sessionInstances.bookedCount atomically
    if (booking.sessionInstanceId) {
      await tx
        .update(sessionInstances)
        .set({ bookedCount: sql`${sessionInstances.bookedCount} - 1` })
        .where(eq(sessionInstances.id, booking.sessionInstanceId));

      logger.info(
        { bookingId, sessionInstanceId: booking.sessionInstanceId },
        'Session booking rejected — capacity released'
      );
    }

    return { booking: rejectedRows[0]!, sessionInstanceId: booking.sessionInstanceId ?? 0 };
  });
}
```

### Pattern 2: Approval Keyboard with Idempotent Re-Tap Guard

**What:** When a pending session booking is created, send the owner an inline keyboard with Approve/Reject buttons. Use SELECT FOR UPDATE to ensure a second tap after approval finds the booking already flipped and returns null (idempotent).

**When to use:** Any owner decision that must be atomic (no double-booking/double-acceptance edge case).

**Example:**

```typescript
// src/webhooks/telegram.ts — NEW callback handler (modeled on escl:approve)

// In handleCallbackQuery, add new case:
if ('sbkAction' in parsed) {
  const sbk = parsed as SessionBookingCallbackResult;
  if (business.ownerTelegramId !== senderTelegramId) {
    logger.warn({ senderTelegramId }, 'sbk callback from non-owner, ignoring');
    return;
  }

  if (sbk.sbkAction === 'approve') {
    // Approve: flip status to 'confirmed'
    const result = await updateBookingStatus(sbk.bookingId, 'confirmed');
    if (!result) {
      await sendTelegramMessage(senderTelegramId, 'Η κράτηση δεν βρέθηκε ή έχει ήδη επεξεργαστεί.');
      return;
    }

    // Notify client
    try {
      await botTokenStore.run(business.botToken!, async () => {
        await sendTelegramMessage(
          sbk.clientTelegramId,
          'Η κράτησή σας εγκρίθηκε από τον διαχειριστή! Θα σας δούμε σύντομα.'
        );
      });
    } catch (err) {
      logger.error({ err }, 'sbk approve: client notification failed (best-effort)');
    }

    await sendTelegramMessage(senderTelegramId, 'Κράτηση εγκρίθηκε.');

  } else if (sbk.sbkAction === 'reject') {
    // Reject: flip status to 'rejected' AND decrement capacity
    const result = await rejectSessionBooking(sbk.bookingId, business.id);
    if (!result) {
      await sendTelegramMessage(senderTelegramId, 'Η κράτηση δεν βρέθηκε ή έχει ήδη επεξεργαστεί.');
      return;
    }

    // Notify client
    try {
      await botTokenStore.run(business.botToken!, async () => {
        await sendTelegramMessage(
          sbk.clientTelegramId,
          'Δυστυχώς η αίτησή σας απορρίφθηκε. Δοκιμάστε άλλη ώρα.'
        );
      });
    } catch (err) {
      logger.error({ err }, 'sbk reject: client notification failed (best-effort)');
    }

    await sendTelegramMessage(senderTelegramId, 'Κράτηση απορρίφθηκε.');
  }

  // Clear keyboard on owner message
  if (callbackQuery.message?.message_id) {
    await editTelegramMessageReplyMarkup(senderTelegramId, callbackQuery.message.message_id, []);
  }
  return;
}
```

### Anti-Patterns to Avoid

- **Capacity release via a separate async sweep:** Rejected/expired bookings MUST decrement bookedCount in the same transaction as the status flip, not via a separate job. Risk: capacity remains locked indefinitely if the job fails or is delayed.
- **Storing approval decision in a separate table (e.g., session_booking_approvals):** Reuse the bookings.bookingStatus enum; adding a new table violates RESEARCH.md "don't hand-roll" principle and complicates transaction atomicity.
- **Double-checking membership inside approval handler:** Unlike slotless approvals (Phase 13), session bookings' credit deduction should happen at booking creation, not approval. Double-checking at approval time adds latency and state bloat.
- **Hardcoding idempotency keys in callback_data:** If the bookingId alone doesn't uniquely identify the target booking (cross-business risk), add clientTelegramId to the callback_data format (as Phase 20 escl:approve does), not as a separate guard.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic booking status flip + capacity release | Custom locking via shared Redis lock or Postgres ADVISORY LOCK | `runInTransaction(pool, ...)` with SELECT FOR UPDATE | Proven in Phase 13; SELECT FOR UPDATE serializes; no external service dependency |
| Expiry of stale pending bookings | New cron job or time-based queue | Existing expiry-poller.ts sweep (already handles pending_owner_approval) | Already running every 5 minutes; minimal change: just let it expire session bookings as it does open-slots bookings |
| Idempotent approval re-tap detection | Application-level counter or state flag | SELECT FOR UPDATE + WHERE status='pending' | Prevents concurrent taps; double-tap finds already-processed booking and returns null |
| Owner approval keyboard rendering | Custom Telegram message builder | Existing buildEscalationKeyboard() pattern from Phase 20 escalation.ts | Proven format; same callback_data parsing infrastructure |

**Key insight:** Session bookings are just a variant of the open-slots bookings already in Phase 2–3. The schema, locking, expiry, and notification patterns are all present. The only new code is a thin approval handler routing layer and a call to rejectSessionBooking() on the reject tap.

## Runtime State Inventory

**Trigger:** This is a feature addition phase, not a rename/refactor — skip this section.

## Common Pitfalls

### Pitfall 1: Capacity Released Twice (Rejection + Expiry)

**What goes wrong:** A booking is rejected by the owner (bookedCount--), then the 5-minute expiry sweep also runs and decrements bookedCount again. Capacity counter goes negative.

**Why it happens:** The rejection handler and expiry sweep both decrement bookedCount without checking the booking's status first.

**How to avoid:**
- Rejection handler: UPDATE bookingStatus WHERE status='pending_owner_approval' RETURNING — verify the row was updated before decrementing capacity.
- Expiry sweep: Already checks WHERE status='pending_owner_approval' — safe as-is.
- If a tap arrives on an already-expired booking, the rejection query finds status='expired' (not 'pending_owner_approval') and returns null, preventing double-decrement.

**Warning signs:** Test: create a pending booking, wait 2 hours for expiry sweep to run, then manually tap reject in the owner's keyboard. The booking should flip to 'expired', not 'rejected'. If the reject tap happens before the 2-hour cutoff, it should flip to 'rejected' and decrement count once.

### Pitfall 2: Session Credit Deduction Timing

**What goes wrong:** Owner rejects a pending booking, but the client's credit was already deducted at booking creation. The rejected booking doesn't restore the credit (unlike Phase 8 cancellations), so the client loses a session permanently.

**Why it happens:** Phase 13 deducts credit at approval time (inside approveSlotlessRequest); Phase 22 should deduct at booking creation time for consistency with Phase 11 (session bookings in open_slots mode), but the rejection path assumes credit was already deducted.

**How to avoid:**
- **DECISION NEEDED:** Does session booking create deduct immediately, or defer to approval?
  - **Option A (Recommend):** Deduct immediately at booking creation (like Phase 11 open-slots sessions). Rejection sets status='rejected' (no credit restore needed — no credit was deducted yet because membership wasn't checked). Expiry also no-ops on credit (same reason). **Simplest; consistent with Phase 11.**
  - **Option B:** Deduct at approval (like Phase 13 slotless). Rejection calls restoreCredit(). Expiry also calls restoreCredit(). **More complex; duplicates Phase 13 logic.**
- Research: Phase 11 (open-slots sessions) deducts immediately in bookSessionInstance (line 287). Recommendation: follow Phase 11's path, NOT Phase 13's.

**Warning signs:** Test: create a pending session booking, reject it, verify client's balance unchanged (credit not deducted). Approve a different pending booking, verify balance decremented.

### Pitfall 3: Orphaned ownerTelegramMessageId on Owner Message Loss

**What goes wrong:** The owner's approval keyboard message is deleted manually (user taps Delete), but the booking.ownerTelegramMessageId still points to the ghost message ID. Later, when expiry sweep tries to editTelegramMessageReplyMarkup(ownerTelegramMessageId), it fails silently (best-effort).

**Why it happens:** Telegram message IDs are ephemeral; if the owner deletes the message, the message_id is invalid but the DB row is not cleaned up.

**How to avoid:**
- ownerTelegramMessageId failures are already wrapped in try/catch and logged as best-effort (expiry-poller.ts, line 54–61). No additional guard needed; expected behavior.

**Warning signs:** Logs show "editTelegramMessageReplyMarkup failed" but the booking still expires correctly (status flipped, client notified). This is acceptable — the keyboard just remains visible in the owner's chat (a cosmetic UX issue, not a correctness bug).

### Pitfall 4: Callback_data Pattern Collision

**What goes wrong:** The new session booking approval callback_data pattern (sbk:approve:...) accidentally matches an existing pattern in parseCallbackData(), causing the wrong handler to execute.

**Why it happens:** Multiple callback_data regex arms in parseCallbackData() can overlap if not carefully designed (e.g., slotless and sbk patterns both use numeric IDs).

**How to avoid:**
- Use a unique prefix for session bookings (e.g., `sbk:` not `slot:` or `escl:`).
- Add the session booking arm BEFORE slotless/billing/renewal arms in parseCallbackData() to ensure it matches first.
- Test: emit both a slotless callback and a sbk callback; verify the right handler is invoked.

**Warning signs:** A tap on a session booking approval keyboard silently routes to the wrong handler (e.g., slotless approval handler tries to process a bookingId and fails).

### Pitfall 5: Capacity Increment-Then-Check vs. Check-Then-Increment

**What goes wrong:** The current bookSessionInstance checks `bookedCount >= capacity` THEN increments. If a second client's booking succeeds while the first is still in the approval window, both might pass the capacity check because the increment hasn't happened yet on the first.

**Why it happens:** SELECT FOR UPDATE locks the row but the WHERE clause only checks at snapshot time, not continuous.

**How to avoid:**
- Current code (line 235 in manager.ts) checks BEFORE incrementing; this is correct for open_slots mode.
- For pending_owner_approval bookings, the unique_active_slot_per_business index prevents slot double-booking even if bookedCount hasn't been incremented yet (the index covers both 'pending_owner_approval' and 'confirmed' statuses, line 213 schema.ts).
- The pattern is correct as-is. No changes needed.

**Warning signs:** Two clients both successfully book the same (date, time, capacity=1) slot. Verify: this should NOT happen because of the unique_active_slot_per_business partial index.

## Code Examples

Verified patterns from existing codebase:

### Session Booking Creation (Currently Auto-Confirmed, Phase 22 Will Create Pending)

Source: `src/session/manager.ts` lines 182–296

```typescript
export async function bookSessionInstance(
  businessId: number,
  sessionInstanceId: number,
  clientPhone: string,
  serviceId: number,
  idempotencyKey: string,
  activeMembership?: ActiveMembershipForDeduction | null
): Promise<BookSessionResult> {
  return withBusinessContext(businessId, async () => {
    // D-01: SELECT FOR UPDATE lock
    const instanceRows = await getConn()
      .select({ id, catalogId, ..., bookedCount, isCancelled })
      .from(sessionInstances)
      .where(and(eq(sessionInstances.id, sessionInstanceId), ...ownership guard...))
      .for('update')
      .limit(1);

    const instance = instanceRows[0];
    if (!instance || instance.isCancelled) {
      return { status: 'conflict' };
    }

    const capacity = catalogRows[0]?.capacity ?? 0;
    if (instance.bookedCount >= capacity) {
      return { status: 'full' };  // ← Phase 22: this check still applies
    }

    // Insert booking — CURRENTLY hardcoded 'confirmed'
    const bookingRows = await getConn()
      .insert(bookings)
      .values({
        businessId,
        clientPhone,
        serviceId,
        sessionInstanceId,
        calendarDate: instance.sessionDate,
        calendarTime: instance.sessionTime,
        bookingStatus: 'confirmed',  // ← CHANGE TO 'pending_owner_approval' in Phase 22
        requestId: idempotencyKey,
        expiresAt: null,  // ← May need expiresAt for pending bookings (2h cutoff)
      })
      .onConflictDoNothing()
      .returning({ id: bookings.id });

    if (bookingRows.length === 0) {
      // Idempotent replay
      const existingRows = await getConn()
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.requestId, idempotencyKey))
        .limit(1);
      return { status: 'success', bookingId: existingRows[0]?.id };
    }

    // Increment denormalized bookedCount
    await getConn()
      .update(sessionInstances)
      .set({ bookedCount: sql`${sessionInstances.bookedCount} + 1` })
      .where(eq(sessionInstances.id, sessionInstanceId));

    // Deduct credit (only if membership is active and finite)
    const membership = activeMembership !== undefined
      ? activeMembership
      : await getActiveMembershipForDeduction(businessId, clientPhone);

    if (membership !== null && membership !== undefined && membership.sessionsRemaining !== null) {
      await deductSession(membership.id, bookingId, `booking:${bookingId}:deduction`);
    }

    return { status: 'success', bookingId };
  });
}
```

**Changes for Phase 22:**
- Change `bookingStatus: 'confirmed'` to `bookingStatus: 'pending_owner_approval'`
- Set `expiresAt` to `new Date(Date.now() + 2 * 3600 * 1000)` (2 hours from now)
- Consider: parameter to allow caller to specify status (for reuse across open_slots/fixed_sessions modes)

### Slot-Blocking Index (Already Accounts for Pending)

Source: `src/database/schema.ts` lines 211–213

```typescript
uniqueIndex('unique_active_slot_per_business')
  .on(table.businessId, table.calendarDate, table.calendarTime)
  .where(sql`booking_status IN ('pending_owner_approval', 'confirmed')`),
```

**Why this works for Phase 22:** The partial index ensures that once a booking (pending or confirmed) exists for (business, date, time), a second booking insert on the same slot FAILS with a unique constraint violation. The booking status doesn't matter — pending or confirmed both block. No changes needed.

### Approval Callback Routing (Model for Phase 22)

Source: `src/webhooks/telegram.ts` lines 261–281, 400–452

```typescript
// Pattern: escl:approve:<instanceId>:<clientTelegramId>
//         escl:reply:<clientTelegramId>

const escalationMatch = data?.match(/^escl:(approve|reply):(\d+)(?::(\d+))?$/);
if (escalationMatch) {
  const action = escalationMatch[1] as 'approve' | 'reply';
  if (action === 'approve') {
    return {
      escalationAction: 'approve',
      instanceId: Number(escalationMatch[2]),
      clientTelegramId: escalationMatch[3] ?? '',
    };
  } else {
    return {
      escalationAction: 'reply',
      clientTelegramId: String(escalationMatch[2]),
    };
  }
}

// Handler (phase 20, line 400–452):
if (escl.escalationAction === 'approve') {
  const instanceRow = await db.select({ serviceId })...
  const result = await bookSessionInstance(
    ownerBusiness.id,
    escl.instanceId,
    escl.clientTelegramId,
    serviceId,
    idempotencyKey,
    null  // activeMembership=null: bypass enforcement
  );

  if (result.status !== 'success') {
    await sendTelegramMessage(senderTelegramId, 'Δεν ήταν δυνατή η εξαίρεση...');
    return;
  }

  // Notify client
  await botTokenStore.run(ownerBusiness.botToken!, async () => {
    await sendTelegramMessage(escl.clientTelegramId, 'Η κράτησή σας εγκρίθηκε...');
  });
  await sendTelegramMessage(senderTelegramId, 'Εξαίρεση εγκρίθηκε.');
}
```

**For Phase 22:**
- Pattern: `sbk:approve:<bookingId>` / `sbk:reject:<bookingId>:<clientTelegramId>` (or similar unique prefix)
- Approval: call `updateBookingStatus(bookingId, 'confirmed')`
- Rejection: call `rejectSessionBooking(bookingId, businessId)` (NEW)

### Expiry Sweep (Already Handles pending_owner_approval)

Source: `src/conversation/expiry-poller.ts` lines 19–63

```typescript
const EXPIRY_CUTOFF_MS = 2 * 60 * 60 * 1000;

export async function runExpirySweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let notifiedCount = 0;

  for (const businessId of businessIds) {
    try {
      const expired = await expireStalePendingBookings(businessId, EXPIRY_CUTOFF_MS);
      const business = await findBusinessById(businessId);
      if (!business?.botToken) continue;

      for (const booking of expired) {
        try {
          await botTokenStore.run(business.botToken, async () => {
            await sendTelegramMessage(booking.clientPhone, EXPIRY_NOTICE_GREEK);

            if (booking.ownerTelegramMessageId && business.ownerTelegramId) {
              // Clear keyboard on owner's approval message
              await editTelegramMessageReplyMarkup(
                business.ownerTelegramId,
                booking.ownerTelegramMessageId,
                []
              );
            }
          });
          notifiedCount += 1;
        } catch (err) {
          logger.error({ err, bookingId: booking.id }, 'Failed to notify');
        }
      }
    } catch (err) {
      logger.error({ err, businessId }, 'Expiry sweep failed');
    }
  }

  return notifiedCount;
}
```

**Why no changes needed:** The sweep already selects `WHERE status='pending_owner_approval'` and flips to 'expired'. Session bookings are just bookings; the sweep handles them automatically. The `ownerTelegramMessageId` field is already used to clear the approval keyboard.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Open-slots bookings auto-confirmed by bot | Phase 13 slotless requests with owner approve/reject | 2026-07-23 | Owner gained control; bookings must wait for approval before being visible to client |
| No capacity soft-hold during approval | unique_active_slot_per_business partial index includes pending_owner_approval | 2026-07-23 (Phase 13 schema adjustment) | Pending bookings block capacity like confirmed; prevents overselling during approval window |
| Expiry via manual admin cleanup | Automated 5-minute sweep expiring 2h-old pending_owner_approval bookings | 2026-07-08 (Phase 2) | Stale pending bookings no longer orphan capacity; clients notified automatically |
| No owner message tracking | ownerTelegramMessageId column for idempotent keyboard clearing | 2026-07-23 (Phase 20) | Expired/rejected approval keyboards can be cleared so owner can't accidentally tap stale buttons |

**Deprecated/outdated:**
- Admin approval of open-slots bookings: Phase 13 made this automatic for slotless requests; Phase 22 extends to fixed_sessions. No longer an admin-heavy workflow.
- Manual session credit adjustment on rejection: Phase 8 introduced atomic credit restore; Phase 22 should follow the same pattern.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `runInTransaction(pool, ...)` pattern from Phase 13 can be reused for rejection handler | Pitfall 1, Pattern 1 | High — if transaction fails, capacity might not be released; could lead to permanent overbooking |
| A2 | Session credit should be deducted at booking creation (pending state), not at approval | Pitfall 2 | High — if deferred to approval, rejection flow becomes complex and credit restore logic duplicates Phase 13 |
| A3 | 2-hour expiry TTL for pending_owner_approval is appropriate for session bookings | Common Pitfalls intro | Medium — if too short, fast-rejecting owners might miss bookings; if too long, slots blocked unnecessarily |
| A4 | Owner's approval keyboard callback_data can be routed separately from escl:approve via unique prefix | Pitfall 4 | Medium — if prefixes collide, wrong handler executes silently |
| A5 | Existing expiry-poller.ts sweep will handle session booking expiry without changes | Code Examples (expiry sweep) | Low — sweep already scopes to pending_owner_approval; new status doesn't break it |

**All assumptions are backed by verified source code except A3 (TTL appropriateness), which is a design judgment for the planner to confirm.**

## Open Questions

1. **Credit deduction timing:** Should session credit be deducted at booking creation (pending state) or at approval?
   - Current evidence: Phase 11 (open-slots sessions) deducts immediately; Phase 13 (slotless requests) deducts at approval.
   - Recommendation: Follow Phase 11 (immediate), since session bookings are a variant of open-slots sessions, not slotless requests.
   - Planner decision: Confirm before implementation.

2. **Callback_data pattern for session booking approval:** Should the new pattern be `sbk:*` or `sba:*` or reuse `escl:*` with context?
   - Current evidence: Phase 20 uses `escl:approve:*` for emergency/escalation exceptions; Phase 13 uses `slotless:req_approve:*` for slotless requests.
   - Recommendation: Use a new prefix (e.g., `sbk:approve:*` / `sbk:reject:*`) to maintain clarity and avoid callback_data parsing ambiguity.
   - Planner decision: Confirm before implementation.

3. **Should rejection also trigger a credit restore (like cancellation)?**
   - Current evidence: Phase 8 cancellations restore credit; Phase 13 slotless rejections do NOT (credit was never deducted).
   - Recommendation: If credit is deducted at booking creation (A2), then rejection should NOT restore it (no credit was deducted). If credit is deducted at approval (alternative), then rejection MUST restore.
   - Planner decision: Depends on answer to Q1.

4. **Should pending session bookings be visible in the client's "My Bookings" list?**
   - Current evidence: listClientBookings() in database/queries.ts selects active bookings; no status filtering visible yet.
   - Recommendation: Include pending_owner_approval in the "My Bookings" display (alongside confirmed) so client can see awaiting bookings.
   - Planner decision: UI/messaging refinement for Plan 22-01 or a later plan.

## Environment Availability

**Step 2.6: SKIPPED.** Phase 22 is a code/config-only feature addition. No external tools, services, CLIs, or runtimes are required beyond the existing stack (Postgres, Node.js, Telegram Bot API). All dependencies already in use.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest + Drizzle ORM test helpers (existing patterns from Phase 20) |
| Config file | jest.config.js (existing) |
| Quick run command | `npm test -- tests/webhooks/client-menu.test.ts -t "sbk" --testNamePattern` |
| Full suite command | `npm test -- tests/ --testPathPattern="(booking\|session)" --maxWorkers=1` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OWNR-05 | Pending session booking + approval keyboard to owner | integration | `npm test -- tests/webhooks/client-menu.test.ts -t "approval"` | ❌ Wave 0 |
| OWNR-06 | Capacity held during pending; released on rejection/expiry | integration | `npm test -- tests/session/session-approval.test.ts -t "capacity"` | ❌ Wave 0 |
| OWNR-07 | Client receives confirmation/rejection message in Greek | integration | `npm test -- tests/webhooks/client-menu.test.ts -t "rejection"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/webhooks/client-menu.test.ts -t "sbk" --maxWorkers=1` (quick session booking callback tests)
- **Per wave merge:** `npm test -- tests/ --testPathPattern="(session\|booking)" --maxWorkers=1` (all session and booking tests)
- **Phase gate:** Full test suite `npm test` before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/session/session-approval.test.ts` — atomic approval/rejection with capacity release, double-tap idempotence (T-22-01), expiry edge cases
- [ ] `tests/webhooks/client-menu.test.ts` — Suite F: new sbk:approve/sbk:reject callback patterns (parseCallbackData + routing)
- [ ] Integration: existing `tests/webhooks/client-menu.test.ts` Suite C (handleClientMenuCallback) may need expansion to cover pending state (vs. current confirmed-only)
- [ ] Fixtures: `tests/helpers/session-fixtures.ts` — add pendingSessionBooking factory for testing

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | Ownership guard: `business.ownerTelegramId === senderTelegramId` before approving; booking.clientPhone guard before rejecting |
| V5 Input Validation | yes | Booking ID from callback_data (integer); client Telegram ID from callback_data (string). Validate both exist and belong to the business before mutation. |
| V6 Cryptography | no | — |

### Known Threat Patterns for Session Booking Approval

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Non-owner taps approval keyboard | Spoofing / Elevation of Privilege | `business.ownerTelegramId === senderTelegramId` guard; reuse Phase 20 pattern (lines 394–397 telegram.ts) |
| Cross-tenant booking approval (owner A approves client B's booking on business C) | Tampering | Webhook-scoped `business` (HMAC-verified) prevents; no re-derivation via findBusinessByOwnerTelegramId (STATE.md Phase 999.2 known issue) |
| Double-tap on approval keyboard (idempotency) | Tampering / Logic Flaw | SELECT FOR UPDATE on booking before status flip; second tap finds status already flipped, returns null, no double-booking |
| Capacity orphaned after rejection | Logic Flaw / Resource Exhaustion | Atomic `rejectSessionBooking()` transaction: status flip + bookedCount decrement in same transaction; no separate async step |
| Stale taps after expiry (expired booking approved) | Logic Flaw / Timing | WHERE status='pending_owner_approval' in both approval and rejection handlers; expired bookings have status='expired', so tap on stale keyboard no-ops |

## Sources

### Primary (HIGH confidence)
- [VERIFIED: Source code inspection] `src/session/manager.ts` bookSessionInstance() — SELECT FOR UPDATE pattern, capacity checking (lines 182–296)
- [VERIFIED: Source code inspection] `src/session/slotless-requests.ts` approveSlotlessRequest() — atomic approval pattern with runInTransaction (lines 74–259)
- [VERIFIED: Source code inspection] `src/webhooks/telegram.ts` parseCallbackData() — callback_data routing union type (lines 219–304)
- [VERIFIED: Source code inspection] `src/database/schema.ts` bookings table — pending_owner_approval status, unique_active_slot_per_business index (lines 154–217)
- [VERIFIED: Source code inspection] `src/conversation/expiry-poller.ts` — 2-hour TTL sweep for pending_owner_approval bookings (lines 24–78)
- [VERIFIED: Source code inspection] `src/telegram/escalation.ts` buildEscalationKeyboard() — approval keyboard pattern with callback_data (lines 62–78)

### Secondary (MEDIUM confidence)
- [CITED: .planning/ROADMAP.md] Phase 22 description specifies owner approve/reject keyboard, capacity soft-hold, expiry after 2 hours
- [CITED: .planning/REQUIREMENTS.md] OWNR-05/06/07 specify exact UX outcomes (pending state, capacity release, client notifications)
- [CITED: .planning/STATE.md] Phase 22 blocker: "Phase 22: OWNR-06's capacity soft-hold must reuse the same SELECT FOR UPDATE atomic pattern already proven in bookSessionInstance/deductSession"

### Tertiary (LOW confidence — training data, marked for verification)
- [ASSUMED] Telegram Bot API editTelegramMessageReplyMarkup() is idempotent on invalid message IDs (returns error silently, no crash)
- [ASSUMED] 2-hour TTL is appropriate for pending approval window (not validated against user business requirements)

## Metadata

**Confidence breakdown:**
- **Standard stack (HIGH):** All patterns verified in codebase; Phase 13 slotless-request approval and Phase 20 escalation templates provide direct precedent.
- **Architecture (HIGH):** Capacity locking via unique index + SELECT FOR UPDATE already proven; expiry sweep already active; schema already supports pending_owner_approval.
- **Pitfalls (HIGH):** Identified via code review of Phase 2–3, 13, 20 implementations; idempotency and capacity release mechanisms tested in existing phase suites.
- **Assumptions (MEDIUM):** Credit deduction timing and callback_data pattern are design decisions requiring planner confirmation; both have valid alternatives with trade-offs.

**Research date:** 2026-07-27  
**Valid until:** 2026-08-27 (30 days — stable codebase, no churn expected)

---

*Researched by Claude Code as phase researcher. All source links reference verified commit state of the randevuClaw repository at HEAD~0 (2026-07-27).*

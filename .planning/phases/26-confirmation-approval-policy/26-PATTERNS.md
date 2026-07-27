# Phase 26: Confirmation & Approval Policy - Pattern Map

**Mapped:** 2026-07-28
**Files analyzed:** 9 files (6 modified, 3 new/new sections)
**Analogs found:** 9 / 9 (100%)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/database/schema.ts` | config/schema | CRUD | `src/database/schema.ts:178` (existing) | exact—no change needed |
| `src/webhooks/telegram.ts` | middleware/webhook | request-response + CRUD | `src/webhooks/telegram.ts:840-856` | exact—mirror cascade pattern |
| `src/session/manager.ts` | service | CRUD | `src/session/manager.ts:190-313` | exact—add parameter |
| `src/billing/queries.ts` | service/query | CRUD | `src/billing/queries.ts:575-603` | exact—reuse, no change |
| `src/conversation/function-executor.ts` | service/executor | request-response + CRUD | `src/conversation/function-executor.ts:723-814` | exact—modify rescheduleSessionTool |
| `src/utils/greek-messages.ts` | utility/constants | config | (NEW file) | N/A |
| `src/telegram/handlers/admin-menu.ts` | component/menu | request-response | `src/telegram/handlers/admin-menu.ts:326-338` | exact—showCancelClassConfirm pattern |
| `src/telegram/handlers/client-menu.ts` | component/menu | request-response | `src/telegram/handlers/client-menu.ts:262-271` | exact—approval keyboard pattern |
| `src/onboarding/ai-owner-agent.ts` | service/agent | request-response + CRUD | `src/onboarding/ai-owner-agent.ts:563-587` | exact—tool handler pattern |

---

## Pattern Assignments

### `src/database/schema.ts` (config/schema, CRUD)

**Analog:** `src/database/schema.ts:178` (self-reference—column already exists)

**Status:** NO CHANGES NEEDED. The `rescheduledFromBookingId` column already exists on the `bookings` table (line 178). Phase 26 reuses this for session-class reschedules via the `bookSessionInstance` plumbing change (see below), not via schema migration.

**Existing field** (lines 175-178):
```typescript
// Audit-trail only, no FK: a self-referencing FK needs an AnyPgColumn
// type-annotated forward reference in Drizzle; skipped since this field
// is not integrity-critical.
rescheduledFromBookingId: integer('rescheduled_from_booking_id'),
```

---

### `src/webhooks/telegram.ts` (middleware, request-response + CRUD)

**Analog:** Same file — existing cascade-cancel pattern at lines 840-856

**Mirror Location:** `sbk:approve` branch (lines 587-604) needs the cascade-cancel logic added here.

**Existing sbk:approve/sbk:reject entry point** (lines 587-631):
```typescript
if (sbk.sbkAction === 'approve') {
  const updated = await updateBookingStatusIfPending(sbk.bookingId, 'confirmed');
  if (!updated) {
    await sendTelegramMessage(senderTelegramId, 'Η κράτηση δεν βρέθηκε ή έχει ήδη επεξεργαστεί.');
    return;
  }
  try {
    await sendTelegramMessage(
      updated.clientPhone,
      'Η κράτησή σας εγκρίθηκε από τον διαχειριστή! Θα σας δούμε σύντομα.'
    );
  } catch (err) {
    logger.error({ err, bookingId: updated.id }, 'sbk approve: client notification failed (best-effort)');
  }
  await sendTelegramMessage(senderTelegramId, 'Κράτηση εγκρίθηκε.');
} else {
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
}
```

**Cascade-cancel template** (lines 840-856) — Copy this logic pattern into the `sbk:approve` branch:
```typescript
if (parsed.action === 'approve') {
  if (updated.rescheduledFromBookingId) {
    // Reschedule cascade: confirming the new booking also releases the
    // original slot it replaced. This targets a DIFFERENT booking row
    // than the one just compare-and-swapped, so it stays a plain,
    // unconditional updateBookingStatus call.
    await updateBookingStatus(updated.rescheduledFromBookingId, 'cancelled');
    // Best-effort delete of the superseded booking's Calendar event
    // (D-15: never rethrows, a failure here is retried by the poller).
    try {
      const oldBooking = await findBookingByIdUnscoped(updated.rescheduledFromBookingId);
      if (oldBooking) await deleteBookingFromCalendar(oldBooking, bookingBusiness);
    } catch (err) {
      logger.error(
        { err, bookingId: updated.rescheduledFromBookingId },
        "Failed to delete superseded booking's calendar event"
      );
    }
  }
  // ... rest of approve logic
}
```

**Key imports needed** (lines 1-20, check existing):
- `updateBookingStatus`, `findBookingByIdUnscoped` from `src/database/queries`
- `deleteBookingFromCalendar` from `src/calendar/sync`
- These should already be imported; if not, add them.

**Atomicity note:** The new cascade-cancel logic runs inside the same `withBusinessContext` transaction wrapper that already guards the entire `handleCallbackQuery` call (line 888 comment), so no new transaction wrapper is needed.

---

### `src/session/manager.ts` (service, CRUD)

**Analog:** `src/session/manager.ts:190-313` (`bookSessionInstance` function)

**Change location:** Function signature (line 190-202) and values insertion (line 256-268)

**Current signature** (lines 190-202):
```typescript
export async function bookSessionInstance(
  businessId: number,
  sessionInstanceId: number,
  clientPhone: string,
  serviceId: number,
  idempotencyKey: string,
  activeMembership?: ActiveMembershipForDeduction | null,
  initialStatus: 'pending_owner_approval' | 'confirmed' = 'pending_owner_approval'
): Promise<BookSessionResult> {
```

**Add new optional parameter** (after `activeMembership`, before `initialStatus`):
```typescript
  rescheduledFromBookingId?: number | null,
```

**Current insert values** (lines 256-268):
```typescript
const bookingRows = await getConn()
  .insert(bookings)
  .values({
    businessId,
    clientPhone,
    serviceId,
    sessionInstanceId,
    calendarDate: instance.sessionDate,
    calendarTime: instance.sessionTime,
    bookingStatus: initialStatus,
    requestId: idempotencyKey,
    expiresAt: initialStatus === 'pending_owner_approval' ? new Date(Date.now() + 2 * 3600 * 1000) : null,
  })
  .onConflictDoNothing()
```

**Add to values object** (after `requestId`, before `expiresAt`):
```typescript
  rescheduledFromBookingId: rescheduledFromBookingId ?? null,
```

**Rationale:** Persist the link between new and old booking rows for the cascade-cancel pattern to find and cancel the old booking later.

---

### `src/billing/queries.ts` (service/query, CRUD)

**Analog:** `src/billing/queries.ts:575-603` (`restoreCredit` function)

**Status:** REUSE UNCHANGED. No modifications needed for Phase 26. The `sbk:reject` branch in `telegram.ts` (lines 617-623) already calls `releaseSessionCapacity` + `restoreCredit` for session bookings on reject, which is the correct pattern. Phase 26's sbk:approve addition does NOT restore credit on the new booking (only capacity is held during pending window per Phase 22's soft-hold pattern).

**Pattern summary** (for reference):
```typescript
export async function restoreCredit(
  membershipId: number,
  bookingId: number,
  idempotencyKey: string
): Promise<void> {
  // Fetch current membership state (avoids stale-expiry decisions)
  const membershipRows = await getConn().select({...}).from(memberships).where(...);
  const membership = membershipRows[0];
  if (!membership) return;
  if (membership.sessionsRemaining === null) return; // Unlimited — skip
  if (membership.expiresAt < new Date()) return;     // Expired — skip
  
  // Insert credit_restored ledger row (idempotency guard)
  await getConn().insert(membershipLedger).values({...}).onConflictDoNothing();
}
```

---

### `src/conversation/function-executor.ts` (service, request-response + CRUD)

**Analog:** `src/conversation/function-executor.ts:723-814` (`rescheduleSessionTool` function)

**Primary changes:**

1. **Remove immediate cancel/restore** (lines 767-772):
   - DELETE these lines:
     ```typescript
     // Cancel old booking and restore credit (same pattern as cancelAppointmentTool)
     await updateBookingStatus(original.id, 'cancelled');
     const oldMembershipId = await findMembershipByBooking(original.id);
     if (oldMembershipId !== null) {
       await restoreCredit(oldMembershipId, original.id, 'booking:' + original.id + ':credit');
     }
     ```

2. **Remove 'confirmed' override** (line 791):
   - CHANGE:
     ```typescript
     // Phase 22: reschedule keeps its pre-existing immediate-confirm behavior
     // deliberately — a client rescheduling an already-confirmed booking to a
     // new slot is not a new approval request. Without this override the new
     // pending-by-default default would leave every reschedule stuck pending
     // with no keyboard ever sent (this call site sends no owner notification
     // at all, before or after this phase).
     'confirmed'
     ```
   - TO (just remove the parameter entirely, use default):
     ```typescript
     // Phase 26: reschedule now requires owner approval like new bookings.
     // Remove the 'confirmed' override so bookSessionInstance uses its
     // default initialStatus = 'pending_owner_approval'.
     // (no parameter passed)
     ```

3. **Add rescheduledFromBookingId parameter** (at call site, line 778-792):
   - CHANGE:
     ```typescript
     const result = await bookSessionInstance(
       context.business.id,
       parsed.new_session_instance_id,
       context.clientPhone,
       newSession.serviceId,
       newKey,
       activeMembership,
       'confirmed'
     );
     ```
   - TO:
     ```typescript
     const result = await bookSessionInstance(
       context.business.id,
       parsed.new_session_instance_id,
       context.clientPhone,
       newSession.serviceId,
       newKey,
       activeMembership,
       undefined,  // rescheduledFromBookingId parameter (new)
       // Don't pass initialStatus — let it default to 'pending_owner_approval'
     );
     ```
   - Or more clearly (restructure for clarity):
     ```typescript
     const result = await bookSessionInstance(
       context.business.id,
       parsed.new_session_instance_id,
       context.clientPhone,
       newSession.serviceId,
       newKey,
       activeMembership,
       original.id  // rescheduledFromBookingId — links new booking to old
       // initialStatus defaults to 'pending_owner_approval'
     );
     ```

**Comment block to remove/update** (lines 785-790):
Old comment explaining the 'confirmed' override is now outdated and should be removed or simplified to explain the new Phase 26 behavior.

**Success message update** (lines 807-813):
The return object is already correct — no changes needed. The client will be notified that the reschedule is pending owner approval (via owner alert sent by the default pending-booking flow in `client-menu.ts`).

---

### `src/utils/greek-messages.ts` (NEW FILE — utility/constants, config)

**No analog** — This is a new utility file for shared Greek message constants.

**Structure:**
```typescript
// src/utils/greek-messages.ts
// Constants for Greek UI text (button labels, confirmation prompts) used across
// admin-menu.ts, client-menu.ts, and ai-owner-agent.ts.

// Confirmation button pairs (contextual labels per action type)
export const CONFIRM_BUTTON_LABELS = {
  // Approve/Reject pair (for booking approval, reschedulule approval)
  APPROVE: 'Έγκριση',
  REJECT: 'Απόρριψη',

  // Delete/Cancel pair (for delete_service, cancel_session)
  DELETE: 'Διαγραφή',
  CANCEL: 'Άκυρο',

  // Generic Yes/No (fallback if not using contextual labels)
  YES: 'Ναι',
  NO: 'Όχι',
};

// Confirmation prompt templates (placeholder examples)
export const CONFIRMATION_PROMPTS = {
  DELETE_SERVICE: (serviceName: string) => `Να διαγραφεί η υπηρεσία "${serviceName}";`,
  UPDATE_SERVICE_PRICE: (serviceName: string, newPrice: string) =>
    `Να αλλαχθεί η τιμή της "${serviceName}" σε ${newPrice}€;`,
  CLOSE_DAY: (dayName: string) => `Να κλειστεί η ημέρα ${dayName};`,
  CANCEL_SESSION: (date: string, time: string) => `Να ακυρωθεί το μάθημα ${date} ${time};`,
  ASSIGN_CLIENT: (clientPhone: string, date: string, time: string) =>
    `Να οριστεί ο πελάτης ${clientPhone} στο μάθημα ${date} ${time};`,
};
```

**Usage:**
- Import in `admin-menu.ts`, `client-menu.ts`, `ai-owner-agent.ts`
- Use constants instead of inline Greek strings in confirmation dialogs
- Example: `{ text: CONFIRM_BUTTON_LABELS.DELETE, callback_data: '...' }`

---

### `src/telegram/handlers/admin-menu.ts` (component/menu, request-response)

**Analog:** `src/telegram/handlers/admin-menu.ts:326-338` (`showCancelClassConfirm`)

**Existing confirmation pattern** (lines 326-338):
```typescript
export async function showCancelClassConfirm(chatId: string, instanceId: number): Promise<void> {
  const cancelConfirmData = `menu:classes:cancel_yes:${instanceId}`;
  const cancelAbortData = `menu:classes:cancel_no:${instanceId}`;
  assertCallbackDataSize(cancelConfirmData);
  assertCallbackDataSize(cancelAbortData);

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Να ακυρωθεί το μάθημα #${instanceId};`,
    [[
      { text: 'Ναι', callback_data: cancelConfirmData },
      { text: 'Όχι', callback_data: cancelAbortData },
    ]]
  );
}
```

**Pattern to apply to other CONF-01 actions:**
1. Create similar `showXxxConfirm` functions for each of the 5 CONF-01 actions (delete_service, update_service_price, close_day, cancel_session, assign_client_to_session)
2. Use contextual button labels from `CONFIRM_BUTTON_LABELS` (e.g., DELETE/CANCEL for delete-type, APPROVE/REJECT for approve-type)
3. Restate action + context (date, service name, client name) in the prompt text per D-06
4. Build callback_data with action-specific naming (e.g., `menu:service:delete_yes:${serviceId}`)
5. Assert callback_data size (existing pattern, line 35-42)

**Note:** The admin-menu currently only routes the cancel_session flow via `showCancelClassConfirm`. Phase 26 may need to add confirmation prompts for update_hours (close_day), or these may be handled in `ai-owner-agent.ts` tool handlers (see below).

---

### `src/telegram/handlers/client-menu.ts` (component/menu, request-response)

**Analog:** `src/telegram/handlers/client-menu.ts:262-271` (approval keyboard with Έγκριση/Απόρριψη)

**Existing approval keyboard pattern** (lines 262-271):
```typescript
const approveData = `sbk:approve:${bookResult.bookingId}`;
const rejectData = `sbk:reject:${bookResult.bookingId}`;
assertCallbackDataSize(approveData);
assertCallbackDataSize(rejectData);
await botTokenStore.run(business.botToken, async () => {
  const msgResp = await sendTelegramMessageWithKeyboard(business.ownerTelegramId!, ownerText, [
    [
      { text: 'Έγκριση', callback_data: approveData },
      { text: 'Απόρριψη', callback_data: rejectData },
    ],
  ]);
  if (bookResult.bookingId) {
    await updateBookingOwnerMessageId(bookResult.bookingId, msgResp.messageId);
  }
});
```

**Apply to reschedule flow:**
When a reschedule booking is created via `rescheduleSessionTool` with `pending_owner_approval` status (not 'confirmed'), the same approval keyboard should be sent to the owner. This may already happen via the default pending-booking flow in `client-menu.ts` — verify that when a booking has `sessionInstanceId !== null` AND `bookingStatus === 'pending_owner_approval'`, the keyboard is sent.

**No changes needed here if:** The existing code already sends the keyboard for any pending session booking. Otherwise, ensure the keyboard is sent for session-mode pending bookings (whether new or rescheduled).

---

### `src/onboarding/ai-owner-agent.ts` (service/agent, request-response + CRUD)

**Analog:** `src/onboarding/ai-owner-agent.ts:563-587` (tool handler pattern for `update_service_price`)

**Existing tool handler structure** (lines 563-576):
```typescript
case 'update_service_price': {
  const { service_name, new_price_cents } = args;
  if (!service_name || new_price_cents === undefined) return 'Μη έγκυρα δεδομένα.';
  const match = svcList.find((s) => s.name.toLowerCase().includes(service_name.toLowerCase()));
  if (!match) return `Δεν βρέθηκε υπηρεσία με όνομα "${service_name}".`;
  // WR-04: wrap in withBusinessContext so RLS applies; businessId added to WHERE for ownership safety
  return withBusinessContext(business.id, async () => {
    await getConn()
      .update(services)
      .set({ price: new_price_cents })
      .where(eq(services.id, match.id));
    return `OK: τιμή "${match.name}" → ${(new_price_cents / 100).toFixed(2)}€`;
  });
}
```

**Pattern for Phase 26 confirmation additions:**

For the 5 CONF-01 actions that are Gemini-callable tools (delete_service, update_service_price, close_day, cancel_session, assign_client_to_session), each handler should:

1. **Parse & validate arguments** (existing pattern, no change)
2. **Show confirmation prompt** (NEW — before mutation):
   - Call a new `showConfirmationPrompt(chatId, actionType, context)` helper
   - Pass action type, context (service name, date, client, etc.)
   - The helper constructs the prompt text + contextual button labels
   - Owner taps Confirm/Cancel in Telegram
   - Callback routes back to the handler
3. **On confirmation callback:**
   - Execute the DB mutation (existing pattern)
   - Send success message to owner
4. **On cancellation callback:**
   - Send "cancelled" message to owner
   - No mutation

**Implementation approach (pseudocode):**
```typescript
case 'delete_service': {
  const { service_name } = args;
  // ... validation ...
  
  // NEW: Show confirmation, get callback data
  const confirmationId = `svc:delete:${match.id}`;
  await showServiceDeleteConfirm(ownerTelegramId, match.name, confirmationId);
  
  // Handler will exit here. When owner taps the callback button,
  // a NEW case (or separate dispatcher) handles:
  // - 'svc:delete:yes:{id}' → execute deletion + success message
  // - 'svc:delete:no:{id}' → send cancellation message
  
  return 'Σας αποστέλνεται αίτημα επιβεβαίωσης.';
}
```

**OR** (simpler, if tool handlers can't await callbacks):
- Keep the tool handler as-is (no confirmation)
- Let the planner decide if confirmation is in-scope for Phase 26 (CONTEXT.md lists these tools, but implementation detail is "Claude's Discretion")
- Confirmation may belong in a separate admin-menu flow, not in Gemini tool handlers

---

## Shared Patterns

### Transaction Atomicity
**Source:** `src/webhooks/telegram.ts:888-895` (`handleTelegramWebhookPost`)

**Apply to:** All callbacks that mutate bookings (sbk:approve, sbk:reject, cascade-cancel)

```typescript
export async function handleTelegramWebhookPost(req: Request, res: Response): Promise<void> {
  // ... validation ...
  
  // Wrap the entire callback handler in a transaction
  return withBusinessContext(businessId, async () => {
    // All DB mutations inside here run atomically
    // T-22-04: capacity release + credit restore both commit together,
    // or both roll back on error
    await handleCallbackQuery(...);
  });
}
```

**Key:** The cascade-cancel logic (updateBookingStatus + deleteBookingFromCalendar) runs inside the same `withBusinessContext` transaction, so old and new booking updates are atomic.

### Idempotency Guards
**Source:** `src/database/queries.ts:495-505` (`updateBookingStatusIfPending`)

**Apply to:** All booking status transitions

```typescript
export async function updateBookingStatusIfPending(
  bookingId: number,
  newStatus: string
): Promise<Booking | null> {
  const rows = await getConn()
    .update(bookings)
    .set({ bookingStatus: newStatus })
    .where(and(eq(bookings.id, bookingId), eq(bookings.bookingStatus, 'pending_owner_approval')))
    .returning();
  return rows[0] ?? null;
}
```

**Pattern:** The WHERE clause includes the current status check. A second tap on an already-resolved booking finds no row (returns null), treated as a safe no-op (CAS — compare-and-swap guard).

### Best-Effort Calendar Cleanup
**Source:** `src/webhooks/telegram.ts:846-856` (cascade-cancel pattern)

**Apply to:** Any booking cancellation that deletes a calendar event

```typescript
try {
  const oldBooking = await findBookingByIdUnscoped(updated.rescheduledFromBookingId);
  if (oldBooking) await deleteBookingFromCalendar(oldBooking, bookingBusiness);
} catch (err) {
  logger.error(
    { err, bookingId: updated.rescheduledFromBookingId },
    "Failed to delete superseded booking's calendar event"
  );
  // Never rethrow — calendar cleanup is best-effort (D-15)
}
```

**Key:** Catch & log, never rethrow. A failure here is retried by the calendar poller. This ensures a user notification (e.g., "reschedule approved") never fails due to a transient calendar API error.

### Capacity Release + Credit Restore on Reject
**Source:** `src/webhooks/telegram.ts:617-623` (sbk:reject branch)

**Apply to:** sbk:reject and expiry paths

```typescript
if (updated.sessionInstanceId !== null) {
  await releaseSessionCapacity(updated.sessionInstanceId);
  const membershipId = await findMembershipByBooking(updated.id);
  if (membershipId !== null) {
    await restoreCredit(membershipId, updated.id, `booking:${updated.id}:credit`);
  }
}
```

**Key:** Always release capacity first, then restore credit if a membership was found. Do NOT restore on approve (Phase 22's soft-hold pattern: capacity is incremented at insert and never decremented until reject/expiry).

---

## No Analog Found

None — all 9 files have close analogs or existing patterns to follow.

---

## Metadata

**Analog search scope:** src/database/, src/webhooks/, src/session/, src/billing/, src/conversation/, src/telegram/handlers/, src/onboarding/, src/calendar/

**Files scanned:** 40+ TypeScript files across service, handler, utility, and schema modules

**Pattern extraction date:** 2026-07-28

**Phase context:** Phase 26 reuses existing state machine and callback patterns (sbk:approve/reject, rescheduledFromBookingId cascade, confirmation dialog structure) — no novel data flows introduced. Key innovation is wiring the existing `rescheduledFromBookingId` column into the session-booking path for the first time, and adding uniform confirmation-policy dialogs across destructive actions.

# Phase 26: Confirmation & Approval Policy - Pattern Map

**Mapped:** 2026-10-01  
**Files analyzed:** 18 new/modified files  
**Analogs found:** 12/18 (6 test files have sufficient fixtures in existing tests)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/utils/greek-messages.ts` | utility, config | N/A | `src/telegram/client.ts` (sendTelegramMessage patterns) | pattern-match |
| `src/session/manager.ts` (modify `bookSessionInstance`) | service | CRUD | `src/session/manager.ts:190-313` (existing signature) | exact — add parameter |
| `src/conversation/function-executor.ts` (modify `rescheduleSessionTool`) | service | CRUD | `src/conversation/function-executor.ts:723-814` (existing tool) | exact — remove cancel/restore, pass ID |
| `src/webhooks/telegram.ts` (modify `sbk:approve` cascade) | controller/webhook | request-response | `src/webhooks/telegram.ts:587-631` (existing sbk:approve handler) + `src/webhooks/telegram.ts:840-856` (non-session cascade) | role-match — add to existing block |
| `src/onboarding/ai-owner-agent.ts` (modify 5 tools) | controller/service | request-response | `src/onboarding/ai-owner-agent.ts:578-588` (delete_service tool pattern) | exact — all 5 tools use identical pattern |
| `src/telegram/handlers/admin-menu.ts` (add CONF-01 callbacks) | controller | request-response | `src/telegram/handlers/admin-menu.ts:326-340` (showCancelClassConfirm pattern) + `src/telegram/handlers/admin-menu.ts:342-360` (handleClassCancelExecute) | role-match |
| `tests/conf-01-*.test.ts` (5 files) | test | unit/integration | `tests/ai-owner-cancel-session.test.ts` + `tests/function-executor.test.ts` | fixture-match |
| `tests/conf-02-reschedule-*.test.ts` (7 files) | test | integration | `tests/session-approval.test.ts` + `tests/expiry-poller.test.ts` | fixture-match |

---

## Pattern Assignments

### `src/utils/greek-messages.ts` (NEW FILE — utility, config)

**Analog:** `src/telegram/client.ts` structure + button text from multiple handlers

**Purpose:** Centralized constants for all Greek button labels used in CONF-01 and CONF-02 confirmations. Import into handlers and tools as needed.

**Expected structure (constants only):**
```typescript
// Example imports used by this file:
// (none — this is a pure constants file)

export const GREEK_BUTTON_LABELS = {
  // Delete-type actions (CONF-01)
  DELETE_CONFIRM: 'Διαγραφή',
  DELETE_CANCEL: 'Άκυρο',
  
  // Close/update-type actions (CONF-01)
  CLOSE_CONFIRM: 'Κλείσιμο',
  CLOSE_CANCEL: 'Άκυρο',
  
  // Approve-type actions (CONF-01 assign, CONF-02 reschedule)
  APPROVE: 'Έγκριση',
  REJECT: 'Απόρριψη',
  
  // Generic
  YES: 'Ναι',
  NO: 'Όχι',
  BACK: '« Πίσω στο Μενού',
};
```

**Reference sources for button text:**
- Delete/Cancel pair: `src/telegram/handlers/admin-menu.ts:326-340` — `showCancelClassConfirm` uses 'Ναι' / 'Όχι'
- Approve/Reject pair: `src/conversation/function-executor.ts:702-703` and `src/telegram/handlers/client-menu.ts` — session approval keyboard uses 'Έγκριση' / 'Απόρριψη'
- Back button: `src/telegram/handlers/admin-menu.ts:239`

---

### `src/session/manager.ts` — `bookSessionInstance` signature (service, CRUD)

**Analog:** `src/session/manager.ts:190-313` — existing `bookSessionInstance` function

**Current signature** (lines 190-203):
```typescript
export async function bookSessionInstance(
  businessId: number,
  sessionInstanceId: number,
  clientPhone: string,
  serviceId: number,
  idempotencyKey: string,
  activeMembership?: ActiveMembershipForDeduction | null,
  initialStatus: 'pending_owner_approval' | 'confirmed' = 'pending_owner_approval'
): Promise<BookSessionResult>
```

**Modification needed:** Add new optional parameter after `initialStatus`:
```typescript
export async function bookSessionInstance(
  businessId: number,
  sessionInstanceId: number,
  clientPhone: string,
  serviceId: number,
  idempotencyKey: string,
  activeMembership?: ActiveMembershipForDeduction | null,
  initialStatus: 'pending_owner_approval' | 'confirmed' = 'pending_owner_approval',
  rescheduledFromBookingId?: number  // NEW OPTIONAL PARAMETER
): Promise<BookSessionResult>
```

**Insert operation to modify** (lines 254-268):
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
    // ADD THIS LINE:
    rescheduledFromBookingId: rescheduledFromBookingId,
  })
  .onConflictDoNothing()
  .returning({ id: bookings.id });
```

**Note:** Schema column `rescheduledFromBookingId` already exists at `src/database/schema.ts:178` — no migration needed.

---

### `src/conversation/function-executor.ts` — `rescheduleSessionTool` (service, CRUD)

**Analog:** `src/conversation/function-executor.ts:723-814` — existing tool

**Current behavior** (lines 767-791):
- Lines 767-772: Cancels old booking immediately + restores credit
- Line 791: Passes `'confirmed'` override, auto-confirms new booking

**Modification needed:**

**Remove lines 767-772:**
```typescript
// OLD CODE TO REMOVE:
// await updateBookingStatus(original.id, 'cancelled');
// const oldMembershipId = await findMembershipByBooking(original.id);
// if (oldMembershipId !== null) {
//   await restoreCredit(oldMembershipId, original.id, 'booking:' + original.id + ':credit');
// }
```

**Replace lines 767-791 with:**
```typescript
// Fetch fresh membership for new booking deduction attempt
const activeMembership = await getActiveMembershipForDeduction(context.business.id, context.clientPhone);
const newKey = context.idempotencyKey + ':reschedule:' + parsed.new_session_instance_id;

const result = await bookSessionInstance(
  context.business.id,
  parsed.new_session_instance_id,
  context.clientPhone,
  newSession.serviceId,
  newKey,
  activeMembership,
  'pending_owner_approval',  // CHANGE: was 'confirmed', now explicit pending
  original.id  // NEW: pass old booking ID so new booking links to it via rescheduledFromBookingId
);
```

**Return value handling** (lines 794-813 unchanged):
- If booking fails, old booking is still active (not cancelled) — correct per D-03
- Return success includes `booking_id` of new booking and `cancelled_booking_id` can now be NULL initially (it will be cancelled on approval)

---

### `src/webhooks/telegram.ts` — `sbk:approve` cascade extension (controller/webhook, request-response)

**Analogs:**
- Existing `sbk:approve` handler: `src/webhooks/telegram.ts:587-604` (lines 587-605)
- Non-session reschedule cascade template: `src/webhooks/telegram.ts:840-856` (lines 840-857)
- Cascade pattern template: `src/session/manager.ts:409-466` (cascadeCancelSessionBookings)

**Current `sbk:approve` block** (lines 587-604):
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
}
```

**Modification needed:** After line 591 (`updateBookingStatusIfPending` CAS), add cascade-cancel-old-booking logic (before client/owner notifications):

```typescript
if (sbk.sbkAction === 'approve') {
  const updated = await updateBookingStatusIfPending(sbk.bookingId, 'confirmed');
  if (!updated) {
    await sendTelegramMessage(senderTelegramId, 'Η κράτηση δεν βρέθηκε ή έχει ήδη επεξεργαστεί.');
    return;
  }
  
  // NEW: D-03 cascade-cancel the old booking if this is a reschedule (CONF-02)
  if (updated.rescheduledFromBookingId) {
    // Mirroring cascadeCancelSessionBookings pattern (src/session/manager.ts:409-466)
    // and non-session reschedule cascade (lines 840-856)
    
    // 1. CAS old booking status → cancelled (idempotency guard)
    await updateBookingStatus(updated.rescheduledFromBookingId, 'cancelled');
    
    // 2. Restore old booking's credit (if it has membership)
    const oldMembershipId = await findMembershipByBooking(updated.rescheduledFromBookingId);
    if (oldMembershipId !== null) {
      await restoreCredit(
        oldMembershipId,
        updated.rescheduledFromBookingId,
        `booking:${updated.rescheduledFromBookingId}:credit`
      );
    }
    
    // 3. Release old booking's session capacity (if it's a session booking)
    // NOTE: This is a critical gap in the non-session reschedule code (lines 840-856)
    // which lacks this call. For session reschedules, it's mandatory.
    if (updated.sessionInstanceId) {
      await releaseSessionCapacity(updated.sessionInstanceId);
    }
    
    // 4. Best-effort calendar delete of old booking
    try {
      const oldBooking = await findBookingByIdUnscoped(updated.rescheduledFromBookingId);
      if (oldBooking) await deleteBookingFromCalendar(oldBooking, business);
    } catch (err) {
      logger.error(
        { err, bookingId: updated.rescheduledFromBookingId },
        'sbk:approve cascade: old booking calendar delete failed (best-effort)'
      );
    }
  }
  
  // Continue with existing client/owner notifications
  try {
    await sendTelegramMessage(
      updated.clientPhone,
      'Η κράτησή σας εγκρίθηκε από τον διαχειριστή! Θα σας δούμε σύντομα.'
    );
  } catch (err) {
    logger.error({ err, bookingId: updated.id }, 'sbk approve: client notification failed (best-effort)');
  }
  await sendTelegramMessage(senderTelegramId, 'Κράτηση εγκρίθηκε.');
}
```

**`sbk:reject` path** (lines 606-631):
- **No changes needed.** Old booking stays `confirmed` and untouched. Only new (rejected) booking's capacity and credit are released (lines 617-622 already handle this correctly).

---

### `src/onboarding/ai-owner-agent.ts` — 5 tools modified (controller/service, request-response)

**Analog:** `src/onboarding/ai-owner-agent.ts:578-588` — existing `delete_service` tool pattern (all 5 use identical structure)

**The 5 tools to modify:**

1. **`delete_service`** (line 578)
2. **`update_service_price`** (line 563)
3. **`close_day` / `update_hours`** (lines 532, 516)
4. **`cancel_session` free-chat path** (line 744)
5. **`assign_client_to_session`** (line 771)

**Current pattern** (example: `delete_service` at lines 578-588):
```typescript
case 'delete_service': {
  const { service_name } = args;
  if (!service_name) return 'Μη έγκυρο όνομα.';
  const match = svcList.find((s) => s.name.toLowerCase().includes(service_name.toLowerCase()));
  if (!match) return `Δεν βρέθηκε υπηρεσία με όνομα "${service_name}".`;
  // Direct mutation with withBusinessContext
  return withBusinessContext(business.id, async () => {
    await getConn().delete(services).where(eq(services.id, match.id));
    return `OK: υπηρεσία "${match.name}" διαγράφηκε`;
  });
}
```

**Modification needed for each tool:** Replace the direct mutation with a return of "PENDING_CONFIRMATION" sentinel instead of executing the action:

```typescript
case 'delete_service': {
  const { service_name } = args;
  if (!service_name) return 'Μη έγκυρο όνομα.';
  const match = svcList.find((s) => s.name.toLowerCase().includes(service_name.toLowerCase()));
  if (!match) return `Δεν βρέθηκε υπηρεσία με όνομα "${service_name}".`;
  
  // NEW: Return confirmation request sentinel instead of executing immediately
  // Format: PENDING_CONFIRMATION:<action>:<id>:<context>
  return `PENDING_CONFIRMATION:delete_service:${match.id}:${match.name}`;
  
  // Execution deferred to webhook callback handler (src/webhooks/telegram.ts)
  // or new handler in admin-menu.ts (depending on entry point)
}
```

**System prompt update required:**
- Location: `src/onboarding/ai-owner-agent.ts` — function `buildOwnerSystemPrompt` (line 441+)
- Add instruction: "If a tool's result starts with 'PENDING_CONFIRMATION:', stop calling tools immediately and wait for the owner to respond via button tap. Do not re-call the same tool."

**Example for all 5 tools:**
| Tool | Line | PENDING_CONFIRMATION format |
|------|------|----------------------------|
| `delete_service` | 578 | `PENDING_CONFIRMATION:delete_service:<serviceId>:<serviceName>` |
| `update_service_price` | 563 | `PENDING_CONFIRMATION:update_price:<serviceId>:<newPrice>` |
| `close_day` | 532 | `PENDING_CONFIRMATION:close_day:<date>` |
| `update_hours` | 516 | `PENDING_CONFIRMATION:update_hours:<date>` |
| `cancel_session` | 744 | `PENDING_CONFIRMATION:cancel_session:<instanceId>` |
| `assign_client_to_session` | 771 | `PENDING_CONFIRMATION:assign_client:<clientPhone>:<instanceId>` |

---

### `src/telegram/handlers/admin-menu.ts` — Add CONF-01 confirmation callbacks (controller, request-response)

**Analog:** `src/telegram/handlers/admin-menu.ts:326-360`

**Existing confirmation pattern to reuse** (lines 326-340):
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

**Existing execute pattern to reuse** (lines 342-360):
```typescript
export async function handleClassCancelExecute(
  chatId: string,
  business: Business,
  instanceId: number
): Promise<void> {
  const cancelled = await cancelSession(business.id, instanceId);
  if (cancelled) {
    const affectedCount = await cascadeCancelSessionBookings(business, instanceId);
    if (affectedCount === 0) {
      await sendTelegramMessage(chatId, 'Το μάθημα ακυρώθηκε (δεν υπήρχαν κρατήσεις).');
    } else {
      await sendTelegramMessage(chatId, `Το μάθημα ακυρώθηκε. ${affectedCount} πελάτες ειδοποιήθησαν.`);
    }
  } else {
    // handle failure
  }
}
```

**Modifications needed:**

1. **Add confirmation display functions for CONF-01 actions** (reuse `sendTelegramMessageWithKeyboard`):
   - `showDeleteServiceConfirm(chatId, serviceId, serviceName)`
   - `showUpdatePriceConfirm(chatId, serviceId, newPrice)`
   - `showCloseDayConfirm(chatId, date)`
   - `showAssignClientConfirm(chatId, clientPhone, instanceId)`

2. **Add callback handlers** in `handleCallbackQuery` equivalent:
   - Match pattern: `menu:confirm_delete_service:${serviceId}`
   - Match pattern: `menu:confirm_price_update:${serviceId}:${newPrice}`
   - etc.
   - Execute the actual mutation (delete, update, etc.) and notify owner

3. **Callback data format** (from RESEARCH.md):
   - Keep callback_data small (64-byte Telegram limit)
   - Use numeric IDs only, no Greek text: `menu:confirm_delete:123`, `menu:confirm_price:123:500000`

**Import from `greek-messages.ts`:**
```typescript
import { GREEK_BUTTON_LABELS } from '../utils/greek-messages';

// Use:
{ text: GREEK_BUTTON_LABELS.DELETE_CONFIRM, callback_data: '...' },
{ text: GREEK_BUTTON_LABELS.DELETE_CANCEL, callback_data: '...' },
```

---

## Shared Patterns

### Callback parsing

**Source:** `src/webhooks/telegram.ts:253-347` (parseCallbackData function)

**Pattern:** Add new discriminant for CONF-01 confirmations (if needed as a separate pattern):
```typescript
export type ConfirmationCallbackResult = {
  confirmAction: 'delete_service' | 'price_update' | 'close_day' | 'assign_client';
  id: number;
  optionalValue?: number | string;  // for price updates
};

// Add to parseCallbackData:
const confirmMatch = data?.match(/^menu:confirm_([\w]+):(\d+)(?::(\d+))?$/);
if (confirmMatch) {
  return {
    confirmAction: confirmMatch[1],
    id: Number(confirmMatch[2]),
    optionalValue: confirmMatch[3] ? Number(confirmMatch[3]) : undefined,
  };
}
```

**Alternative:** Keep action parsing in each file (simpler, avoids coupling per D-07):
```typescript
// In admin-menu.ts callback routing:
if (parsed.menuAction === 'confirm_delete_service') { ... }
if (parsed.menuAction === 'confirm_price_update') { ... }
```

### CAS idempotency pattern

**Source:** `src/webhooks/telegram.ts:587-591` (updateBookingStatusIfPending CAS)

**Pattern:** All confirmation callbacks use the same check-then-update idiom:
```typescript
const updated = await updateBookingStatusIfPending(bookingId, newStatus);
if (!updated) {
  // Already processed or not found — safe no-op
  await sendTelegramMessage(chatId, 'Δεν βρέθηκε ή επεξεργάστηκε ήδη.');
  return;
}
```

**Applied to CONF-02 reschedule approval:** Cascade-cancel uses plain `updateBookingStatus` (idempotent on same status).

### Best-effort patterns

**Source:** `src/session/manager.ts:448-461` (cascadeCancelSessionBookings)

**Pattern for all cascades:**
1. Calendar delete wrapped in try/catch (line 449)
2. Client notification wrapped in try/catch (line 454)
3. Errors logged but never rethrown (lines 450, 460)

Apply same pattern in CONF-02 cascade-cancel logic in `sbk:approve` block.

### Session capacity release

**Source:** `src/webhooks/telegram.ts:618` and `src/session/manager.ts:446`

**Pattern:** Always call `releaseSessionCapacity(sessionInstanceId)` immediately after CAS status change to 'cancelled' or 'rejected':
```typescript
await releaseSessionCapacity(updated.sessionInstanceId);
```

**Critical:** The non-session reschedule code (telegram.ts:840-856) is **missing this call** for old bookings — flag for planner to fix separately.

---

## No Analog Found

Files with no close match (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/utils/greek-messages.ts` | utility | N/A | New constants file — no direct analog, but follows import/export pattern from existing utilities |

---

## Test File Analogs

### Test fixtures to reuse

**Source:** `tests/fixtures.test.ts` + existing session/booking test setup

**Key fixtures already in codebase:**
- `MOCK_BUSINESS` (ai-owner-cancel-session.test.ts:87-100)
- `ToolContext` with business/client/keys (function-executor.test.ts:76-77)
- Session booking mocks: `bookSessionInstance` mock setup (ai-owner-cancel-session.test.ts:61-68)
- `withBusinessContext` mock (function-executor.test.ts:32-34)

**New fixtures needed for Phase 26 tests:**
- `insertPendingRescheduleBooking()` — creates a pending reschedule scenario with old + new bookings
- `mockGeminiToolCall()` — simulates Gemini returning PENDING_CONFIRMATION result
- Telegram callback setup: approval/rejection messages with callback_data

### Test framework

**Jest + ts-jest** (existing setup in jest.config.js, codebase uses:)
- Mock import hoisting: `jest.mock()` before imports
- Async test patterns: `async test('...', async () => {...})`
- Mock assertions: `.mockResolvedValue()`, `.toHaveBeenCalledWith()`

### Test structure patterns

**From `ai-owner-cancel-session.test.ts` (lines 1-100+):**
```typescript
// 1. Module mocks (hoisted)
jest.mock('@google/genai', () => ({ ... }));
jest.mock('../src/config', () => ({ ... }));
jest.mock('../src/database/queries', () => ({ ... }));
// etc.

// 2. Imports after mocks
import { aiOwnerAgent } from '../src/onboarding/ai-owner-agent';
import * as sessionManager from '../src/session/manager';

// 3. Mock accessors
const mockCreate = (require('@google/genai') as any)._mockCreate as jest.Mock;

// 4. Test fixtures (MOCK_BUSINESS, etc.)

// 5. Test cases
describe('cancel_session tool', () => {
  test('cancels session and cascades booking cancellations', async () => {
    mockCancelSession.mockResolvedValue(true);
    mockCascadeCancel.mockResolvedValue(2);
    
    const result = await aiOwnerAgent(...);
    
    expect(mockCascadeCancel).toHaveBeenCalledWith(MOCK_BUSINESS, 1);
  });
});
```

---

## CONF-01 & CONF-02 Integration Points

### Gemini system prompt update

**Location:** `src/onboarding/ai-owner-agent.ts` near `buildOwnerSystemPrompt`

**Current pattern:** System prompt instructs Gemini on tool availability and expected response formats.

**Add instruction:**
```
If any tool result starts with the string "PENDING_CONFIRMATION:", stop calling tools immediately.
The user must tap a confirmation button before this action is completed.
Do not re-call the same tool. Wait for the confirmation response.
```

### Webhook callback routing

**Location:** `src/webhooks/telegram.ts::handleCallbackQuery`

**Pattern:** Add discriminant check for new CONF-01 confirmation callbacks after existing pattern checks:
```typescript
if (parsed.menuAction?.startsWith('confirm_')) {
  // Route to CONF-01 confirmation handlers
  await handleConfirmationCallback(parsed, senderTelegramId, ...);
  return;
}
```

---

## Metadata

**Analog search scope:** 
- `src/session/manager.ts` — session booking, cascade patterns
- `src/webhooks/telegram.ts` — callback parsing, existing cascades, sbk handlers
- `src/onboarding/ai-owner-agent.ts` — AI tool patterns
- `src/telegram/handlers/admin-menu.ts` — confirmation UI patterns
- `src/conversation/function-executor.ts` — tool execution, approval keyboards
- `tests/` — Jest setup, mock patterns, fixtures

**Files scanned:** 45+ source/test files

**Pattern extraction date:** 2026-10-01

**Confidence Breakdown:**
- **Session cascade patterns (CONF-02):** HIGH — cascadeCancelSessionBookings and existing sbk:approve handlers read in full
- **CONF-01 tool patterns:** HIGH — all 5 tools located and current implementation verified
- **Confirmation keyboard pattern:** HIGH — showCancelClassConfirm example available and reusable
- **Test fixtures:** MEDIUM — existing fixtures sufficient, new reschedule-specific fixtures needed but follow established patterns
- **Gemini system prompt integration:** MEDIUM — requires coordination with AI agent implementation, pattern identified but not code-complete

---

*Phase: 26-confirmation-approval-policy*
*Patterns extracted: 2026-10-01*
*Confidence: HIGH*

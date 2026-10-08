# Phase 26: Confirmation & Approval Policy - Research

**Researched:** 2026-10-01  
**Domain:** Telegram bot appointment booking confirmation workflows and approval policies  
**Confidence:** HIGH

## Summary

Phase 26 implements a unified confirmation and approval framework for two distinct user flows: (1) **CONF-01**, a uniform destructive-action confirmation policy applied consistently across 5 owner actions triggered from either the admin menu or free-chat AI agent; and (2) **CONF-02**, reversing Phase 22's auto-confirm behavior for client-initiated session reschedules to require owner approval, with careful handling of the old booking's credit and capacity state during a 2-hour pending window.

The research identifies exact code patterns to reuse (existing `sbk:approve`/`sbk:reject` cascade at `src/webhooks/telegram.ts:587–631`, confirmation template from `showCancelClassConfirm`), the schema column already available (`rescheduledFromBookingId` at `src/database/schema.ts:178`), and the critical changes needed to `bookSessionInstance` (add optional `rescheduledFromBookingId` parameter) and `rescheduleSessionTool` (remove immediate cancel/restore and pass the old booking ID to the new booking's insert).

**Primary recommendation:** Implement CONF-01 first (confirmation keyboard standardization) as a foundation, then build CONF-02 (reschedule approval) reusing the proven Phase 22 patterns without adding a new state machine.

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Research Correction – No State-Machine Reuse for Session Reschedules**  
The research synthesis in `.planning/research/ARCHITECTURE.md` claimed reschedule approval could reuse the `rescheduledFromBookingId` cascade at `src/webhooks/telegram.ts:840–856` "with zero new state machine." This is **WRONG for session-class reschedules**. That cascade lives in the older `approve_<id>`/`reject_<id>` callback block (non-session reschedules only). The session-class reschedule path (`rescheduleSessionTool` and `sbk:approve`/`sbk:reject`) is completely separate with **zero awareness of `rescheduledFromBookingId` today**. The new logic is needed in the `sbk:approve` branch at `src/webhooks/telegram.ts:587–631`.

**D-02: Current Reschedule Behavior (Problem Statement)**  
`rescheduleSessionTool` (line 768) cancels the OLD booking unconditionally and immediately, then restores its credit (line 771), **before** the new booking is attempted (line 778–791). If a naive fix simply drops the `'confirmed'` override without handling the old booking, the client has **zero active bookings** during the pending window and stays at zero if rejected — a correctness bug.

**D-03: Approved Approach – Hold Old Booking Until Approval**  
- `rescheduleSessionTool` does NOT cancel/restore the old booking upfront. It creates the new booking via `bookSessionInstance(..., rescheduledFromBookingId: original.id)` with default `pending_owner_approval` status (no `'confirmed'` override).
- `bookSessionInstance` signature gains optional `rescheduledFromBookingId` parameter and persists it on insert.
- `sbk:approve` branch (line 587) checks `updated.rescheduledFromBookingId` and if set, cascade-cancels the old booking (mirroring the pattern at lines 840–856) without restoring credit (old booking's credit was never touched).
- `sbk:reject` branch (line 606) needs NO new logic — old booking stays confirmed/untouched; only the rejected new booking's capacity and credit are released.
- **Trade-off accepted:** During pending window, both old and new session instance `bookedCount` are incremented (soft-hold pattern from Phase 22, OWNR-06). This is an existing pattern, not new.

**D-04: CONF-01 Scope (5 Destructive Actions)**  
Exactly: `delete_service` (tool in `ai-owner-agent.ts:578`), `update_service_price` (line 563), `close_day` / `update_hours` (line 532 and 516), `cancel_session` free-chat path (line 744; admin-menu path already confirms via `showCancelClassConfirm` at `admin-menu.ts:326`), `assign_client_to_session` (line 771). No other actions found during audit; scope locked.

**D-05: Contextual Button Labels (Not Generic Ναι/Όχι)**  
- Delete-type actions ("Delete service", "Close day"): pair with action-labeled buttons — e.g. "Διαγραφή" (Delete) / "Άκυρο" (Cancel). Anti-pattern: bare "Ναι/Όχι" causes misclicks per UX research (FEATURES.md).
- Approve-type actions ("Assign client"): reuse existing "Έγκριση/Απόρριψη" pair already in Phase 22's `sbk:approve`/`sbk:reject` keyboard.
- Existing constant strings in codebase: "Ναι", "Όχι" (generic yes/no from `showCancelClassConfirm`), "Έγκριση", "Απόρριψη" (session approve/reject from `function-executor.ts:702–703`), "« Πίσω στο Μενού" (back button from `admin-menu.ts:239`).

**D-06: No Consequence Preview in Confirmation Prompts**  
Confirmation text restates action + context (date/service/client name) — **no** impact summary (e.g. "loses 1 credit" or "affected clients"). Keeping scope mechanical and uniform across all 5 actions. Consequence preview is deferred to UX-02 (Phase 29).

**D-07: Greek Messages as Constants in `src/utils/greek-messages.ts`**  
Centralized constants file (button labels only), not a global confirmation-keyboard helper. Each file imports constants and keeps callback-naming conventions independent: `menu:<action>` (admin-menu), `cmenu:<action>` (client-menu), `sbk:approve/reject:<id>` (session webhooks), legacy `approve_<id>`/`reject_<id>`.

### Claude's Discretion

- Exact constant names and shape in `greek-messages.ts` beyond button-label strings.
- Whether `assign_client_to_session` confirmation uses delete-type or approve-type button labels (planner's call).
- Test coverage shape for `rescheduledFromBookingId` wiring and `sbk:approve` cascade extension.

### Deferred Ideas

None — discussion stayed within phase scope. Consequence-preview feature (D-06) explicitly considered and deferred as out-of-scope.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **CONF-01** | Destructive owner actions (delete service, update price, close day, cancel class, assign client) have uniform Ναι/Όχι confirmation across admin menu AND free-chat tool paths — no action mutates immediately without confirmation. | Exact implementations identified for all 5 actions in `ai-owner-agent.ts` and `admin-menu.ts`; contextual button-label guidance per D-05; reusable template pattern from `showCancelClassConfirm`. |
| **CONF-02** | Client-initiated reschedules require owner approval before confirming, reusing the same approve/reject capacity-hold cascade from Phase 22; client's original booking is not lost if rejected. | Existing `sbk:approve`/`sbk:reject` handlers identified (lines 587–631); cascade pattern from non-session reschedules (lines 840–856) documented; credit/capacity semantics for all approval paths verified. |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Owner confirmation dialogs (CONF-01) | Frontend Server (Telegram webhook handler) | Backend API (Gemini function result handling) | Telegram inline keyboards render UI; tool handlers process actions. Decision point is both: tool result tells Gemini "confirmation requested" (no mutation), then callback routes the yes/no tap. |
| Session reschedule approval (CONF-02) | Frontend Server (Telegram callback) | Backend API (Session manager) | Callback handler receives approve/reject, updates booking status atomically, cascades cancel to old booking. Session manager handles capacity release. Dual responsibility but callback owns the orchestration. |
| Credit/membership ledger consistency (CONF-02 detail) | Backend API (Billing queries) | Database (transaction isolation) | `restoreCredit` and `deductSession` are atomic; old booking's credit stays untouched during pending window (no double-restore on approve). |
| Capacity hold during pending window (CONF-02 detail) | Database (schema + transaction) | Backend API (Session manager) | Both old and new session instance `bookedCount` incremented (soft-hold). Release on reject/expiry via `releaseSessionCapacity` CAS. No new mechanism needed. |

---

## Standard Stack

### Core Messaging & Confirmation

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **Telegraf** | 4.15+ | Telegram bot framework, callback_query routing | Already in use; handles inline keyboard taps and callback_data parsing. |
| **Telegram InlineKeyboard** | (native API) | Render Ναι/Όχι, Έγκριση/Απόρριψη buttons | Native Telegram feature; no library needed, direct callback_data routing. |

### Supporting (Existing)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **drizzle-orm** | 0.30+ | ORM + atomic transactions via `withBusinessContext` | All DB mutations wrapped atomically; idempotency via CAS on booking status. |
| **PostgreSQL SERIALIZABLE** | (transaction isolation) | Prevent races on concurrent confirmations | Not new; already used by existing transaction pattern. |
| **@google/genai** | 2.10.0+ | Gemini function-calling for AI owner tools | Tool results return "confirmation requested" string; Gemini sees this and does NOT re-call the tool. |

### Installation

No new dependencies. Reusing existing stack + adding constants file.

---

## CONF-02 Technical Deep Dive: Session Reschedule Approval

### Current State (v1.6)

`rescheduleSessionTool` (src/conversation/function-executor.ts:723–814):
- **Line 768:** `updateBookingStatus(original.id, 'cancelled')` ← immediate cancel
- **Line 771:** `restoreCredit(oldMembershipId, original.id, ...)` ← immediate restore
- **Line 791:** `bookSessionInstance(..., 'confirmed')` ← explicit override, skips approval queue

### Required Changes

#### 1. `bookSessionInstance` Signature (src/session/manager.ts:190–203)

```typescript
// BEFORE
export async function bookSessionInstance(
  businessId: number,
  sessionInstanceId: number,
  clientPhone: string,
  serviceId: number,
  idempotencyKey: string,
  activeMembership?: ActiveMembershipForDeduction | null,
  initialStatus: 'pending_owner_approval' | 'confirmed' = 'pending_owner_approval'
): Promise<BookSessionResult>

// AFTER — ADD THIS PARAMETER
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

Inside the insert (line 254–268):
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
    rescheduledFromBookingId: rescheduledFromBookingId,  // NEW LINE
    expiresAt: initialStatus === 'pending_owner_approval' ? new Date(Date.now() + 2 * 3600 * 1000) : null,
  })
  .onConflictDoNothing()
  .returning({ id: bookings.id });
```

#### 2. `rescheduleSessionTool` Changes (src/conversation/function-executor.ts:723–814)

```typescript
// REMOVE LINES 767–772 (immediate cancel + restore)
// OLD CODE:
// await updateBookingStatus(original.id, 'cancelled');
// const oldMembershipId = await findMembershipByBooking(original.id);
// if (oldMembershipId !== null) {
//   await restoreCredit(oldMembershipId, original.id, 'booking:' + original.id + ':credit');
// }

// REMOVE LINE 791 ('confirmed' override)
// OLD CODE:
// const result = await bookSessionInstance(
//   ...
//   'confirmed'  // ← REMOVE THIS LINE
// );

// NEW CODE (lines 767–791):
const activeMembership = await getActiveMembershipForDeduction(context.business.id, context.clientPhone);
const newKey = context.idempotencyKey + ':reschedule:' + parsed.new_session_instance_id;

const result = await bookSessionInstance(
  context.business.id,
  parsed.new_session_instance_id,
  context.clientPhone,
  newSession.serviceId,
  newKey,
  activeMembership,
  'pending_owner_approval',  // CHANGE: explicit, was implicit before
  original.id  // NEW: pass old booking ID so new booking links to it
);
```

#### 3. `sbk:approve` Cascade Extension (src/webhooks/telegram.ts:587–604)

After line 591 (`updateBookingStatusIfPending` CAS), add:

```typescript
if (sbk.sbkAction === 'approve') {
  const updated = await updateBookingStatusIfPending(sbk.bookingId, 'confirmed');
  if (!updated) {
    await sendTelegramMessage(senderTelegramId, 'Η κράτηση δεν βρέθηκε ή έχει ήδη επεξεργαστεί.');
    return;
  }
  
  // NEW: D-03 cascade-cancel the old booking if this is a reschedule
  if (updated.rescheduledFromBookingId) {
    // Mirroring the pattern from lines 840–856 (non-session reschedule flow)
    await updateBookingStatus(updated.rescheduledFromBookingId, 'cancelled');
    try {
      const oldBooking = await findBookingByIdUnscoped(updated.rescheduledFromBookingId);
      if (oldBooking) await deleteBookingFromCalendar(oldBooking, business);  // best-effort
    } catch (err) {
      logger.error(
        { err, bookingId: updated.rescheduledFromBookingId },
        'Failed to delete superseded booking calendar event'
      );
    }
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

#### 4. `sbk:reject` Path (src/webhooks/telegram.ts:606–631)

**No changes needed.** The old booking is already `confirmed` and untouched. Only the rejected new booking's capacity and credit are released (lines 617–622 already handle this correctly).

### Credit & Enforcement Semantics

**Key Insight:** The old booking's credit is **never touched** during the reschedule pending window or on approval/rejection.

| Event | Old Booking Credit | New Booking Credit | Net Change |
|-------|-------------------|-------------------|------------|
| Client reschedules (pending created) | Intact, confirmed | Deducted (if membership has sessions) | -1 net (client uses 1 to hold 2 slots) |
| Owner approves reschedule | Intact, confirmed | Stays deducted, status→confirmed | 0 (net -1 stays) |
| Owner rejects reschedule | Intact, confirmed | Restored (via line 621) | +1 (returns to -0, client keeps old slot) |
| 2-hour pending expires (auto-reject) | Intact, confirmed | Restored (via expiry-poller) | +1 (client keeps old slot) |
| Client later cancels old booking | Restored (via cancel handler) | N/A if approved; restored if pending | Varies |

**Enforcement Policy Impact:** With `enforcement_policy='block'` and exactly 1 session left:
1. Client reschedules: new booking created (if capacity available) with deduction attempt
2. New booking's deduction succeeds (1 session remains)
3. On approval: old booking cancelled (not re-requested for credit)
4. On rejection: new booking's credit restored; client still has 1 session + original slot

**Conclusion (ORIGINAL — SUPERSEDED, see CORRECTION below):** ~~The "hold old, deduct new" pattern gives net-zero credit change... No refund-on-approve needed.~~

> ### ⚠ CORRECTION (orchestrator-verified against code, 2026-10-01) — planner MUST follow this, not the table above
> The table/conclusion above is **wrong**. Verified in `src/conversation/function-executor.ts:767-791` and `src/session/manager.ts:395-446`:
> - Today: old booking cancelled + `restoreCredit` runs BEFORE new `bookSessionInstance` deducts → net credit change 0.
> - Under D-03 (old held, new created pending, new deducts on insert): during the pending window the client holds **2 credits**. On **approve**, if the old booking is cancelled WITHOUT `restoreCredit`, net = **−1 credit (client double-charged)**. D-03's phrase "not restoring credit again since the old booking's credit was never touched" is therefore incorrect/misleading: the old credit was deducted and must be restored when the old booking is cascade-cancelled on approve.
> - **Required approve-cascade (per old booking, after CAS on the NEW booking succeeds):** CAS old booking `confirmed→cancelled` (zero rows ⇒ skip all side effects, idempotent) → `findMembershipByBooking(old.id)` + `restoreCredit(membershipId, old.id, 'booking:'+old.id+':credit')` (same idempotency key shape as the existing reschedule/cancel paths) → `releaseSessionCapacity(old.sessionInstanceId)` (old instance bookedCount must be decremented — the non-session cascade at telegram.ts:840-856 does NOT do this) → best-effort `deleteBookingFromCalendar` → notify. `cascadeCancelSessionBookings` (manager.ts:395) is the in-repo template for this CAS→restore→release→calendar sequence.
> - **Enforcement gap:** with `enforcement_policy='block'` and exactly 1 session left, the new booking's deduction would be refused (old credit still held) → every last-credit reschedule would wrongly fail. Planner must resolve explicitly (candidate: for reschedule bookings pass a bypass like `activeMembership=null`/skip deduction AND have approve-cascade NOT restore, with the new booking inheriting the old ledger entry; OR keep deduct-new and pass a credit-aware check that counts the old booking's credit as available). Whichever is chosen must give net-zero credit on approve, +0 on reject/expiry, and correct restore if the (confirmed) new booking is later cancelled by the client (`findMembershipByBooking(new.id)` must resolve). Add tests for: last-credit reschedule under `block`, approve net-zero, reject/expiry net-zero, later cancel of new booking restores exactly once.
> - Table row "Owner approves → net −1 stays" above is the double-charge bug, not acceptable behavior.

### Capacity Management

#### Old Session Instance

When reschedule is **pending:**
- Old session instance's `bookedCount` remains unchanged (client is still "holding" the slot)
- `unique_active_slot_per_business` index on (businessId, calendarDate, calendarTime) with `WHERE booking_status IN ('pending_owner_approval', 'confirmed')` prevents double-booking

When reschedule is **approved:**
- `sbk:approve` cascade-cancels old booking (line 845 equivalent)
- Old booking status → 'cancelled'
- Old session instance's `bookedCount` is decremented via `releaseSessionCapacity` (must be called in cascade)

**CURRENT GAP:** The `sbk:approve` cascade at lines 840–856 does NOT call `releaseSessionCapacity`. **This is a bug for non-session reschedules too.** Session reschedules must add the call.

When reschedule is **rejected:**
- `sbk:reject` branch already calls `releaseSessionCapacity(updated.sessionInstanceId)` at line 618 (NEW session instance)
- Old session instance unchanged (old booking still 'confirmed')

When reschedule **expires** (2-hour cutoff):
- Expiry poller (`src/conversation/expiry-poller.ts` — check this) must NOT cancel old booking
- Only the new (rejected) booking's capacity/credit are released
- Old booking stays 'confirmed'

#### Idempotency & Races

| Race Scenario | Guard | Behavior |
|---------------|-------|----------|
| Double-tap `sbk:approve` | `updateBookingStatusIfPending` CAS (line 591) finds no pending row on 2nd tap → returns null → "already processed" message | Safe no-op |
| Approve races with client cancelling old booking | RLS + transaction isolation | Client cancels old booking inside pending window; old booking status→'cancelled'. Then approve cascade tries to `updateBookingStatus(oldId, 'cancelled')` again. Same-status update is idempotent. | Safe, no-op |
| Client reschedules again while one is pending | Two pending bookings exist, both reference the same original.id as `rescheduledFromBookingId`. On approve, first pending's cascade cancels original. Second pending's cascade tries to cancel already-cancelled old booking. CAS ensures idempotency. | Safe but confusing (second pending will never be app-able if first is approved because old booking is gone). Recommend UI/AI guard preventing second reschedule while one is pending (not in this phase). |
| Approve arrives after owner deletes/cancels the class (Phase 23 cascade) | `releaseSessionCapacity` checks if NEW session instance still exists; old booking's cascade also checks old session instance. Both safe if instance is already gone. | Safe, cascades are best-effort on calendar delete. |

### Messaging (Client & Owner)

#### Owner Approval Prompt (NEW)

When new booking created with `pending_owner_approval`, send Telegram message to owner:

```
Example current format (lines 708–709):
"Νέα κράτηση αναμονής 2026-10-15 18:00 — πελάτης: +306912345678"

For reschedule (NEW):
"Μετακίνηση κράτησης: Pilates, 2026-10-10 17:00 → 2026-10-15 18:00 — πελάτης: +306912345678"
```

Must include:
- Old date/time (shows what's being moved from)
- New date/time (shows what's being moved to)
- Service name (if available)
- Client phone/name

Keyboard: "Έγκριση" (approve) / "Απόρριψη" (reject) with `sbk:approve:<id>` / `sbk:reject:<id>` callbacks

#### Client Rejection Message (NEW)

When owner taps "Απόρριψη", send message to client:

```
Greek message (matches existing reject-message style from line 626):
"Η αίτησή σας για μετακίνηση της κράτησης δεν εγκρίθηκε. Η αρχική κράτησή σας μένει ενεργή."
Translation: "Your reschedule request was not approved. Your original booking remains active."
```

This explicitly tells client they are NOT losing the original slot.

### In-Flight Data (SC4 / Pitfall #2)

Reschedules confirmed under v1.6's auto-confirm behavior have `NULL rescheduledFromBookingId` and the old booking is already 'cancelled'. No migration or backfill needed because:

1. **Pending reschedule lists** (owner's approve/reject queue) filter to `bookingStatus = 'pending_owner_approval'`. Old auto-confirmed reschedules won't appear.
2. **Expired booking poller** (`expiry-poller.ts`) checks `WHERE bookingStatus = 'pending_owner_approval' AND expiresAt < now()`. Old reschedules are already 'confirmed', won't be expired.
3. **Owner agenda** shows confirmed bookings; old reschedules' old bookings are already 'cancelled', won't show.
4. **Client "my bookings"** shows active bookings. Old reschedules' new bookings are 'confirmed', old bookings are 'cancelled' — client sees new booking only (correct).
5. **Google Calendar sync** only syncs 'confirmed' bookings. Old reschedules' new bookings are synced (correct). Old cancelled bookings don't sync (correct).
6. **Reminders** only run on 'confirmed' bookings. Old reschedules' new bookings get reminders (correct).

**Conclusion:** No query breaks for old-style reschedules; no backfill needed.

---

## CONF-01 Technical Deep Dive: Destructive Action Confirmations

### The 5 Actions & Current Behavior

| Action | Tool Name | Tool File | Current Entry Point | Confirmation Today |
|--------|-----------|-----------|-------------------|-------------------|
| 1. Delete service | `delete_service` | `ai-owner-agent.ts:578` | Free-chat (Gemini tool call) | None — direct mutation |
| 2. Update service price | `update_service_price` | `ai-owner-agent.ts:563` | Free-chat (Gemini tool call) | None — direct mutation |
| 3. Close day / Update hours | `close_day`, `update_hours` | `ai-owner-agent.ts:532, 516` | Free-chat or potentially admin-menu | None for close_day free-chat; none for update_hours either |
| 4. Cancel session (free-chat path) | `cancel_session` | `ai-owner-agent.ts:744` | Free-chat (Gemini tool call) | None — direct mutation |
| 4b. Cancel session (admin-menu path) | N/A (direct handler) | `admin-menu.ts:342` | Admin menu callback | `showCancelClassConfirm` already confirms (line 326) via Ναι/Όχι |
| 5. Assign client to session | `assign_client_to_session` | `ai-owner-agent.ts:771` | Free-chat (Gemini tool call) | None — direct mutation |

### Key Pattern: Two Entry Points

**Admin-menu path:**
- Handler function triggered via Telegram callback_data (e.g., `menu:classes:cancel_yes`)
- `showCancelClassConfirm` already shows confirmation keyboard inline
- Callback routes to `handleClassCancelExecute` for execution

**Free-chat path:**
- Gemini tool-calling on AI owner agent
- Tool handler in `executeOwnerTool` directly mutates DB
- No confirmation step; Gemini sees "OK: ..." response and reports success to owner

### Confirmation Pattern to Reuse

`showCancelClassConfirm` (admin-menu.ts:326–340) is the template:

```typescript
export async function showCancelClassConfirm(chatId: string, instanceId: number): void {
  const cancelConfirmData = `menu:classes:cancel_yes:${instanceId}`;
  const cancelAbortData = `menu:classes:cancel_no:${instanceId}`;
  assertCallbackDataSize(cancelConfirmData);
  assertCallbackDataSize(cancelAbortData);

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Να ακυρωθεί το μάθημα #${instanceId};`,  // ← context text
    [[
      { text: 'Ναι', callback_data: cancelConfirmData },
      { text: 'Όχι', callback_data: cancelAbortData },
    ]]
  );
}
```

Elements to reuse:
- `sendTelegramMessageWithKeyboard` (existing Telegram helper)
- Inline keyboard with two buttons
- `assertCallbackDataSize` guard (64-byte Telegram limit)
- callback_data encoding: `<namespace>:<action>:<id>` pattern

### Free-Chat Challenge: How to Return "Confirmation Requested" to Gemini

Gemini function-calling loop expects tool results as strings. Current pattern (lines 499–502):
- Tool returns Greek string: "OK: ..." → Gemini sees success
- Empty string → Gemini breaks immediately (used by create_package, record_payment)
- Error strings "Δεν βρέθηκε ..." → Gemini sees failure and can retry or report to owner

**For confirmations:** Tool must return a special result that Gemini recognizes as "awaiting approval, don't re-call this tool, tell the owner."

```typescript
// Pattern for destructive tools needing confirmation:
case 'delete_service': {
  const { service_name } = args;
  if (!service_name) return 'Μη έγκυρο όνομα.';
  const match = svcList.find(s => s.name.toLowerCase().includes(service_name.toLowerCase()));
  if (!match) return `Δεν βρέθηκε υπηρεσία με όνομα "${service_name}".`;

  // ← NEW: Return "confirmation requested" instead of mutating
  return `PENDING_CONFIRMATION: delete_service:${match.id}:${match.name}`;
  
  // The await withBusinessContext(...) and delete are deferred to the callback
}
```

Gemini's system prompt (buildOwnerSystemPrompt, line 441+) must be updated to say:
> "If a tool returns a string starting with 'PENDING_CONFIRMATION:', stop calling tools. Wait for the owner's confirmation tap."

Then in webhook callback handlers, parse `PENDING_CONFIRMATION:action:id:context` and execute.

### Confirmation Routing via Callback_data

Need new callback pattern for CONF-01 confirmations. Options:

**Option A: Reuse menu:<action> pattern**
- `menu:confirm:delete_service:12` (action + serviceId)
- `menu:confirm:update_price:12:2500` (action + serviceId + newPrice)
- Pro: consistent with existing menu callbacks
- Con: callback_data length grows with each field (64-byte limit tight)

**Option B: Separate confirmation:<id> pattern**
- Store confirmation request in temp table (request_id → action + params)
- Callback just references request_id: `confirmation:12345`
- Pro: callback_data small
- Con: adds temp table + cleanup logic (complexity)

**Recommendation:** Option A for now (simpler), watch 64-byte limit. Example: `menu:confirm_delete:12`, `menu:confirm_price:12:2500`.

### Handler Flow (Admin-Menu Template)

```typescript
// In admin-menu.ts callback routing (handleCallbackQuery equivalent)
if (parsed.menuAction === 'confirm_delete_service') {
  const serviceId = parsed.id;
  const service = await findServiceById(business.id, serviceId);
  if (!service) {
    await sendTelegramMessage(chatId, 'Υπηρεσία δεν βρέθηκε.');
    return;
  }
  
  // Execute the mutation
  await withBusinessContext(business.id, async () => {
    await getConn().delete(services).where(eq(services.id, serviceId));
  });
  
  await sendTelegramMessage(chatId, `OK: υπηρεσία "${service.name}" διαγράφηκε`);
  await showAdminRootMenu(chatId, business);
}
```

### Telegram 64-Byte Callback_data Limit

Each callback_data string must fit in 64 bytes (UTF-8). Examples:

```
menu:confirm_delete_service:123            → 34 bytes ✓
menu:confirm_price_update:123:500000       → 40 bytes ✓
cmenu:confirm_assign:123:20261001:1800    → 41 bytes ✓
```

Greek text in callback_data eats bytes quickly; keep data minimal (IDs only, no names).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|------------|-------------|-----|
| Duplicate callback_data parsing for each confirmation action | Custom switch cases per action | Reuse existing `parseCallbackData` pattern + add discriminant field (`confirmAction`) | Consolidates routing logic; avoids callback-naming inconsistency bugs. |
| Building a global confirmation modal component | Custom `confirmationKeyboard(text, yesData, noData)` helper | Per-file button constants + callback patterns (per D-07) | Different files (admin-menu, client-menu, telegram.ts) have incompatible callback conventions; coupling them creates brittleness. Constants-only approach is lighter. |
| Persisting temporary confirmation state in DB | Custom temp_confirmations table + TTL cleanup | Encode state in callback_data (IDs/action only) with RLS guards | Callback_data is already Telegram-signed; no extra state needed. For complex params (see Option B above), a temp table becomes necessary — but start simple. |
| Checking "is this action destructive?" repeatedly | Custom `isDestructiveAction()` function in Gemini system prompt | Hardcode the 5 actions in both Gemini system prompt AND in webhook callback handlers | Small fixed set (5 actions). Duplication is acceptable for clarity; a shared function adds abstraction without real benefit for 5 items. |

---

## Common Pitfalls

### Pitfall 1: Gemini Tool-Call Loop on Confirmation

**What goes wrong:**  
Tool returns "PENDING_CONFIRMATION" string. Gemini's default loop treats non-error strings as success and re-calls the same tool with identical args, creating an infinite loop.

**Why it happens:**  
Gemini doesn't parse "PENDING_CONFIRMATION" as a sentinel; the system prompt must explicitly tell it to stop on that string.

**How to avoid:**  
Update `buildOwnerSystemPrompt` (line 441+) to explicitly say:
> "If a tool's result starts with 'PENDING_CONFIRMATION:', stop calling tools immediately and wait for the owner to respond with a button tap."

**Warning signs:**  
- Owner reports tool called twice with same args
- Telegram shows duplicate confirmation messages
- Logs show tool execution repeated N times

### Pitfall 2: Double-Tap on Confirmation Buttons

**What goes wrong:**  
Owner taps "Έγκριση" twice in quick succession. Both callbacks execute mutations independently, leading to:
- Double-cancellation of a session (second attempt fails silently due to idempotent WHERE clause)
- Double-charge if the action involves billing

**Why it happens:**  
Callbacks don't include a CAS (compare-and-swap) or idempotency check unique to THIS confirmation event.

**How to avoid:**  
- Use `updateBookingStatusIfPending` pattern (SELECT FOR UPDATE + CAS) for idempotency — already proven in Phase 22.
- For non-booking mutations (delete_service, close_day), add an idempotency key to the action (e.g., session cancellation already uses `instanceId`; deleting a service should check service.id exists before deleting).
- Telegram framework can disable buttons after first tap (edit message to remove keyboard), but this adds latency.

**Warning signs:**  
- Logs show "already processed" messages on double-tap
- Webhook processes same callback twice in a row
- Capacity counts go negative or misaligned

### Pitfall 3: Cascading Cancellation Missing Old Session's Capacity Release

**What goes wrong:**  
`sbk:approve` cascade cancels old booking but forgets to call `releaseSessionCapacity(oldSessionId)`. Old session's `bookedCount` stays high, blocking future bookings for that slot.

**Why it happens:**  
The non-session reschedule code (lines 840–856) doesn't handle sessions at all; copying the pattern without adapting for sessions misses the release call.

**How to avoid:**  
In the cascade-cancel block (after `updateBookingStatus(oldId, 'cancelled')`), check if old booking is a session booking (old booking has `sessionInstanceId`), and if so, call `releaseSessionCapacity`.

```typescript
if (updated.rescheduledFromBookingId) {
  await updateBookingStatus(updated.rescheduledFromBookingId, 'cancelled');
  
  // NEW: release old session's capacity
  const oldBooking = await findBookingByIdUnscoped(updated.rescheduledFromBookingId);
  if (oldBooking?.sessionInstanceId) {
    await releaseSessionCapacity(oldBooking.sessionInstanceId);
  }
  
  // Calendar cleanup (best-effort)
  try { ... }
}
```

**Warning signs:**  
- Session slots show 100% booked even after old bookings are cancelled
- Clients can't re-book a slot after reschedule is approved
- `bookedCount` increases but never decreases after reschedules

### Pitfall 4: Failing to Restate Action in Confirmation Prompt

**What goes wrong:**  
Confirmation prompt says "Are you sure? (Ναι/Όχι)" with no context about WHAT action. Owner misclicks because they don't remember what they started.

**Why it happens:**  
Minimal implementation copies the confirmation keyboard but forgets the context message (which tool was called, which object is being modified).

**How to avoid:**  
Every confirmation must restate the action:
- "Delete service: Pilates? (Διαγραφή/Άκυρο)"
- "Close day: Δευτέρα? (Κλείσιμο/Άκυρο)"
- "Reschedule: Pilates, Oct 10 17:00 → Oct 15 18:00? (Έγκριση/Απόρριψη)"

**Warning signs:**  
- UX research shows high misclick rate on confirmation dialogs
- Owner reports "I didn't mean to delete that"
- Support tickets: "The bot deleted X by mistake"

---

## Code Examples

### Example 1: Reusable Confirmation Message & Keyboard

**Source:** Adapted from `showCancelClassConfirm` (admin-menu.ts:326–340)

```typescript
// In src/telegram/handlers/admin-menu.ts
export async function showConfirmationPrompt(
  chatId: string,
  confirmationText: string,
  yesCallback: string,
  noCallback: string,
  yesLabel: string = 'Ναι',
  noLabel: string = 'Όχι'
): Promise<void> {
  assertCallbackDataSize(yesCallback);
  assertCallbackDataSize(noCallback);

  await sendTelegramMessageWithKeyboard(
    chatId,
    confirmationText,
    [[
      { text: yesLabel, callback_data: yesCallback },
      { text: noLabel, callback_data: noCallback },
    ]]
  );
}

// Usage:
await showConfirmationPrompt(
  ownerChatId,
  'Να διαγραφεί η υπηρεσία "Pilates"; (Διαγραφή/Άκυρο)',
  `menu:confirm_delete:${serviceId}`,
  `menu:root`,
  'Διαγραφή',
  'Άκυρο'
);
```

### Example 2: Reschedule Approval Prompt with Old→New Context

**Source:** Adapted from existing session-booking owner alert (function-executor.ts:706–710)

```typescript
// In src/conversation/function-executor.ts::bookSessionInstance callback
// After successful insert with pending_owner_approval + rescheduledFromBookingId

if (initialStatus === 'pending_owner_approval' && rescheduledFromBookingId) {
  // Fetch old booking for context
  const oldBooking = await findBookingById(businessId, rescheduledFromBookingId);
  
  const prompt = `Μετακίνηση κράτησης: ${service.name}
Από: ${oldBooking.calendarDate} ${oldBooking.calendarTime}
Σε: ${instance.sessionDate} ${instance.sessionTime}
Πελάτης: ${clientPhone}`;

  const approveData = `sbk:approve:${result.bookingId}`;
  const rejectData = `sbk:reject:${result.bookingId}`;
  assertCallbackDataSize(approveData);
  assertCallbackDataSize(rejectData);

  const keyboard: InlineKeyboard = [
    [
      { text: 'Έγκριση', callback_data: approveData },
      { text: 'Απόρριψη', callback_data: rejectData },
    ],
  ];

  await sendTelegramMessageWithKeyboard(
    context.business.ownerTelegramId,
    prompt,
    keyboard
  );
}
```

### Example 3: Gemini Tool Returns "Confirmation Requested"

**Source:** Adapted from existing tool pattern (ai-owner-agent.ts:503–588)

```typescript
// In src/onboarding/ai-owner-agent.ts::executeOwnerTool

case 'delete_service': {
  const { service_name } = args;
  if (!service_name) return 'Μη έγκυρο όνομα.';
  
  const match = svcList.find(s => 
    s.name.toLowerCase().includes(service_name.toLowerCase())
  );
  if (!match) return `Δεν βρέθηκε υπηρεσία "${service_name}".`;

  // NEW: Return confirmation request instead of executing immediately
  return `PENDING_CONFIRMATION:delete_service:${match.id}:${match.name}`;
  
  // Execution deferred to webhook callback handler
}
```

### Example 4: Webhook Callback Handles Confirmation

**Source:** New pattern for CONF-01

```typescript
// In src/webhooks/telegram.ts::handleCallbackQuery

if (parsed.action === 'confirm_delete_service') {
  const serviceId = parsed.id;  // from callback_data
  const business = await findBusinessByOwnerTelegramId(senderTelegramId);
  if (!business) {
    await sendTelegramMessage(senderTelegramId, 'Επιχείρηση δεν βρέθηκε.');
    return;
  }

  const service = await findServiceById(business.id, serviceId);
  if (!service) {
    await sendTelegramMessage(senderTelegramId, 'Υπηρεσία δεν βρέθηκε.');
    return;
  }

  // Execute the deletion atomically
  await withBusinessContext(business.id, async () => {
    await getConn().delete(services).where(eq(services.id, serviceId));
  });

  await sendTelegramMessage(
    senderTelegramId, 
    `OK: υπηρεσία "${service.name}" διαγράφηκε`
  );
  
  // Return to menu
  await showAdminRootMenu(senderTelegramId, business);
}
```

---

## Validation Architecture

**Framework:** Jest + ts-jest with local Postgres test DB

**Test Config:**
```bash
# File: jest.config.js
preset: 'ts-jest'
testEnvironment: 'node'
setupFiles: ['<rootDir>/tests/jest.setup.ts']

# Run quick suite:
npm test -- --testNamePattern='session|reschedule' --maxWorkers=1

# Run full suite:
npm test
```

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Command | Status |
|--------|----------|-----------|---------|--------|
| **CONF-01** | Delete service requires confirmation before mutation | Integration | `npm test -- --testNamePattern='delete_service_confirmation'` | ❌ Wave 0 |
| **CONF-01** | Update price requires confirmation before mutation | Integration | `npm test -- --testNamePattern='update_price_confirmation'` | ❌ Wave 0 |
| **CONF-01** | Close day requires confirmation before mutation | Integration | `npm test -- --testNamePattern='close_day_confirmation'` | ❌ Wave 0 |
| **CONF-01** | Cancel session (free-chat) requires confirmation | Integration | `npm test -- --testNamePattern='cancel_session_free_chat_confirmation'` | ❌ Wave 0 |
| **CONF-01** | Assign client requires confirmation before mutation | Integration | `npm test -- --testNamePattern='assign_client_confirmation'` | ❌ Wave 0 |
| **CONF-02** | Reschedule creates pending booking, not confirmed | Integration | `npm test -- --testNamePattern='reschedule_pending'` | ❌ Wave 0 |
| **CONF-02** | Owner approves reschedule → old booking cancelled, new confirmed | Integration | `npm test -- --testNamePattern='reschedule_approve'` | ❌ Wave 0 |
| **CONF-02** | Owner rejects reschedule → old intact, new rejected + credit restored | Integration | `npm test -- --testNamePattern='reschedule_reject'` | ❌ Wave 0 |
| **CONF-02** | 2-hour reschedule pending expires → old intact, new rejected | Integration | `npm test -- --testNamePattern='reschedule_expiry'` | ❌ Wave 0 |
| **CONF-02** | Credit unchanged: old untouched, new deducted (net -1 per reschedule) | Integration | `npm test -- --testNamePattern='reschedule_credit_semantics'` | ❌ Wave 0 |
| **CONF-02** | Capacity: old + new bookedCount incremented during pending | Unit | `npm test -- --testNamePattern='reschedule_capacity_hold'` | ❌ Wave 0 |
| **CONF-02** | Idempotency: double-tap approve is safe no-op | Integration | `npm test -- --testNamePattern='reschedule_double_tap'` | ❌ Wave 0 |

### Wave 0 Gaps

- [ ] `tests/conf-01-delete-service-confirmation.test.ts` — Covers CONF-01 delete_service: Gemini tool returns PENDING_CONFIRMATION, webhook callback executes. Verify service is deleted atomically and DB state is clean.
- [ ] `tests/conf-01-update-price-confirmation.test.ts` — Covers CONF-01 update_service_price: confirmation flow + price update.
- [ ] `tests/conf-01-close-day-confirmation.test.ts` — Covers CONF-01 close_day: confirmation flow + isClosed flag set.
- [ ] `tests/conf-01-cancel-session-free-chat.test.ts` — Covers CONF-01 cancel_session free-chat path: Gemini tool → confirmation → callback → session cancellation. Verify affected clients notified.
- [ ] `tests/conf-01-assign-client-confirmation.test.ts` — Covers CONF-01 assign_client_to_session: confirmation → booking created + client notified.
- [ ] `tests/conf-02-reschedule-pending.test.ts` — Covers CONF-02: reschedule creates pending booking with rescheduledFromBookingId, old booking untouched, old + new bookedCount both incremented.
- [ ] `tests/conf-02-reschedule-approve.test.ts` — Covers CONF-02 approve flow: sbk:approve callback → old booking cascade-cancelled + capacity released, new booking confirmed, client notified.
- [ ] `tests/conf-02-reschedule-reject.test.ts` — Covers CONF-02 reject flow: sbk:reject callback → new booking rejected + capacity released + credit restored, old booking untouched, client notified.
- [ ] `tests/conf-02-reschedule-expiry.test.ts` — Covers CONF-02 expiry: pending-booking poller finds reschedules at 2-hour cutoff, expires new booking (credit restored), leaves old booking intact.
- [ ] `tests/conf-02-reschedule-credit-semantics.test.ts` — Covers CONF-02 credit flows: reschedule with finite membership deducts 1 for new booking only, on approve/reject/expiry credit is managed correctly, net effect -1 per approved reschedule.
- [ ] `tests/conf-02-reschedule-capacity.test.ts` — Covers CONF-02 capacity: both session instances' bookedCount incremented on reschedule pending, decremented on approve (old) and reject (new), via `releaseSessionCapacity`.
- [ ] `tests/conf-02-reschedule-double-tap.test.ts` — Covers CONF-02 idempotency: second tap on sbk:approve CAS returns null → "already processed" message, no double-cancellation.
- [ ] Fixture helpers: `insertPendingRescheduleBooking()` to set up a reschedule scenario quickly; `mockGeminiToolCall()` to simulate PENDING_CONFIRMATION result.
- [ ] Framework install: `npm install` (existing jest/ts-jest setup, no new framework needed).

---

## Security Domain (ASVS L1)

### Applicable ASVS Categories

| Category | Applies | Standard Control | Implementation |
|----------|---------|-----------------|-----------------|
| **V2 Authentication** | No | (out of scope for this phase) | Owner/client identity already established upstream (Telegram auth). |
| **V3 Session Management** | No | (out of scope for this phase) | Telegram session token is Telegram's responsibility. |
| **V4 Access Control** | Yes | Owner-only on destructive actions; client can only reschedule their own booking. | `findBusinessByOwnerTelegramId` derives businessId from Telegram ID (anti-spoofing). Callback_data IDs are validated against business context (RLS guard). Client ownership checked in `rescheduleSessionTool` (line 733: `original.clientPhone !== context.clientPhone`). |
| **V5 Input Validation** | Yes | Reject invalid service names, dates, times. | Service names matched case-insensitively; dates validated as YYYY-MM-DD; times as HH:MM. Zod schemas on all Gemini tool args. |
| **V6 Cryptography** | N/A | (not applicable to this phase) | Telegram handles callback_data signing (Telegram BotAPI contract). |

### Known Threat Patterns for Telegram Bot Architecture

| Pattern | STRIDE | Standard Mitigation | Status |
|---------|--------|---------------------|--------|
| **Callback_data tampering** | Tampering | Telegram BotAPI signs callbacks; treat as untrusted input until re-derived from DB. Never trust IDs from callback_data for cross-tenant access. | `findBusinessByOwnerTelegramId` re-derives businessId from authenticated senderTelegramId before every mutation. ✓ Implemented |
| **Owner-only actions triggered by forged callback_data** | Authorization | Verify senderTelegramId is the owner before executing destructive callbacks. | Every callback handler checks `findBusinessByOwnerTelegramId(senderTelegramId)` before executing. ✓ Implemented |
| **Cross-tenant booking confusion** | Information Disclosure | RLS + WHERE clause guard prevent accessing other businesses' bookings. Reschedule's `original.id` lookup is RLS-enforced. | `findBookingById` inside `withBusinessContext` is RLS-scoped. ✓ Implemented |
| **Replay of old confirmation taps** | Spoofing | Confirmation callbacks must be idempotent; double-tap is safe no-op. | `updateBookingStatusIfPending` CAS ensures second tap on a resolved booking returns null → safe "already processed". ✓ Implemented |
| **Approval bypass (tool returns "OK" without confirmation)** | Authorization | Gemini tools for destructive actions must return "PENDING_CONFIRMATION", not "OK", until user confirms via button. | D-07 change to Gemini system prompt enforces this; Gemini loop halts on PENDING_CONFIRMATION. ⚠️ Depends on system prompt accuracy |
| **Capacity race on concurrent reschedules** | Tampering, Availability | `SELECT FOR UPDATE` in `bookSessionInstance` serializes concurrent bookings. | Session instance locked during booking insert (line 230: `.for('update')`). ✓ Implemented |

### Callback_data Tampering Guard

Callback_data format: `menu:confirm_delete:123` (example). Telegram signs this string; if tampered, signature fails and callback is rejected by Telegram before reaching our webhook.

However, the **ID inside** (123) must be re-derived and validated:
```typescript
// GOOD: re-fetch from DB
const service = await findServiceById(business.id, parseInt(parsed.id));
if (!service) { /* reject */ }

// BAD: trust parsed.id directly
const service = await findServiceById(business.id, parseInt(parsed.id));  // what if parsed.id is from another business?
```

**Rule:** Every callback_data ID (serviceId, sessionInstanceId, bookingId) must be re-looked-up in DB and cross-checked against `businessId` before mutation.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `rescheduledFromBookingId` column exists on bookings table (schema.ts:178) and is unused in session-booking context. | CONF-02 Technical Deep Dive | If column doesn't exist, migration needed. Low risk (schema is source-of-truth). |
| A2 | `updateBookingStatusIfPending` CAS pattern (line 591) is race-safe for double-tap; returns null on 2nd tap. | CONF-02 Idempotency | If CAS is not atomic or missing, double-tap could cause double-mutation. Medium risk; should be verified in code review. |
| A3 | `releaseSessionCapacity` exists and is the single source of truth for capacity release (session/manager.ts). | CONF-02 Capacity Management | If multiple conflicting capacity-release functions exist, one might be missed. Low risk (code review should catch). |
| A4 | `findBookingByIdUnscoped` exists to fetch old booking without RLS restriction (for cascade-cancel). | CONF-02 Cascade Pattern | If only RLS-scoped `findBookingById` exists, cascade to old booking may fail. Low risk (existing non-session reschedule code uses this). |
| A5 | Expiry poller (expiry-poller.ts) doesn't wrongly expire session reschedules' old bookings. | CONF-02 In-Flight Data | If poller lacks `rescheduledFromBookingId` awareness, old confirmed bookings might expire. Medium risk; code review needed. |
| A6 | `sendTelegramMessage` handles Greek characters correctly (UTF-8 encoding). | CONF-01/02 Messaging | If encoding is broken, Greek text garbles. Low risk (existing system uses Greek everywhere). |
| A7 | 64-byte callback_data limit is enforced; `assertCallbackDataSize` is called on all new callbacks. | CONF-01 Routing | If limit exceeded, Telegram silently rejects button, breaking user flow. Medium risk; code review + testing. |
| A8 | Gemini's system prompt can be updated to recognize "PENDING_CONFIRMATION" sentinel and halt tool loop. | CONF-01 Free-Chat Challenge | If system prompt update is missed or ignored by Gemini, tool loop continues infinitely. Medium risk; critical for safety. |

---

## Open Questions

1. **Assign-client confirmation button labels**  
   - What we know: D-05 says "contextual labels"; `assign_client_to_session` is an "assign" action (more like approval than deletion).
   - What's unclear: Should it use "Έγκριση/Απόρριψη" (approve style) or "Ναι/Όχι" (generic)? Or create a new pair like "Ανάθεση/Άκυρο" (assign/cancel)?
   - Recommendation: Treat as approval-type, use "Έγκριση/Απόρριψη" (align with existing session-approval UX).

2. **Expiry-poller behavior for reschedule pending bookings**  
   - What we know: Expiry poller marks `pending_owner_approval` bookings as `expired` at 2-hour cutoff.
   - What's unclear: Does it handle session-class reschedules' `rescheduledFromBookingId` field correctly? Or might it leave orphaned state?
   - Recommendation: Code review of expiry-poller.ts must verify: (a) old booking is never expired if a pending reschedule exists, (b) new booking's cascade-release on expiry doesn't touch old booking.

3. **Multi-reschedule race (client reschedules twice while first is pending)**  
   - What we know: Two pending bookings exist, both reference the same original.id as `rescheduledFromBookingId`. On approve of the first, original is cancelled. On approve of the second, cascade tries to cancel already-cancelled original.
   - What's unclear: Is `updateBookingStatus(cancelledId, 'cancelled')` idempotent (safe on replay), or will it error?
   - Recommendation: `updateBookingStatus` is a plain UPDATE; if row is already 'cancelled', UPDATE rows=0 is safe no-op. Verify in code review. Consider UI guard: "You already have a pending reschedule" message before allowing a second one (not in this phase, but flag for planner).

---

## Environment Availability

No external dependencies beyond existing stack (PostgreSQL, Telegram BotAPI, Gemini API). All changes are internal code + schema (no new services).

---

## Metadata

**Confidence Breakdown:**
- **Standard Stack**: HIGH — Reusing existing Telegram, Gemini, Drizzle patterns proven in Phase 22.
- **Session Reschedule Flow**: HIGH — Exact code paths read and analyzed; cascade pattern exists in codebase (lines 840–856); schema column exists.
- **CONF-01 Actions**: HIGH — All 5 tools located in `ai-owner-agent.ts` and `admin-menu.ts`; current behavior verified.
- **Pitfalls**: HIGH — Based on existing code patterns and Phase 22 / earlier lessons (Pitfalls 1–2 directly apply).
- **Testing Gaps**: MEDIUM — Jest setup exists; test framework identified; Wave 0 list is best-effort estimate. Planner may discover additional fixtures needed.

**Research Validity:**  
- **Valid until:** 2026-11-01 (30 days, stable domain — Telegram/Gemini APIs unlikely to change; codebase patterns are mature from Phase 22+).
- **Rechecked:** 2026-10-01 against working codebase and locked CONTEXT.md decisions.

---

*Phase: 26-confirmation-approval-policy*  
*Researched: 2026-10-01*  
*Confidence: HIGH*

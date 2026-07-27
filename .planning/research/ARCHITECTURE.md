# Architecture Integration Analysis: v1.7 UX & Trust Polish (v1.6→v1.7 Integration)

**Project:** RandevuClaw  
**Analyzed:** 2026-07-28  
**Scope:** Integration architecture for 15 UX/trust fixes  
**Supersedes:** Previous v1.2 billing architecture doc  

## Executive Summary

The v1.7 roadmap fixes 15 UX/compliance items across 4 thematic areas. Most are **localized surface-layer changes** (Telegram handlers, menu buttons, session filters); three require careful **state-machine or schema consideration** (reschedule approval reuse, consent registration flag, compliance gap).

**Key finding:** Item 9's **confirmation-policy standardization must precede** items 3–7; reschedule (item 10) fully reuses Phase 22's existing sbk:approve/reject cascade with **zero new state machine**; consent gap (item 11) moves one call 50 lines earlier in telegram.ts with **no schema changes**.

---

## Answers to Four Specific Questions

### (a) Reschedule Approval: Can It Fully Reuse Phase 22's sbk: Cascade?

**YES — without new state machine.** The "what happens to old booking" question is already solved atomically in telegram.ts lines 839–856:

```typescript
if (updated.rescheduledFromBookingId) {
  // When owner approves NEW booking, OLD is auto-cancelled
  await updateBookingStatus(updated.rescheduledFromBookingId, 'cancelled');
  // Calendar event delete (best-effort)
  try { if (oldBooking) await deleteBookingFromCalendar(...); }
  catch (err) { logger.error(...); }  // never rethrows
}
```

**Single change for item 10:** In `src/conversation/function-executor.ts::rescheduleSessionTool` (line ~199), remove the explicit `'confirmed'` parameter:
- **Before:** `bookSessionInstance(..., 'confirmed')`
- **After:** `bookSessionInstance(...)` — defaults to `'pending_owner_approval'`

Owner sees Έγκριση/Απόρριψη buttons (sbk: pattern); on approve, cascade fires. On reject, capacity is released and credit restored (identical to Phase 22 new-booking rejects). **No schema changes, no new callbacks.**

**State machine implication:** The existing `rescheduledFromBookingId` audit trail already handles "wait for approval then cascade" — Postgres defers the cancellation-on-approve logic, not your state machine. Phase 22 proved this pattern works.

---

### (b) Registration Flag: Minimal Schema Change

**Recommendation: Repurpose existing `consentGiven` column.** Change default from `true` → `false` in schema.ts line 106. Migrate all existing rows to `true` (they had implied consent). New rows start at `false`, requiring explicit opt-in.

```typescript
// In src/database/schema.ts::clientBusinessRelationships
consentGiven: boolean('consent_given').notNull().default(false),  // changed from true
```

**RLS impact: ZERO.** The column is not sensitive/privileged. Existing FK to `businesses.id` + `withBusinessContext` already guard access. No new policies needed.

**Alternative (if semantic separation desired):** Add `regOptedIn: boolean('reg_opted_in').notNull().default(false)` column. Same RLS outcome, one extra column.

**Backward compatibility:** Backfill migration sets existing rows to `true` so they're not re-prompted. New users start at `false` and opt-in via Ναι tap on the GDPR notice.

---

### (c) Consent Gap Fix: Move Check Earlier, Behavior Impact

**YES, move `getOrCreateClientRelationship()` into `handleFoundBusiness` BEFORE `/start` pre-emption (line 135).** This fixes the gap where `/start`-first clients bypass consent, but **changes behavior ONLY for them** — they now see GDPR notice **before** the menu, not silently.

**Current broken behavior:**
- **Free-chat:** Consent check runs inside `routeConversationMessage`. ✓ Works.
- **/start:** Bypasses consent check entirely; unconditional upsert on line 1093 creates entry without prompt. ✗ Broken.

**Fix (in handleFoundBusiness, after line 80):**
```typescript
// Apply consent check to BOTH /start and free-chat clients
if (business.ownerTelegramId !== senderTelegramId) {  // sender is client, not owner
  const { isFirstContact, consentGiven } = await getOrCreateClientRelationship(
    business.id, senderTelegramId
  );
  
  if (isFirstContact && !consentGiven) {
    await showConsentPrompt(senderTelegramId, business);  // GDPR notice + Ναι/Όχι
    await withBusinessContext(business.id, () => markTelegramUpdateProcessed(updateId, business.id));
    return;  // Stop; wait for user response
  }
}
// THEN proceed with normal routing...
```

**New webhook route needed:** Add `consent:(yes|no)` pattern to `parseCallbackData`; handle in `handleCallbackQuery` with a consent-approval branch that updates `consentGiven=true` then shows `showClientRootMenu`.

**Behavioral impact:**
- **/start-first client:** Now sees GDPR notice first. ✓ **Fixes the gap.**
- **Free-chat-first client:** Unchanged. Consent still runs inside `routeConversationMessage`, later in turn.
- **Owners:** Unaffected. The client-only guard (`ownerTelegramId !== senderTelegramId`) prevents this from applying.

---

### (d) Shared Confirmation Keyboard Helper: Per-File Patterns, No Global Helper

**Verdict: Do NOT extract a global helper.** Items 3–9 use different callback naming and button semantics across files. **Instead: create lightweight i18n constant, standardize patterns per file.**

**Why no global helper:** A `confirmationKeyboard(text, yesCallback, noCallback)` would create coupling — changes to callback naming (e.g., `approve_<id>` → `sbk:approve:<id>`) affect all call sites.

**Recommended approach:**
1. Create `src/utils/greek-messages.ts` with constants:
   ```typescript
   export const GREEK_CONFIRMATIONS = {
     YES: 'Ναι',
     NO: 'Όχι',
     APPROVE: 'Έγκριση',
     REJECT: 'Απόρριψη',
     BACK_TO_MENU: '« Πίσω στο Μενού',
   };
   ```

2. Each file imports and uses constants (not a helper, just strings):
   - `admin-menu.ts`: `GREEK_CONFIRMATIONS.BACK_TO_MENU`
   - `client-menu.ts`: `GREEK_CONFIRMATIONS.YES` / `NO`
   - `function-executor.ts`: `GREEK_CONFIRMATIONS.APPROVE` / `REJECT`

3. **Callback patterns remain independent per file:**
   - `admin-menu.ts`: `menu:<action>[:<id>]`
   - `client-menu.ts`: `cmenu:<action>[:<id>]`
   - `telegram.ts` (session bookings): `sbk:approve:<id>` / `sbk:reject:<id>`
   - Legacy (older bookings): `approve_<id>` / `reject_<id>`

**Per-item implementation:**
| Item | Change | Callback | Button Text |
|------|--------|----------|------------|
| 3 | Prepend date/service to prompt | Keep existing | YES/NO from constant |
| 4 | Delete "Νέο μάθημα" button row | N/A (deletion) | N/A |
| 5 | Add default case in handlers | menu:root | BACK_TO_MENU constant |
| 6 | Add payment button to admin root | menu:payment | BACK_TO_MENU constant |
| 7 | Add setup buttons in settings | menu:settings:xxx | Inline text only |
| 9 | Use constants across app | (no pattern change) | All from GREEK_CONFIRMATIONS |

---

## Integration Points: 15 Items → 6 Commits

### Commit 1: Foundation (Item 9)
- Create `src/utils/greek-messages.ts` with constants (~10 lines).

### Commit 2: Localized Fixes (Items 1, 2, 4, 5, 13–15)
| Item | File | Change |
|------|------|--------|
| 1 | telegram.ts | Clarify/defer escl:reply handler (lines 501–510) |
| 2 | session/manager.ts | listSessions: exclude past-time slots on same date |
| 4 | admin-menu.ts | Delete "Νέο μάθημα (chat)" button row (line 294) |
| 5 | handlers | Add default cases: send back-to-menu button on unknown callback |
| 13 | ai-onboarding-agent.ts | Add retry loop to `setChatMenuButton` in finish_onboarding tool |
| 14 | client-menu.ts | Join to fetch service names in book/cancel lists |
| 15 | client-menu.ts | Guard: hide book button for open_slots businesses |

### Commit 3: Menu Standardization (Items 3, 6, 7, 9 refactor)
- Import `GREEK_CONFIRMATIONS` in admin-menu.ts + client-menu.ts.
- Replace all hardcoded Ναι/Όχι strings with constants.
- Item 6: Add "Πληρωμή" button to `showAdminRootMenu`, callback `menu:payment` → `handlePaymentFlowStart()` → existing `showClientSelection()`.
- Item 7: Add "Ρυθμίσεις Μαθημάτων" button to settings, shows inline text "γράψε μου 'μαθήματα' στο chat" + back button.
- Item 3: Prepend date/service to `showCancelConfirm()` prompt text.

### Commit 4: Schema & Consent Prep (Item 12)
- Modify schema.ts: `consentGiven` default `false`.
- Create migration: backfill existing to `true`, alter default.

### Commit 5: Consent Gate Flow (Item 11)
- Add `getOrCreateClientRelationship()` call in `handleFoundBusiness` early (before /start pre-emption).
- Add `consent:(yes|no)` pattern to `parseCallbackData`.
- Add consent branch in `handleCallbackQuery`: on yes, update flag + show menu; on no, show "cannot proceed" message.
- Create `showConsentPrompt()` with Ναι/Όχι buttons and GDPR text.

### Commit 6: Reschedule & Fuzzy (Items 10, 8)
- Item 10: Remove explicit `'confirmed'` param in `rescheduleSessionTool`.
- Item 8: Add partial name matching to `view_client_membership`, `assign_client_to_session`, `send_renewal_reminder` in ai-owner-agent.ts (use indexOf or simple fuzzy; pattern already exists for service_name matching).

---

## Data Flow: Before → After

```
=== v1.6 (Broken) ===
/start (new client)
  ↓
showClientRootMenu immediately (NO consent notice)
  ↓
Free-chat path alone triggers consent check
  ↓
Consent notice shown AFTER user types first message

=== v1.7 (Fixed) ===
/start (new client)
  ↓
getOrCreateClientRelationship() [NEW, called early]
  ↓
If isFirstContact && !consentGiven:
  Show GDPR notice + Ναι/Όχι buttons
  ↓
On Ναι → updateRelationship(consentGiven=true) → showClientRootMenu
On Όχι → Show "cannot proceed" (owner can re-invite later)
  ↓
Free-chat path (unchanged):
  User types message
  ↓
getOrCreateClientRelationship() already has the row + consentGiven=true
  ↓
Proceed to routeConversationMessage
```

---

## Schema & RLS

### Changes Required
| Item | Table | Columns | Migration |
|------|-------|---------|-----------|
| 12 | clientBusinessRelationships | Repurpose `consentGiven: default true → false` | Backfill existing to true; alter default |
| Others | (none) | No schema changes | N/A |

### RLS Impact
- **Zero new policies needed.** All affected tables already have `business_id` FKs and are guarded by `withBusinessContext`.
- New columns on existing RLS-guarded tables don't require policy changes — the FK/business_id context propagates automatically.

---

## Files Modified

| File | Items Affected | Magnitude |
|------|----------------|-----------|
| src/webhooks/telegram.ts | 1, 5, 11 | +30 lines (consent check early + callback route) |
| src/telegram/handlers/admin-menu.ts | 3, 4, 6, 7, 9 | +40 lines (new buttons + text with constants) |
| src/telegram/handlers/client-menu.ts | 3, 5, 9, 14, 15 | +25 lines (context in prompts, guard, constants) |
| src/session/manager.ts | 2 | -2 lines (date filter tighten) |
| src/conversation/function-executor.ts | 10 | -1 line (remove 'confirmed' param) |
| src/onboarding/ai-owner-agent.ts | 8 | +15 lines (fuzzy name matching) |
| src/consent/checker.ts | 11–12 | +5 lines (semantic comment, no code) |
| src/utils/greek-messages.ts | 9 | +10 lines (NEW file, constants) |
| src/database/schema.ts | 12 | -0 lines (default value change only) |
| database/migrations/ | 12 | +5 lines (backfill + alter default) |

**No new database tables. No new RLS policies.**

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Item 10 (reschedule) doubly-cancels old booking | LOW | Phase 22 cascade already tested; reschedule just changes default status. Include in test suite. |
| Item 11/12 (consent) confuses existing users | MEDIUM | Backfill migration + clear notes. Repurposing existing column is safer than new column. |
| Item 9 (constants) breaks build | LOW | Simple strings. Verify compile + menu visual consistency. |
| Item 6 (payment) routing broken | LOW | Reuses existing showClientSelection. Existing tests cover routing. |
| Item 5 (default callback handler) causes loop | LOW | Default case returns early with back button; no infinite loop. |

---

## Build Dependencies

```
Item 9 (constants) — foundational, no deps
  ↓
Items 3, 6, 7 (menu changes) — depend on Item 9
Items 1, 2, 4, 5, 13–15 — independent, no deps

Item 12 (schema) — independent
  ↓
Item 11 (consent gate) — depends on Item 12

Item 10 (reschedule) — independent, no deps
Item 8 (fuzzy) — independent, no deps
```

---

## Testing Checklist

- [ ] Item 1: Escalation reply tap shows prompt
- [ ] Item 2: listSessions excludes past-time slots on same date
- [ ] Item 3: Cancel prompt shows date/service, not raw ID
- [ ] Item 4: Admin classes menu has only 2 buttons
- [ ] Item 5: Unknown callback_data shows back button (not silent)
- [ ] Item 6: Admin menu payment button → client selection
- [ ] Item 7: Settings shows "Ρυθμίσεις Μαθημάτων" → inline instructions
- [ ] Item 8: Admin types partial name (e.g., "Άννα") → tool resolves
- [ ] Item 9: All Ναι/Όχι text identical across app (from constant)
- [ ] Item 10: Reschedule booking shows pending approval; on owner approve, old auto-cancels
- [ ] Item 11: `/start` new client → GDPR notice before menu
- [ ] Item 12: New relationship starts with consentGiven=false
- [ ] Item 13: Menu button set on onboarding finish (or retry 3x on failure)
- [ ] Item 14: Book/cancel lists show service names
- [ ] Item 15: open_slots business hides book button (or shows "message in chat")

---

## Confidence Levels

| Area | Level | Notes |
|------|-------|-------|
| Items 1–9, 13–15 (UI fixes) | HIGH | Isolated, no schema, patterns exist |
| Item 10 (reschedule approval) | HIGH | Reuses Phase 22 sbk: cascade; one param change |
| Items 11–12 (consent/schema) | MEDIUM | Touches core booking path; schema backfill straightforward |
| Item 8 (fuzzy matching) | MEDIUM | String matching logic; must test false-positive cases |

---

*Architecture integration research completed 2026-07-28 for v1.7 UX & Trust Polish milestone.*

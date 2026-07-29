---
phase: 30-client-identification-menu-reliability
reviewed: 2026-07-29T00:58:18Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/onboarding/ai-owner-agent.ts
  - src/onboarding/ai-onboarding-agent.ts
  - src/telegram/handlers/admin-menu.ts
  - tests/ai-owner-name-matching.test.ts
  - tests/ai-owner-confirmation-policy.test.ts
  - tests/onboarding/ai-onboarding-agent.test.ts
  - tests/admin-menu.test.ts
findings:
  critical: 0
  warning: 3
  info: 1
  total: 4
status: issues_found
---

# Phase 30: Code Review Report

**Reviewed:** 2026-07-29T00:58:18Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed both plans of Phase 30: the UX-03 name-based client resolution added to `src/onboarding/ai-owner-agent.ts` (4 converted owner tools + `resolveClientByName`/`formatClientDisambiguation`), and the ADMIN-05 menu-button reliability hedges in `src/onboarding/ai-onboarding-agent.ts` (retry+backoff) and `src/telegram/handlers/admin-menu.ts` (fire-and-forget re-assertion).

**Verified sound (no defect found), specifically checked per the review brief:**

- **T-30-01 cross-business isolation is genuinely enforced, not just nominally scoped.** `resolveClientByName` calls `getAllClientsForBusiness(businessId)` inside `withBusinessContext(businessId, ...)`, and `getAllClientsForBusiness` itself has an explicit `WHERE clientBusinessRelationships.businessId = businessId` clause (`src/billing/queries.ts:283-297`) — two independent layers (RLS + explicit WHERE), matching the class of bug flagged in Phase 28/29 reviews but not reproduced here. The cross-business isolation test (`ai-owner-name-matching.test.ts:279-304`) actually mocks `getAllClientsForBusiness` to branch on the `businessId` argument and proves a same-named client under a different business never resolves — this is a real behavioral proof, not just an assertion on a stub that always returns the same fixture.
- **D-05 disambiguation text never leaks `senderPhone`.** `formatClientDisambiguation` (`ai-owner-agent.ts:153-156`) is built strictly from `matches.map(m => m.clientName ...)`; confirmed by direct code read and by the test's explicit `not.toContain('111111111')`/`not.toContain('222222222')` assertions (`ai-owner-name-matching.test.ts:254-256`).
- **`finish_onboarding`'s exhausted retry still falls through to `activateBusiness`/`onboardingCompleted`.** The `for` loop (`ai-onboarding-agent.ts:611-635`) only `break`s on success; on exhaustion it logs and lets the loop end naturally — no `return`/`throw` — so `activateBusiness` (line 637) and the `onboardingCompleted` write (line 641-643) always run regardless of outcome. Confirmed by the new "exhausts all retry attempts... still lets activateBusiness run" test and by re-running the full suite (all 86 tests across the 4 files pass).
- **`reassertMenuButtonAndCommands` truly never blocks or fails the caller.** It's invoked without `await` and `.catch()`-guarded (`admin-menu.ts:116-123`); `showAdminRootMenu` itself resolves as soon as `sendTelegramMessageWithKeyboard` resolves. Confirmed by the never-resolving-promise test and the reject-without-throw test in `admin-menu.test.ts:148-167`, both passing.
- **No other caller was broken by dropping `client_phone`** from the 4 tools' schemas/`ToolArgs`. `ToolArgs` and `OnboardingToolArgs` are both file-private (never exported/imported elsewhere); a repo-wide grep for `client_phone` turns up only schema column names, an unrelated test, and code comments — no other call site ever passed `client_phone` into these 4 tools.
- `npx tsc --noEmit` reports no errors; the full set of touched test files (86 tests across 4 files) passes.

No BLOCKER-level defect was found. The findings below are quality/robustness gaps worth fixing, not correctness or security failures.

## Warnings

### WR-01: Identical-name collision is a permanent disambiguation dead end with no escape hatch

**File:** `src/onboarding/ai-owner-agent.ts:130-156` (`resolveClientByName`, `formatClientDisambiguation`)
**Issue:** `clientName` is populated from Telegram's `from.first_name` (per 30-CONTEXT.md D-05), which has no uniqueness constraint — two distinct clients with the literal same displayed name is explicitly called out in context as expected, not rare. When 2+ matches share a byte-identical `clientName`, `formatClientDisambiguation` renders the *same string twice* (e.g. "Πολλοί πελάτες ταιριάζουν: Γιώργος, Γιώργος. Δώστε ένα πιο συγκεκριμένο όνομα."), and Gemini's re-ask loop asks the owner for a name that is lexically indistinguishable from what they already typed. Before this phase, the owner could always fall back to the raw Telegram ID to reach a specific client; D-02 (locked) removed that fallback entirely for these 4 tools, and D-05's optional tie-breaker (e.g. last-booking-date) was explicitly declined in favor of "simplest first" (30-01-SUMMARY.md). The practical effect: for any pair of clients with identical stored names, **all 4 tools become permanently unusable for both of those clients** — not transiently ambiguous, but unreachable, with no way out short of a DB edit.
**Fix:**
```ts
function formatClientDisambiguation(matches: AllTimeClient[]): string {
  const names = matches.map((m) => m.clientName ?? '(χωρίς όνομα)');
  const hasDuplicateNames = new Set(names).size < names.length;
  const list = names.join(', ');
  return hasDuplicateNames
    ? `Πολλοί πελάτες ταιριάζουν με το ίδιο όνομα: ${list}. Δεν μπορώ να τους ξεχωρίσω — χρησιμοποιήστε τη λίστα πελατών στο μενού.`
    : `Πολλοί πελάτες ταιριάζουν: ${list}. Δώστε ένα πιο συγκεκριμένο όνομα.`;
}
```
At minimum, detect the exact-duplicate case and point the owner at an existing escape hatch (e.g. the `/menu` → Πελάτες client list) instead of asking for a "more specific name" that cannot exist.

### WR-02: Dead `?? clientPhone` fallback is a latent D-05 leak trap, not a live bug

**File:** `src/onboarding/ai-owner-agent.ts:931`, `:967`, `:990`
**Issue:** `assign_client_to_session`, `list_slotless_requests`, and `send_renewal_reminder` all compute `const clientDisplayName = resolved.match.clientName ?? clientPhone;` and interpolate `clientDisplayName` into owner-facing confirmation/status text. Because `resolveClientByName`'s filter (`c.clientName?.toLowerCase().includes(needle)`, line 141) can only ever select a client whose `clientName` is a non-null string that matched the needle, `resolved.match.clientName` is always truthy at all three call sites today — the `?? clientPhone` branch is dead code. That's safe *now*, but it's a trap: if the matching predicate is ever relaxed (e.g. to also match by phone/ID substring, or to include clients with no name on file per D-02's discussion of that exact scenario), a null-named match could flow through this exact line and silently start printing the raw Telegram ID into an owner-facing message — violating the same D-05 guarantee this phase was built to enforce, with no existing test that would catch it (no fixture currently has a null `clientName` reaching a `'single'` resolution, because none can).
**Fix:** Remove the fallback (it can't fire, and D-05 forbids the value it falls back to) and use the same placeholder `formatClientDisambiguation` already uses:
```ts
const clientDisplayName = resolved.match.clientName ?? '(χωρίς όνομα)';
```
Or, if the `?? clientPhone` shape is kept for defensiveness, add a unit test with a null-`clientName` fixture asserting the resulting text never contains `senderPhone`, so a future filter change can't reintroduce the leak unnoticed.

### WR-03: Disambiguation list has no length/count cap

**File:** `src/onboarding/ai-owner-agent.ts:153-156`
**Issue:** `formatClientDisambiguation` joins every matched `clientName` into one comma-separated string with no cap on match count, unlike every other list-rendering path in this same file (e.g. `list_sessions` caps display at 20 and appends a "...και N ακόμα" summary, lines 875-882). A short or common needle (a single letter, or a common first name shared by many clients) could produce an excessively long Telegram message with no truncation, which is inconsistent with the file's own established convention.
**Fix:** Cap the rendered list consistent with the existing pattern:
```ts
function formatClientDisambiguation(matches: AllTimeClient[]): string {
  const display = matches.slice(0, 15);
  const names = display.map((m) => m.clientName ?? '(χωρίς όνομα)').join(', ');
  const suffix = matches.length > 15 ? ` (και ${matches.length - 15} ακόμα)` : '';
  return `Πολλοί πελάτες ταιριάζουν: ${names}${suffix}. Δώστε ένα πιο συγκεκριμένο όνομα.`;
}
```

## Info

### IN-01: Ambiguous-match branch is untested for 3 of the 4 converted tools

**File:** `tests/ai-owner-name-matching.test.ts:345-523`
**Issue:** Only `view_client_membership` has a direct test proving the 2+-match branch returns a names-only list and skips downstream logic (`ai-owner-name-matching.test.ts:238-258`). `assign_client_to_session`, `send_renewal_reminder`, and `list_slotless_requests` are only exercised for single-match and zero-match wiring — their own "ambiguous never touches downstream logic" behavior is currently true by code inspection (identical `if (resolved.kind === 'ambiguous') return formatClientDisambiguation(...)` guard in all 4 cases) but isn't independently verified per tool, so a future edit that reorders one tool's checks wouldn't be caught by this suite.
**Fix:** Add one ambiguous-match test per remaining tool (mirroring the existing zero-match tests), asserting `mockListSessions`/`mockedGetClientActiveMembership`/`mockedListSlotlessRequestsForClient` are never called.

---

_Reviewed: 2026-07-29T00:58:18Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

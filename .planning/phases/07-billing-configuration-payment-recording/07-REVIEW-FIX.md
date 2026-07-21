---
phase: 07-billing-configuration-payment-recording
fixed_at: 2026-07-21T00:00:00Z
review_path: .planning/phases/07-billing-configuration-payment-recording/07-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 7: Code Review Fix Report

**Fixed at:** 2026-07-21
**Source review:** .planning/phases/07-billing-configuration-payment-recording/07-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (3 Critical + 6 Warning)
- Fixed: 9
- Skipped: 0

## Fixed Issues

### CR-01: Migration 0006 creates billing tables without RLS — all T-07-03 "RLS enforcement" claims are false

**Files modified:** `migrations/0009_billing_rls.sql`
**Commit:** 1ff8c78
**Applied fix:** Created new migration `0009_billing_rls.sql` that enables Row Level Security on `billing_packages`, `memberships`, and `membership_ledger`. Followed the existing pattern from `0003_phase4_per_bot.sql` — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + idempotent `CREATE POLICY` in DO blocks. `billing_packages` and `memberships` use `business_id = current_setting('app.current_business_id', true)::INTEGER` FOR ALL. `membership_ledger` (no `business_id` column) uses an open `USING (true)` policy, consistent with the review recommendation.

---

### CR-02: `athensEndOfDay` produces wrong expiry timestamps on non-UTC servers

**Files modified:** `src/billing/queries.ts`, `tests/billing-dst-arithmetic.test.ts`
**Commit:** 8ff44fa
**Applied fix:** Replaced the `toLocaleString` + `new Date(localeString)` approach (server-timezone-dependent) with `Intl.DateTimeFormat.formatToParts()` using noon UTC as the DST-safe anchor. The function is also exported (`export function athensEndOfDay`) so tests can import it directly. Added two new test assertions in `billing-dst-arithmetic.test.ts` that pin the expected UTC hour for summer (2024-07-01 → UTC hour 20) and winter (2024-12-01 → UTC hour 21) dates. All 5 tests in the DST arithmetic suite pass.

---

### CR-03: `handleConfirmMembership` has no error handling around `createMembership` — owner receives no feedback on failure

**Files modified:** `src/telegram/handlers/payment-flow.ts`
**Commit:** 8570d9b
**Applied fix:** Wrapped the `createMembership` call in a try/catch block. On failure, logs the error with structured context (`{ err, businessId, clientRelId, packageId }`) and sends a Greek error message to the owner: "Σφάλμα κατά την καταγραφή πληρωμής. Ελέγξτε αν η συνδρομή ήδη υπάρχει και δοκιμάστε ξανά." Returns early so no false-success message is sent. The result variable is explicitly typed to maintain TypeScript correctness after the try/catch split.

---

### WR-01: `createMembership` and `getPackageById` — package lookup has no `businessId` filter; foreign package data accepted

**Files modified:** `src/billing/queries.ts`, `src/telegram/handlers/payment-flow.ts`
**Commit:** 38d6494
**Applied fix:** Added `businessId: number` parameter to `getPackageById` and added `eq(billingPackages.businessId, businessId)` to its WHERE clause. Added the same ownership guard to the package fetch inside `createMembership`'s `db.transaction()` — both the error message and the WHERE clause now include `businessId`. Updated both callers in `payment-flow.ts` (`showMembershipConfirmation` at line 128, `handleConfirmMembership` at line 198) to pass `businessId`.

---

### WR-02: `answerCallbackQuery` double-called for three billing callback actions

**Files modified:** `src/telegram/handlers/payment-flow.ts`, `tests/billing-payment-flow.test.ts`
**Commit:** 919ea27, 1583082
**Applied fix:** Removed the `await answerCallbackQuery(callbackQueryId)` call from `handleConfirmMembership`, `handleCancelPackage`, and `handleConfirmPackage` — the outer `handleCallbackQuery` in `telegram.ts` already calls it at line 207 before dispatching. Removed the now-unused `answerCallbackQuery` import from `payment-flow.ts`. Added JSDoc `NOTE:` to each handler documenting the new contract. Updated the unit tests in `billing-payment-flow.test.ts` to assert `expect(mockAnswerCallback).not.toHaveBeenCalled()` (verifying handlers do NOT double-call it) and updated the comments to explain the dispatcher-owns-spinner contract.

---

### WR-03: `deactivatePackage` WHERE clause lacks `isActive = true` — returns `true` for already-inactive packages

**Files modified:** `src/billing/queries.ts`
**Commit:** 677a0ac
**Applied fix:** Added `eq(billingPackages.isActive, true)` as a third condition in the `deactivatePackage` WHERE clause. Postgres only returns the row from `UPDATE ... RETURNING` when the row was actually matched and modified (via the `WHERE is_active = true` guard), so `rows.length > 0` now correctly returns `false` for already-inactive packages.

---

### WR-04: Owner agent system prompt receives UTC date — "today" is wrong 1–3 hours after Athens midnight

**Files modified:** `src/webhooks/telegram.ts`
**Commit:** 67258a3
**Applied fix:** Added `import { isoDateInAthens } from '../utils/timezone'` and replaced `new Date().toISOString().slice(0, 10)` with `isoDateInAthens(new Date())`. The `isoDateInAthens` utility already exists and is used throughout the billing layer — this makes the owner agent consistent with it.

---

### WR-05: Idempotency key blocks legitimate same-day payment renewal for the same client

**Files modified:** `src/billing/queries.ts`, `tests/billing-membership-creation.test.ts`
**Commit:** f2ffaee, 1583082
**Applied fix:** Appended `memberId` to the idempotency key: `${businessId}:${clientPhone}:payment_recorded:${purchaseDate}:${memberId}`. Updated the JSDoc to document the new key design and the WR-05 rationale. Updated `billing-membership-creation.test.ts` — the ledger key assertion and the idempotency replay test both use the new `:${memberId}` suffix. Note: double-tap on the same active membership row still triggers a constraint violation (same memberId returned by `onConflictDoUpdate`), preserving the T-07-04 replay guard.

---

### WR-06: `deactivate_package` passes `Number(args.package_id)` without validation — `NaN` silently no-ops

**Files modified:** `src/onboarding/ai-owner-agent.ts`
**Commit:** 2e0a6a3
**Applied fix:** Added `import { z } from 'zod'` to `ai-owner-agent.ts`. Added an inline `DeactivatePackageSchema = z.object({ package_id: z.number().int().positive() })` with `safeParse` before the `handleDeactivatePackage` call. On parse failure, returns the Greek error message "Μη έγκυρο ID πακέτου. Παρακαλώ δώσε τον αριθμό ID του πακέτου." directly to Gemini. On success, passes `parsedDeactivate.data.package_id` (already a validated `number`) to `handleDeactivatePackage`, eliminating the `Number(args.package_id)` `NaN` risk.

---

_Fixed: 2026-07-21_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

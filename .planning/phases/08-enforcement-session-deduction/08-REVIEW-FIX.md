---
phase: 08-enforcement-session-deduction
fixed_at: 2026-07-20T00:00:00Z
review_path: .planning/phases/08-enforcement-session-deduction/08-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 8: Code Review Fix Report

**Fixed at:** 2026-07-20
**Source review:** .planning/phases/08-enforcement-session-deduction/08-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (4 Critical, 4 Warning; Info findings excluded per fix_scope=critical_warning)
- Fixed: 8
- Skipped: 0

## Fixed Issues

### CR-01: Non-existent Gemini model identifier — both AI agents fail at runtime

**Files modified:** `src/conversation/ai-agent.ts`, `src/onboarding/ai-owner-agent.ts`
**Commit:** a61f36e
**Applied fix:** Changed `GEMINI_MODEL = 'gemini-3.1-flash-lite'` to `GEMINI_MODEL = 'gemini-2.5-flash-lite'` in both files. The `3.1` identifier does not exist in Google's Gemini API; `2.5-flash-lite` is the correct model aligned with CLAUDE.md.

---

### CR-02: `findServiceById` arguments reversed in `view_todays_schedule` — service names never resolved

**Files modified:** `src/onboarding/ai-owner-agent.ts`
**Commit:** 5bf979c
**Applied fix:** Swapped the two arguments at line 375 from `findServiceById(b.serviceId, business.id)` to `findServiceById(business.id, b.serviceId)`, matching the function signature `(businessId, serviceId)`.

---

### CR-03: `restoreCredit` expiry check inflates current timestamp by 2–3 hours — valid memberships denied credit restore

**Files modified:** `src/billing/queries.ts`
**Commit:** 7370fad
**Applied fix:** Replaced the `toLocaleString`-based `nowAthens` construction with a direct `new Date()` UTC comparison. `membership.expiresAt` is stored as a UTC `TIMESTAMP WITH TIME ZONE` from PostgreSQL; comparing it against plain UTC is both correct and sufficient. The old approach produced an epoch 2–3 hours in the future during Athens DST, falsely expiring valid memberships.

---

### CR-04: `sessionsRemaining === 0` passes the deduction guard, driving the counter negative; block/flag enforcement ignores exhausted packs

**Files modified:** `src/conversation/function-executor.ts`
**Commit:** f1a5055
**Applied fix:** Added `ActiveMembershipForDeduction` to the billing/queries import, introduced a `hasCapacity` helper (`sessionsRemaining === null || sessionsRemaining > 0`), and derived `noValidMembership = membership === null || !hasCapacity(membership)`. Applied at three points: (1) block-policy guard now uses `noValidMembership`; (2) flag-alert guard now uses `noValidMembership`; (3) deduction guard now requires `sessionsRemaining > 0` to prevent decrementing 0 to -1.

---

### WR-01: `deactivate_package` bypasses RLS — LLM hallucination can deactivate packages from other businesses

**Files modified:** `src/onboarding/ai-owner-agent.ts`, `src/billing/tools.ts`, `src/billing/queries.ts`
**Commit:** 5757691
**Applied fix:** Three-layer defense-in-depth: (1) `deactivate_package` case in `executeOwnerTool` is now wrapped in `withBusinessContext` and passes `business.id` to `handleDeactivatePackage`; (2) `handleDeactivatePackage` signature updated to accept `businessId` as first parameter; (3) `deactivatePackage` in queries.ts now takes `businessId`, uses `getConn()` instead of `db`, and adds `eq(billingPackages.businessId, businessId)` to the WHERE clause for ownership enforcement.

---

### WR-02: `executeOwnerTool` scheduling cases have no error handling — DB errors produce a silent no-reply for the owner

**Files modified:** `src/onboarding/ai-owner-agent.ts`
**Commit:** 5d602bf
**Applied fix:** Wrapped the entire `switch` body in `executeOwnerTool` with a `try { ... } catch (err)` block. On any uncaught error (e.g. unique constraint violation on `add_service`), the catch block logs the error with `logger.error` and returns `'Σφάλμα κατά την εκτέλεση. Δοκιμάστε ξανά.'` so the owner receives a reply rather than a silent failure.

---

### WR-03: `withBusinessContext` uses `sql.raw()` with string interpolation for the RLS `SET LOCAL`

**Files modified:** `src/database/queries.ts`
**Commit:** ee1de7f
**Applied fix:** Replaced `tx.execute(sql.raw(`SET LOCAL app.current_business_id = '${Number(businessId)}'`))` with `tx.execute(sql\`SELECT set_config('app.current_business_id', ${String(Number(businessId))}, true)\`)`. Uses Drizzle's parameterized `sql` template tag instead of `sql.raw`, eliminating string interpolation on the security-critical RLS bootstrap path. Prevents the `NaN` silent-failure scenario if `Number()` cannot parse the input.

---

### WR-04: Scheduling tool mutations use admin `db` connection, bypassing RLS

**Files modified:** `src/onboarding/ai-owner-agent.ts`
**Commit:** 355bf20
**Applied fix:** Added `getConn` to the import from `'../database/queries'`. Wrapped all five scheduling cases (`update_hours`, `close_day`, `add_service`, `update_service_price`, `delete_service`) in `withBusinessContext(business.id, async () => { ... })` and replaced `db.insert/update/delete` with `getConn().insert/update/delete` inside each callback. This ensures the mutations run inside an RLS-enforced transaction context, matching the pattern already used by the billing cases in the same function.

---

_Fixed: 2026-07-20_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

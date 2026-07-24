---
phase: 16-single-bot-architecture
reviewed: 2026-07-24T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/config.ts
  - src/database/migrations/0023_add_onboarding_completed.sql
  - src/database/queries.ts
  - src/database/schema.ts
  - src/onboarding/steps.ts
  - src/server.ts
  - src/webhooks/telegram.ts
  - tests/webhooks/telegram-webhook.onboarding.test.ts
findings:
  critical: 1
  warning: 2
  info: 2
  total: 5
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-07-24T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 16 replaces the platform bot with per-business-bot admin/client routing, gated by a new `businesses.onboarding_completed` flag. The schema, migration, and step handlers for the onboarding state machine (`src/onboarding/steps.ts`) are internally consistent and well-guarded. However, the single most important piece of this phase — wiring the `onboarding_completed` gate into the live webhook handler so that an owner who hasn't finished setup is routed into the onboarding flow instead of the full admin agent — **is missing from the shipped code**. This is not a hypothetical: running the phase's own test suite against the current tree fails on exactly the two scenarios (A and B) that assert this behavior. Git history shows the fix was implemented and then silently clobbered by a later phase's commit built from a stale base. This is a BLOCKER: as shipped, the "onboarding auto-start" feature that is the stated purpose of this phase does not exist at runtime, and none of the new business-bootstrap functions (`createBusinessForOnboarding`, `createOrResetOnboardingSession`, `dispatchOnboardingStep`, `findActiveSessionByOwnerTelegramId`) are reachable from any code path.

Two secondary issues were found around the migration's backfill assumptions and a stale-session edge case in `handleActivate`. Full details below.

## Critical Issues

### CR-01: Onboarding auto-start routing was never wired into `handleFoundBusiness` — dead code, failing tests, confirmed regression

**File:** `src/webhooks/telegram.ts:68-116`
**Issue:**

`handleFoundBusiness` routes any message from `business.ownerTelegramId === senderTelegramId` straight to the `/menu` shortcut or `aiOwnerAgent`, regardless of `business.onboardingCompleted`:

```ts
if (business.ownerTelegramId === senderTelegramId) {
  if (messageText.trim() === '/menu') {
    await showAdminRootMenu(senderTelegramId, business);
    await markTelegramUpdateProcessed(updateId, business.id);
    return;
  }
  const today = isoDateInAthens(new Date());
  const reply = await aiOwnerAgent(business, senderTelegramId, messageText, today);
  ...
}
```

There is no check of `business.onboardingCompleted`, no call to `findActiveSessionByOwnerTelegramId`, `createOrResetOnboardingSession`, or `dispatchOnboardingStep` anywhere in this file. Confirmed by actually running the phase's own test file:

```
FAIL tests/webhooks/telegram-webhook.onboarding.test.ts
  Scenario A: owner with incomplete onboarding, active session → dispatchOnboardingStep
    ✕ calls dispatchOnboardingStep with session and step name, does not call aiOwnerAgent
  Scenario B: owner with incomplete onboarding, no session → create session + welcome message
    ✕ calls createOrResetOnboardingSession with name step and sends welcome message
```

Root cause is visible in git history. The routing was correctly implemented in commit `1673523` ("feat(16-single-bot-architecture-02): extend handleFoundBusiness with onboarding routing"), whose diff base for `src/webhooks/telegram.ts` was blob `7052e9e`. A later commit, `9ef5d67` ("feat(17-admin-menu-01): wire /menu command…"), diffs against the **same** base blob `7052e9e` instead of the tip that already contained `1673523`'s changes — i.e. it was authored against a stale copy of the file and, on merge, silently discarded the entire onboarding-routing block while adding the unrelated `/menu` feature. `git log 1673523..HEAD -- src/webhooks/telegram.ts` shows `9ef5d67` (and later commits) landed on top without the phase-16 change ever reappearing.

Consequences as shipped:
- `createBusinessForOnboarding`, `createOrResetOnboardingSession`, `findActiveSessionByOwnerTelegramId`, and `dispatchOnboardingStep` are unreachable from any runtime code path (confirmed via `grep -rln` across `src/` — the only callers are in `src/onboarding/queries.ts`/`router.ts` themselves and test files). There is currently no live path in `src/` that even creates a new business row (the platform bot that used to call `createBusinessForOnboarding` was deleted in this same phase, commit `2b6a34c`, and nothing replaced that call site).
- Any business owner whose `onboarding_completed` is `false` is routed straight into the full admin AI agent (and `/menu`), operating on a business with no name, hours, or services configured — the opposite of the intended safety gate.
- The `onboarding_completed` column (schema.ts, migration 0023) is written once (`handleActivate` in `steps.ts`) but never read for routing decisions anywhere in the reachable code.

**Fix:** Restore the onboarding-gate block from commit `1673523` inside `handleFoundBusiness`, e.g.:

```ts
import {
  findBusinessByOwnerTelegramId,
  findActiveSessionByOwnerTelegramId,
  createOrResetOnboardingSession,
} from '../onboarding/queries';
import { dispatchOnboardingStep } from '../onboarding/router';

// ...
if (business.ownerTelegramId !== null && business.ownerTelegramId === senderTelegramId) {
  if (!business.onboardingCompleted) {
    const activeResult = await findActiveSessionByOwnerTelegramId(senderTelegramId);
    if (activeResult) {
      await dispatchOnboardingStep(activeResult.session, activeResult.business, senderTelegramId, messageText);
    } else {
      await createOrResetOnboardingSession(business.id, 'name');
      await sendTelegramMessage(senderTelegramId, 'Καλωσήρθατε! Πώς ονομάζεται η επιχείρησή σας;');
    }
    await markTelegramUpdateProcessed(updateId, business.id);
    return;
  }
  // existing /menu + aiOwnerAgent path (ARCH-02)
  ...
}
```

Place this gate **before** the `/menu` shortcut, not after — otherwise an owner who hasn't finished onboarding but types `/menu` will still reach `showAdminRootMenu` on an unconfigured business. Re-run `tests/webhooks/telegram-webhook.onboarding.test.ts` and confirm all 6 scenarios pass before merging. Also audit how a brand-new business is supposed to be bootstrapped now that `platform.ts` is gone — `createBusinessForOnboarding` needs a live caller (e.g. an owner-facing `/register <bot_token>` entry point on some existing channel) or businesses can never be created at all in the current architecture.

## Warnings

### WR-01: Migration 0023 backfill can leave legacy/pre-onboarding businesses permanently misrouted into setup

**File:** `src/database/migrations/0023_add_onboarding_completed.sql:4-10`
**Issue:**

```sql
UPDATE businesses b
  SET onboarding_completed = true
  WHERE EXISTS (
    SELECT 1 FROM onboarding_sessions os
    WHERE os.business_id = b.id
      AND os.current_step = 'done'
  );
```

This only marks a business `onboarding_completed = true` if it has a matching `onboarding_sessions` row with `current_step = 'done'`. Every current business-creation path (`createBusinessForOnboarding` in `src/onboarding/queries.ts`) goes through the self-serve onboarding flow introduced in Phase 5, so this is safe for businesses created since then. But `schema.ts`'s own comment on `ownerTelegramId` notes "Phase 1 already inserted 2 rows" — i.e. businesses that predate the `onboarding_sessions` table (added in migration `0004_phase5_onboarding.sql`) entirely. Such rows have no `onboarding_sessions` row at all, so `EXISTS(...)` is false and they are left at the column default `false`, even if they are fully active, already-configured, live businesses with real client traffic.

Once CR-01 is fixed, this becomes directly exploitable/harmful in production: an already-active business owner's very next message would be routed into the "Πώς ονομάζεται η επιχείρησή σας;" (name) step instead of their normal admin agent, and any answer they give would overwrite `businesses.name`/`slug` on a live business, or insert duplicate `business_hours`/`services` rows alongside their real configured data.

**Fix:** Verify (before running this migration against the production database) whether any business rows exist with no corresponding `onboarding_sessions` row but a non-null `webhook_id`/`bot_token` (i.e., already wired up to receive traffic), and explicitly backfill those to `true` as well, e.g.:

```sql
UPDATE businesses b
  SET onboarding_completed = true
  WHERE onboarding_completed = false
    AND NOT EXISTS (SELECT 1 FROM onboarding_sessions os WHERE os.business_id = b.id)
    AND b.webhook_id IS NOT NULL;
```

(Note `webhook_id` is also set on session *creation*, not only completion, per `createBusinessForOnboarding` — so this heuristic alone isn't sufficient either; the safest fix is a one-time manual audit of existing rows against real deployment state before/after applying this migration.)

### WR-02: `handleActivate`'s missing-config guard leaves the onboarding session stuck on the wrong step

**File:** `src/onboarding/steps.ts:455-469`
**Issue:**

```ts
export async function handleActivate(
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string
): Promise<void> {
  const webhookId = crypto.randomUUID();
  const webhookSecret = crypto.randomBytes(32).toString('hex');

  if (!config.webhookBaseUrl) {
    await sendTelegramMessage(
      ownerTelegramId,
      'Σφάλμα: το WEBHOOK_BASE_URL δεν έχει οριστεί. Επικοινωνήστε με τον διαχειριστή.'
    );
    return;
  }
  ...
```

`handleActivate` is called as the terminal step from several handlers (`handleConfigLastSessionThresholdStep`, `handleClassSetupQuery`, `handleClassSetupMoreStep`) without those callers first advancing `session.currentStep` to some "pending activation" marker. If `config.webhookBaseUrl` is unset, this function returns early having sent an error message, but the `onboarding_sessions.current_step` row is left at whatever step the caller was on (e.g. `config_last_session_threshold` or `class_setup_more`). The owner's next message will then be re-dispatched to that same step handler (via `dispatchOnboardingStep`), which will misinterpret it as an answer to a question that was already answered (e.g. re-parsing "ναι" as a renewal-threshold count), rather than retrying activation.

**Fix:** Either advance `session.currentStep` to a dedicated `pending_activation` step before returning on the config-guard branch (with a corresponding dispatcher case that retries `handleActivate`), or have the guard prompt the owner to send any message to retry activation explicitly and re-check the guard on retry from a stable state.

## Info

### IN-01: Non-null assertions on `business.botToken!` assume an invariant the schema doesn't enforce

**File:** `src/onboarding/steps.ts:472,474`
**Issue:** `botToken` is a nullable column (`text('bot_token')`, `src/database/schema.ts:35`), but `handleActivate` does `unregisterBotWebhook(business.botToken!)` / `registerBotWebhook(business.botToken!, ...)`. If a business row ever reaches this step with `botToken` null (e.g. data corruption, a future refactor of the creation path), this throws at runtime instead of failing with a clear, catchable error. The surrounding `dispatchOnboardingStep` try/catch will contain the crash and send a generic Greek error message, so it's not an outage risk today, but it silently masks a data-integrity bug.
**Fix:** Add an explicit guard (`if (!business.botToken) { ...log + return... }`) mirroring the existing `config.webhookBaseUrl` guard, instead of relying on the non-null assertion.

### IN-02: Two parallel, differently-numbered migration directories make ordering unclear

**File:** `src/database/migrations/0023_add_onboarding_completed.sql`
**Issue:** This repo has two migration directories: `/migrations` (drizzle-kit managed, `db:generate`/`db:push`, currently up to `0012_*.sql`) and `src/database/migrations` (hand-written, applied out-of-band, containing only `0005-enforcement-policy.sql` and this phase's `0023_add_onboarding_completed.sql`). Neither `package.json` nor any script in `src/` references `src/database/migrations`, so it's unclear how/when `0023_add_onboarding_completed.sql` actually gets applied, and its numbering (`0023`) has no relation to the drizzle-managed sequence (`0012` max). This predates Phase 16 but this phase adds to the confusion by extending the pattern.
**Fix:** Document (e.g. in a README in that directory) how/when these hand-written migrations are expected to be run relative to the drizzle-kit sequence, or consolidate onto a single migration mechanism.

---

_Reviewed: 2026-07-24T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

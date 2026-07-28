---
phase: 27-client-consent-registration
reviewed: 2026-07-28T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - migrations/0013_client_consent_gate.sql
  - src/database/schema.ts
  - src/database/queries.ts
  - src/utils/greek-messages.ts
  - src/consent/checker.ts
  - src/webhooks/telegram.ts
  - src/conversation/router.ts
  - tests/webhooks/client-menu.test.ts
  - tests/conversation-router.test.ts
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 27: Code Review Report

**Reviewed:** 2026-07-28T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This phase repurposes `client_business_relationships.consent_given` from an
implied-consent default (`true`) to an explicit opt-in gate (`false`), adds a
Ναι/Όχι consent keyboard, and wires a hard gate into both the `/start`
command path (`telegram.ts`) and the free-chat path
(`conversation/router.ts`). The gate logic itself is correctly implemented
and reasonably well tested (Suite G in `client-menu.test.ts`, Tests 1–4 in
`conversation-router.test.ts`): once a client is un-consented, no AI call and
no persisted conversation turn happen, and an already-accepted consent can
never be silently reset to `false` (the `onConflictDoUpdate` SET clause in
`insertClientBusinessRelationship` deliberately excludes `consentGiven`).

The main defect found is that the correctness of the entire feature now
depends on an *unenforced* ordering assumption between the migration and the
application code — the app no longer defends its own invariant at the call
site, it trusts the database default exclusively. A secondary defect is that
the field meant to serve as the consent audit trail (`consentTimestamp`) is
overwritten by unrelated, routine traffic, undermining exactly the kind of
record a GDPR-driven consent feature is built to produce.

## Critical Issues

### CR-01: New-client consent default silently reverts to "consented" if migration 0013 has not yet run when this code is deployed

**File:** `src/database/queries.ts:215-236` (also `migrations/0013_client_consent_gate.sql:39-40`, `src/database/schema.ts:113`)
**Issue:**
`insertClientBusinessRelationship`'s `.values({...})` block for a fresh row
no longer sets `consentGiven` explicitly — the docstring above it says this
is intentional: "a brand-new row now relies purely on the column's DB
default (migration 0013 flips it to false)". That makes the entire hard
consent gate's correctness depend on migration `0013_client_consent_gate.sql`
having already executed against the target database *before* this
application code starts serving traffic.

If the new code is deployed even briefly before the migration is applied
(rolling deploy, migration step failing/delayed, a hotfix redeploy that
skips the migration step, a staging/preview environment that runs code
without running migrations, etc.), the column's live default is still the
old `true`. Every brand-new client during that window gets
`consentGiven: true` from the DB default, the gate in
`conversation/router.ts:41` and `webhooks/telegram.ts:145` reads `true`, and
the client is fully onboarded with **zero consent ever collected or
recorded** — the exact failure mode COMP-01/COMP-02 exists to prevent, and it
fails silently (no error, no log line, no test can catch it because it's a
deployment-ordering problem, not a code-path problem).

This is a fragile way to guarantee a compliance-critical invariant: nothing
in the application code asserts or falls back to the safe value; it fully
outsources correctness to infrastructure sequencing.

**Fix:** Make the application layer the source of truth for the safe
default, independent of migration timing — set it explicitly on insert
(the DB default becomes defense-in-depth, not the only line of defense):

```ts
export async function insertClientBusinessRelationship(
  businessId: number,
  senderPhone: string,
  clientName?: string
): Promise<ClientBusinessRelationship> {
  const rows = await getConn()
    .insert(clientBusinessRelationships)
    .values({
      businessId,
      senderPhone,
      clientName,
      consentGiven: false, // explicit — do not rely solely on the DB default
      consentTimestamp: new Date(),
    })
    .onConflictDoUpdate({
      target: [clientBusinessRelationships.businessId, clientBusinessRelationships.senderPhone],
      set: { clientName, consentTimestamp: new Date() },
    })
    .returning();

  return rows[0];
}
```

With this change, the migration's `DEFAULT false` becomes a secondary
safeguard rather than the only mechanism enforcing the gate, and the feature
is correct regardless of whether the migration has run yet at deploy time.

## Warnings

### WR-01: `consentTimestamp` is overwritten by every subsequent message, destroying the consent audit trail

**File:** `src/database/queries.ts:215-236`, `src/webhooks/telegram.ts:1225-1239`
**Issue:** `updateClientConsentGiven` (queries.ts:245-259) correctly stamps
`consentTimestamp` at the moment the client actually accepts/declines. But
`insertClientBusinessRelationship`'s `onConflictDoUpdate` SET clause
(`set: { clientName, consentTimestamp: new Date() }`) also refreshes
`consentTimestamp` on *every* subsequent message — and this upsert is called
unconditionally for every client message via the "D-04: upsert clientName"
step in `handleTelegramWebhookPost` (telegram.ts:1231-1239), regardless of
whether the message is consent-related.

Concretely: client accepts consent at T0 (`consentTimestamp = T0`); client
sends any ordinary message at T1 (`consentTimestamp` gets overwritten to
T1). The column can no longer answer "when did this client actually consent"
— which is precisely the fact a GDPR-oriented consent feature needs to be
able to produce on request (Art. 7(1) burden of proof). This was a
comparatively harmless quirk before this phase (when consent was implied by
default and the column was really just a "last contact" timestamp), but now
that `consentGiven` carries real legal weight, overloading the same column
for both "last contact" and "consent granted at" is a genuine compliance
gap.

**Fix:** Separate the two concerns — keep `consentTimestamp` write-once (set
only on insert and in `updateClientConsentGiven`), and either add a new
`lastContactAt` column for the "upsert on every message" use case, or stop
refreshing `consentTimestamp` in `insertClientBusinessRelationship`'s SET
clause:

```ts
.onConflictDoUpdate({
  target: [clientBusinessRelationships.businessId, clientBusinessRelationships.senderPhone],
  set: { clientName }, // consentTimestamp no longer touched here
})
```

### WR-02: `consentAction` callback branch has no owner-exclusion guard, unlike every sibling branch

**File:** `src/webhooks/telegram.ts:489-501`
**Issue:** Every other owner-vs-client discriminated branch in
`handleCallbackQuery` (`escalationAction`, `menuAction`, `sbkAction`,
`otcAction`) explicitly checks `business.ownerTelegramId !== senderTelegramId`
before proceeding, matching the pattern documented at
`webhooks/telegram.ts:648-652` (T-22-01/T-22-02 style guard). The new
`consentAction` branch has no such check:

```ts
if ('consentAction' in parsed) {
  const consentResult = parsed as ConsentCallbackResult;
  ...
  if (consentResult.consentAction === 'yes') {
    await updateClientConsentGiven(business.id, senderTelegramId, true);
    await showClientRootMenu(senderTelegramId, business);
  } ...
}
```

In the normal UI flow the owner never sees this keyboard (the owner branch
in `handleFoundBusiness` always returns before the `/start`/client branches
run), so this is low-impact in practice — but it's an inconsistent
authorization pattern relative to every sibling branch in the same
dispatcher, and it means a crafted/replayed `consent:yes` `callback_query`
from the owner's own account would silently create a
`clientBusinessRelationship` row for the owner against their own business.
Defense-in-depth suggests matching the established pattern used everywhere
else in this file.

**Fix:** Add the same guard style used elsewhere, or explicitly document why
it is intentionally omitted (e.g., because the action is self-scoped and has
no cross-tenant blast radius):

```ts
if ('consentAction' in parsed) {
  if (business.ownerTelegramId === senderTelegramId) {
    logger.warn({ senderTelegramId }, 'consent callback from owner, ignoring');
    return;
  }
  ...
}
```

## Info

### IN-01: No test pins the explicit-default behavior that CR-01 depends on

**File:** `tests/webhooks/client-menu.test.ts`, `tests/conversation-router.test.ts`
**Issue:** Both test files mock `insertClientBusinessRelationship` /
`getOrCreateClientRelationship` directly, so none of them exercise the real
`.values({...})` call in `queries.ts` and therefore cannot catch a
regression like CR-01 (i.e., nothing fails today, and nothing would fail if
someone re-adds `consentGiven: true` to the insert by mistake, or if CR-01's
fix is reverted later).
**Fix:** Add a focused unit test (with the real `db.insert` mocked at the
query-builder level, not at the `queries` module level) asserting that
`insertClientBusinessRelationship`'s `.values(...)` call includes
`consentGiven: false` explicitly, so the invariant is pinned in code rather
than only in a migration comment.

---

_Reviewed: 2026-07-28T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

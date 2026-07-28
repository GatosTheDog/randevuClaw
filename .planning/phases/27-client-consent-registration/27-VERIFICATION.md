---
phase: 27-client-consent-registration
verified: 2026-07-28T12:04:10Z
status: passed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 27: Client Consent & Registration Verification Report

**Phase Goal:** Wire an explicit, hard opt-in consent gate into both client entry points (/start and free-form chat) so the client's consent status is a real, enforced opt-in flag — not an implied/default-true one — closing the COMP-01/COMP-02 compliance gap.
**Verified:** 2026-07-28T12:04:10Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | New `client_business_relationships` rows start unconsented (`consentGiven=false`) | ✓ VERIFIED | `src/database/schema.ts:113` — `.default(false)`; `migrations/0013_client_consent_gate.sql` applied to live Neon DB, verified `column_default = 'false'` via live read-only query (see below); `src/database/queries.ts:228` sets `consentGiven: false` explicitly on INSERT (post-review hardening, commit `4a3493e`, so correctness no longer depends solely on migration-vs-deploy ordering) |
| 2 | Pre-existing (pre-v1.7) rows remain `consentGiven=true` — no real client silently blocked | ✓ VERIFIED | Live Neon DB query: `SELECT consent_given, count(*) FROM client_business_relationships GROUP BY consent_given` → `[{"consent_given":true,"count":"3"}]` — all 3 existing rows grandfathered to `true`, none flipped to `false` |
| 3 | `insertClientBusinessRelationship`'s upsert never resets an accepted consent back to `false` (race safety, PITFALLS.md Pitfall 3) | ✓ VERIFIED | `src/database/queries.ts:231-235` — `onConflictDoUpdate` SET clause is `{ clientName, consentTimestamp: new Date() }`; `consentGiven` is absent from the SET clause |
| 4 | A client who first messages via `/start` sees the merged Ναι/Όχι prompt instead of the client menu when unconsented | ✓ VERIFIED | `src/webhooks/telegram.ts:140-155` (`/start` branch calls `getOrCreateClientRelationship`, branches on `consentGiven`); `tests/webhooks/client-menu.test.ts` Suite G, tests "`/start` with consentGiven=false" and "consentGiven=true" — both pass, asserting `sendTelegramMessageWithKeyboard`/`showClientRootMenu` are mutually exclusive |
| 5 | A client's first free-form message is hard-gated — no AI call, no persisted turn — until consent is accepted (real behavior change, not the old soft prepend) | ✓ VERIFIED | `src/conversation/router.ts:31-49` — gate returns immediately on `!consentGiven`, before `findLatestConversationTurn`/`aiBookingAgent`/`insertConversationTurn`; `CONSENT_NOTICE_GREEK_TEMPLATE` prepend logic fully removed (0 references in router.ts); `tests/conversation-router.test.ts` Test 2 asserts `aiBookingAgent`, `insertConversationTurn`, and `channel.sendMessage` are NOT called on the gated path |
| 6 | Declining (Όχι) leaves `consentGiven=false` (gate re-appears); accepting (Ναι) sets it `true` via `updateClientConsentGiven` — the same flag is the opt-in/registered flag | ✓ VERIFIED | `src/webhooks/telegram.ts:489-501` — `consent:yes` calls `updateClientConsentGiven(business.id, senderTelegramId, true)` then `showClientRootMenu`; `consent:no` does neither, sends `CONSENT_DECLINE_ACK_GREEK` instead; `tests/webhooks/client-menu.test.ts` Suite G's two callback tests assert this exactly |
| 7 | Both entry points converge on the same explicit opt-in flag, with no separate registration step (COMP-02 fully closes the "genuine opt-in flag" gap) | ✓ VERIFIED | Both `/start` (`telegram.ts:144`) and free-chat (`router.ts:31`) read `consentGiven` from the same `getOrCreateClientRelationship`/`clientBusinessRelationships.consentGiven` source of truth; `CONSENT_PROMPT_GREEK_TEMPLATE` is the single merged consent+registration prompt (D-01) reused by both call sites |

**Score:** 7/7 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/database/schema.ts` | `clientBusinessRelationships.consentGiven` default flipped `true`→`false` | ✓ VERIFIED | Line 113, comment cites Phase 27/COMP-01/COMP-02/D-01/D-04 |
| `migrations/0013_client_consent_gate.sql` | Backfill + default flip, applied to live Neon DB | ✓ VERIFIED | File exists with backfill UPDATE + `DROP DEFAULT`/`SET DEFAULT false`; live DB confirms `column_default='false'` |
| `src/database/queries.ts` | `insertClientBusinessRelationship` no longer hardcodes `consentGiven:true`; new `updateClientConsentGiven` export | ✓ VERIFIED | Lines 217-262; `updateClientConsentGiven(businessId, senderPhone, consentGiven)` exported with exact signature Plan 27-02 requires |
| `src/utils/greek-messages.ts` | `CONSENT_LABELS` export | ✓ VERIFIED | Lines 28-31, `{ ACCEPT: 'Ναι', DECLINE: 'Όχι' }`, kept separate from `CONFIRM_LABELS` |
| `src/consent/checker.ts` | `CONSENT_PROMPT_GREEK_TEMPLATE`, `CONSENT_KEYBOARD`, fixed `getOrCreateClientRelationship` | ✓ VERIFIED | Lines 14-42; `getOrCreateClientRelationship` returns `inserted.consentGiven` (real row value), not a hardcoded `true` |
| `src/webhooks/telegram.ts` | `ConsentCallbackResult` type, `consent:yes`/`consent:no` parsing + handler, `/start` gate | ✓ VERIFIED | Type at line 281, regex arm line 390-393, handler branch line 489-501, `/start` gate line 140-155 |
| `src/conversation/router.ts` | `ConversationChannel.sendMessageWithKeyboard`, free-chat gate | ✓ VERIFIED | Interface extended lines 7-14, gate at lines 31-49 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| Migration 0013 (data layer) | Plan 27-02 gate logic | Live Neon DB `column_default` | ✓ WIRED | Verified live: `column_default='false'`; additionally hardened post-review so app-layer INSERT no longer depends solely on this ordering |
| `/start` branch | `getOrCreateClientRelationship` | Same `withBusinessContext` wrapper that surrounds `showClientRootMenu` | ✓ WIRED | `telegram.ts:140-155` — single `withBusinessContext(business.id, async () => {...})` callback wraps both the consent check and the menu/gate branch |
| `routeConversationMessage` gate | `aiBookingAgent` / `insertConversationTurn` | Early `return` on `!consentGiven`, before either call | ✓ WIRED | `router.ts:41-49` — gate returns before `findLatestConversationTurn` (line 52), `aiBookingAgent` (line 60), `insertConversationTurn` (line 81) |
| Pre-existing unconditional `insertClientBusinessRelationship` upsert | New `getOrCreateClientRelationship` gate call | Same underlying upsert-safe row, consent governed by column value only | ✓ WIRED | `telegram.ts:1231-1239` — untouched, still runs after `handleFoundBusiness`, upserting `clientName` only; does not touch `consentGiven` |
| `consent:yes`/`consent:no` callback | `updateClientConsentGiven` write path | `handleCallbackQuery`'s `consentAction` branch | ✓ WIRED | `telegram.ts:489-501` — exact `(businessId, senderPhone, consentGiven)` signature match with Plan 27-01's export |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `npx tsc --noEmit` | Full type-check | Exit 0, no output | ✓ PASS |
| Targeted Jest suites (`consent`, `webhooks/client-menu`, `conversation-router`) | `npx jest --testPathPattern="consent\|webhooks/client-menu\|conversation-router" --no-coverage` | 4 suites, 52 tests, all passed | ✓ PASS |
| Live Neon DB column default | `information_schema.columns` query for `client_business_relationships.consent_given` | `[{"column_default":"false"}]` | ✓ PASS |
| Live Neon DB pre-existing row grandfathering | `SELECT consent_given, count(*) ... GROUP BY consent_given` | `[{"consent_given":true,"count":"3"}]` — no `false` rows exist pre-migration | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| COMP-01 | 27-02-PLAN.md | Clients who first contact via `/start` see the consent notice; same hard gate on free-chat | ✓ SATISFIED | `/start` gate (telegram.ts) + free-chat gate (router.ts), both test-covered; row-creation-before-gate ordering explicitly resolved by locked decision 27-CONTEXT.md D-01/integration-points note ("the row can exist with consentGiven=false; the gate blocks on that flag, not on row-existence") |
| COMP-02 | 27-01-PLAN.md, 27-02-PLAN.md | Genuine opt-in/registration flag distinguishing consenting clients from incidental first-contact rows | ✓ SATISFIED | `consentGiven` repurposed (default false), `updateClientConsentGiven` write path, no separate registration step — same flag serves both purposes |

No orphaned requirements: REQUIREMENTS.md maps only COMP-01 and COMP-02 to Phase 27, and both are declared across the two plans' `requirements` frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/database/queries.ts` | 234 | `insertClientBusinessRelationship`'s `onConflictDoUpdate` SET clause still refreshes `consentTimestamp` on every routine message upsert (code review WR-01) | ℹ️ Info (documented, accepted) | Overwrites the consent-acceptance timestamp on subsequent ordinary messages, weakening the audit-trail's ability to answer "when did this client actually consent" for GDPR Art. 7(1) purposes. Flagged in `27-REVIEW.md` as a Warning; per task instructions this was left as a documented advisory finding, not fixed in this phase. Does not defeat the hard gate itself (`consentGiven` is correctly preserved). |
| `src/webhooks/telegram.ts` | 489-501 | `consentAction` callback branch has no owner-exclusion guard, unlike sibling branches (`escalationAction`, `menuAction`, `sbkAction`, `otcAction`) (code review WR-02) | ℹ️ Info (documented, accepted) | Low-impact in practice (owner branch returns before the `/start`/client branches run in `handleFoundBusiness`, so the owner never normally sees this keyboard); a crafted/replayed callback from the owner's own account could create a self-referential relationship row. Flagged in `27-REVIEW.md`, left as a documented advisory finding per task instructions. |

No `TBD`/`FIXME`/`XXX` debt markers found in any file modified by this phase. No blocking anti-patterns found.

### Human Verification Required

None. All must-haves are verified via code inspection, live-database queries, and passing automated tests; no visual, real-time, or external-service behavior in this phase requires human judgment.

### Gaps Summary

No gaps. Both plans (27-01 data-layer foundation, 27-02 hard-gate wiring) fully deliver the phase goal: `consentGiven` is now a genuinely enforced opt-in flag (defaulting false for new rows, backfilled true for pre-existing rows), and both client entry points (`/start`, free-form chat) hard-gate on it identically, with no AI reply or persisted state possible before explicit acceptance. The one critical issue found in code review (CR-01 — reliance on migration-timing for the safe default) was fixed post-review in commit `4a3493e`, verified present in the current `queries.ts`. The two remaining warnings (WR-01 consent-timestamp overwrite, WR-02 missing owner-exclusion guard) are documented, low-severity, accepted advisory findings that do not block the phase goal — they are recorded here for visibility but are not gaps requiring closure in this phase.

---

_Verified: 2026-07-28T12:04:10Z_
_Verifier: Claude (gsd-verifier)_

---
phase: 27-client-consent-registration
plan: 1
subsystem: database
tags: [drizzle, postgres, neon, migration, gdpr, consent]

# Dependency graph
requires:
  - phase: 26-confirmation-approval-policy
    provides: Ναι/Όχι confirmation-keyboard pattern precedent, CONFIRM_LABELS convention
provides:
  - clientBusinessRelationships.consentGiven column repurposed to explicit-opt-in-required (default false)
  - migrations/0013_client_consent_gate.sql applied to the live Neon DB and best-effort to local test DB
  - updateClientConsentGiven(businessId, senderPhone, consentGiven) query function for the consent:yes/no callback handler
  - insertClientBusinessRelationship no longer hardcodes consentGiven:true — relies purely on DB default
affects: [27-02-client-consent-registration (hard gate wiring), consent, database, telegram-webhooks]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DB column default flip via a numbered migration applied programmatically with Node.js + pg Client (not psql, unavailable in this environment)"
    - "Defensive backfill scoped with IS DISTINCT FROM to make a grandfathering guarantee explicit and idempotent, even when logically a no-op"

key-files:
  created:
    - migrations/0013_client_consent_gate.sql
  modified:
    - src/database/schema.ts
    - src/database/queries.ts

key-decisions:
  - "Repurposed the existing consentGiven column (default flip true->false) rather than adding a new column, per research ARCHITECTURE.md §(b) and 27-CONTEXT.md D-01"
  - "insertClientBusinessRelationship's onConflictDoUpdate SET clause left untouched — continues to exclude consentGiven so a racing/repeat first-contact upsert can never reset an already-accepted consent back to false (PITFALLS.md Pitfall 3, already mitigated, not re-derived)"
  - "Migration applied via Node.js + pg Client, not psql — psql is not on PATH in this environment; the migration SQL itself is psql-compatible if a future environment has it available"

patterns-established:
  - "updateClientConsentGiven mirrors the existing setCancellationCutoff/setBookingMode scoped-UPDATE query pattern — no dedicated unit test, covered by downstream integration tests (matches codebase convention)"

requirements-completed: [COMP-02]

coverage:
  - id: D1
    description: "clientBusinessRelationships.consentGiven schema default flipped true->false; migrations/0013_client_consent_gate.sql created with backfill + default-flip statements"
    requirement: "COMP-02"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D2
    description: "migrations/0013_client_consent_gate.sql applied to the live Neon DB — column_default for client_business_relationships.consent_given confirmed false via read-only verification query"
    requirement: "COMP-02"
    verification:
      - kind: integration
        ref: "node -e verification query against live Neon DB (information_schema.columns), Task 3 Step C — returned [{\"column_default\":\"false\"}]"
        status: pass
    human_judgment: false
  - id: D3
    description: "insertClientBusinessRelationship no longer hardcodes consentGiven:true; onConflictDoUpdate SET clause unchanged; new updateClientConsentGiven(businessId, senderPhone, consentGiven) exported for Plan 27-02"
    requirement: "COMP-02"
    verification:
      - kind: unit
        ref: "tests/consent.test.ts, tests/consent-schema.test.ts (all 3 tests)"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-28
status: complete
---

# Phase 27 Plan 1: Client Consent Data-Layer Foundation Summary

**Repurposed `client_business_relationships.consent_given` from implied-consent-by-default (true) to explicit-opt-in-required (false), shipped migration 0013 to the live Neon DB, and added `updateClientConsentGiven` for Plan 27-02's consent gate.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-28T10:55:10Z
- **Completed:** 2026-07-28T11:03:00Z
- **Tasks:** 3 completed
- **Files modified:** 3 (2 edited, 1 created)

## Accomplishments
- `clientBusinessRelationships.consentGiven` schema default flipped from `true` to `false` (COMP-02, D-01/D-04) — new rows now genuinely start unconsented
- `migrations/0013_client_consent_gate.sql` created and applied to the live Neon DB — verified `column_default` is now `false`
- `insertClientBusinessRelationship` no longer hardcodes `consentGiven: true`; new `updateClientConsentGiven(businessId, senderPhone, consentGiven)` exported as the write path Plan 27-02's `consent:yes`/`consent:no` callback handler will call

## Task Commits

Each task was committed atomically:

1. **Task 1: Flip consentGiven schema default + create migration 0013** - `711898e` (feat)
2. **Task 2: Query layer — updateClientConsentGiven + insertClientBusinessRelationship semantics** - `4adeb50` (feat)
3. **Task 3: [BLOCKING] Apply migration 0013 to local test DB and the live Neon DB** - no new commit (live-DB-only operation; migration file already committed in Task 1)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/database/schema.ts` - `clientBusinessRelationships.consentGiven` default flipped `true`→`false`, comment updated with Phase 27/D-01/D-04 rationale
- `migrations/0013_client_consent_gate.sql` - new migration: defensive backfill (`IS DISTINCT FROM true`) + `DROP DEFAULT`/`SET DEFAULT false`
- `src/database/queries.ts` - `insertClientBusinessRelationship` no longer sets `consentGiven: true` explicitly; new exported `updateClientConsentGiven`

## Decisions Made
- Repurposed the existing `consentGiven` column rather than adding a new one, per research ARCHITECTURE.md §(b) and 27-CONTEXT.md D-01
- Left the `onConflictDoUpdate` SET clause in `insertClientBusinessRelationship` completely untouched — it already excludes `consentGiven`, which is the exact mitigation PITFALLS.md Pitfall 3 requires
- Applied migration 0013 via Node.js + `pg` `Client` (not `psql`) since `psql` is not on PATH in this environment; the SQL itself is `psql`-compatible for any future environment that does have it

## Deviations from Plan

None — plan executed exactly as written.

**Note on acceptance-criteria grep scoping:** Task 1's acceptance criteria specified `grep -c ".default(false)" src/database/schema.ts` should return exactly 1. In practice this file already contains 8 pre-existing `.default(false)` columns unrelated to `consentGiven` (e.g. `isClosed`, `cancellationCutoffEnabled`, `onboardingCompleted`), so the literal whole-file grep count is 8, not 1. The substantive intent — `consentGiven` now reads `.default(false)` exactly once, inside the `clientBusinessRelationships` block, and no `.default(true)` line remains for it — was verified directly (`grep -n "consentGiven" src/database/schema.ts` → single line, `.default(false)`). This is a plan-authoring scoping imprecision, not a code deviation; no fix was needed to the codebase.

## Issues Encountered
- Step A (local test DB, best-effort per plan) failed with a `pg` SASL auth error (`client password must be a string`) — a pre-existing local Postgres auth/env-var quirk unrelated to this plan's changes. Per the task's explicit instruction, this is non-blocking and execution continued to Step B (live Neon DB), which succeeded.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Live Neon DB's `client_business_relationships.consent_given` column now defaults to `false` — Plan 27-02's hard consent gate will actually fire for new clients instead of every first-contact row silently reading back as already-consented
- `updateClientConsentGiven(businessId, senderPhone, consentGiven)` is available with the exact signature Plan 27-02 needs to wire into its `consent:yes`/`consent:no` callback handler
- No blockers for Plan 27-02

---
*Phase: 27-client-consent-registration*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: src/database/schema.ts
- FOUND: migrations/0013_client_consent_gate.sql
- FOUND: src/database/queries.ts
- FOUND: .planning/phases/27-client-consent-registration/27-01-SUMMARY.md
- FOUND: 711898e
- FOUND: 4adeb50
- FOUND: e0cb446

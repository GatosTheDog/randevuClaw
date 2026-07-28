-- Migration: 0013_client_consent_gate.sql
-- Purpose: Repurpose client_business_relationships.consent_given from an
--   implied-consent-by-default flag to an explicit-opt-in-required flag —
--   Phase 27 (COMP-01/COMP-02, D-01/D-04). New rows now start unconsented
--   (consent_given = false) until the client accepts the hard Ναι/Όχι gate
--   (Plan 27-02); pre-existing rows are grandfathered to true so no real
--   client already using the bot is silently blocked.
--
-- How to apply:
--   This migration is applied programmatically via a Node.js `pg` client
--   (Task 3 of 27-01-PLAN.md) — `psql` is not available on PATH in this
--   environment. If a future execution environment has `psql` on PATH,
--   `psql $DATABASE_URL -f migrations/0013_client_consent_gate.sql` runs the
--   exact same idempotent SQL.
--
-- Idempotency: the backfill UPDATE is scoped to non-true rows only (safe to
--   re-run — it can never touch a row later set false by the app-layer
--   gate), and DROP DEFAULT / SET DEFAULT are naturally idempotent ALTERs.
--   Safe to run multiple times or retry after a partial failure.

-- ---------------------------------------------------------------------------
-- Section 1: Defensive backfill (D-04) — grandfather pre-existing rows to true
-- Logically a no-op today: every pre-migration row is already `true`,
-- guaranteed by the prior NOT NULL DEFAULT true. Included for defense-in-
-- depth and to make D-04's grandfathering guarantee explicit and re-runnable.
-- ---------------------------------------------------------------------------

UPDATE client_business_relationships
  SET consent_given = true
  WHERE consent_given IS DISTINCT FROM true;

-- ---------------------------------------------------------------------------
-- Section 2: Flip the column default for new rows (D-01)
-- No GRANT statements needed — migrations/0003_phase4_per_bot.sql already
-- ran GRANT SELECT, INSERT, UPDATE, DELETE ON client_business_relationships
-- TO randevuclaw_app (table-wide, not column-scoped), covering consent_given.
-- ---------------------------------------------------------------------------

ALTER TABLE client_business_relationships ALTER COLUMN consent_given DROP DEFAULT;
ALTER TABLE client_business_relationships ALTER COLUMN consent_given SET DEFAULT false;

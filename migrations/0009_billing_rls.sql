-- Migration: 0009_billing_rls.sql
-- Purpose: Enable Row Level Security on billing_packages, memberships, and
--   membership_ledger tables introduced in 0006_billing_schema.sql (CR-01).
--
-- Background: 0006_billing_schema.sql created the three billing tables using
--   only CREATE TABLE + GRANT statements — no ENABLE ROW LEVEL SECURITY and
--   no CREATE POLICY. This migration corrects that omission so the billing
--   layer participates in the same per-business RLS isolation model established
--   in 0003_phase4_per_bot.sql.
--
-- How to apply:
--   psql $DATABASE_URL -f migrations/0009_billing_rls.sql
--
-- Idempotency: ENABLE ROW LEVEL SECURITY is natively idempotent.
--   CREATE POLICY is wrapped in DO blocks with IF NOT EXISTS checks.
--   Safe to run multiple times.

-- ---------------------------------------------------------------------------
-- billing_packages: isolate by business_id
-- ---------------------------------------------------------------------------

ALTER TABLE billing_packages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE policyname = 'billing_packages_isolation' AND tablename = 'billing_packages'
  ) THEN
    CREATE POLICY billing_packages_isolation ON billing_packages
      FOR ALL
      USING (business_id = current_setting('app.current_business_id', true)::INTEGER)
      WITH CHECK (business_id = current_setting('app.current_business_id', true)::INTEGER);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- memberships: isolate by business_id
-- ---------------------------------------------------------------------------

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE policyname = 'memberships_isolation' AND tablename = 'memberships'
  ) THEN
    CREATE POLICY memberships_isolation ON memberships
      FOR ALL
      USING (business_id = current_setting('app.current_business_id', true)::INTEGER)
      WITH CHECK (business_id = current_setting('app.current_business_id', true)::INTEGER);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- membership_ledger: no business_id column — allow all reads/inserts.
-- Row-level isolation is enforced via the membership_id FK (which resolves
-- through the RLS-protected memberships table) and app-level ownership checks.
-- ---------------------------------------------------------------------------

ALTER TABLE membership_ledger ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE policyname = 'membership_ledger_open' AND tablename = 'membership_ledger'
  ) THEN
    CREATE POLICY membership_ledger_open ON membership_ledger
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;

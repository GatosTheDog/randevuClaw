-- Migration: 0004_phase5_onboarding.sql
-- Purpose: Add onboarding_sessions table for Phase 05 (D-04/D-05) — DB-backed
--   state machine driving owner self-serve onboarding via platform bot.
--
-- How to apply:
--   psql $DATABASE_URL -f migrations/0004_phase5_onboarding.sql
--
-- Idempotency: CREATE TABLE is wrapped in a DO block with IF NOT EXISTS check.
--   CREATE UNIQUE INDEX uses IF NOT EXISTS. GRANT is natively idempotent.

-- ---------------------------------------------------------------------------
-- Section 1: onboarding_sessions table (D-04/D-05)
-- Anchors the platform bot state machine. business_id is NOT NULL because the
-- businesses row is inserted with a placeholder name/slug immediately on bot
-- token validation — before the guided setup begins.
-- No RLS on this table: the platform bot uses the admin db connection
-- (no withBusinessContext) for all cross-tenant onboarding operations.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'onboarding_sessions') THEN
    CREATE TABLE onboarding_sessions (
      id              SERIAL PRIMARY KEY,
      business_id     INTEGER NOT NULL REFERENCES businesses(id),
      current_step    TEXT NOT NULL,
      -- Partial service state during svc_name/svc_price steps; NULL when idle.
      collected_data  TEXT,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
    );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Section 2: Unique index — one active session per business (D-05)
-- Used with onConflictDoUpdate on re-registration (owner re-submits bot token).
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS unique_onboarding_session_per_business
  ON onboarding_sessions (business_id);

-- ---------------------------------------------------------------------------
-- Section 3: Grant permissions to randevuclaw_app role
-- Platform bot uses admin db for onboarding, but app role still needs CRUD
-- if we ever expose session reads via the per-bot context.
-- No RLS enabled — intentional (see Section 1 comment above).
-- GRANT is natively idempotent.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON onboarding_sessions TO randevuclaw_app;

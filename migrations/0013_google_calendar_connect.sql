-- Migration: 0013_google_calendar_connect.sql
-- Purpose: Phase 25.1 — in-bot Google Calendar connect:
--   (1) businesses.google_calendar_nudge_sent (D-06: persisted one-time nudge flag)
--   (2) google_oauth_states (D-04: DB-backed, single-use OAuth state store)
--   (3) RLS on google_oauth_states (admin pool only)
--
-- How to apply:
--   npm run db:apply-sql -- migrations/0013_google_calendar_connect.sql
--
-- Idempotency: the column is added inside a guarded DO block, the table uses
--   CREATE TABLE IF NOT EXISTS, ENABLE ROW LEVEL SECURITY is natively idempotent.
--   Safe to run repeatedly.

-- ---------------------------------------------------------------------------
-- Section 1: businesses.google_calendar_nudge_sent (D-06)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'businesses'
      AND column_name = 'google_calendar_nudge_sent'
  ) THEN
    ALTER TABLE businesses
      ADD COLUMN google_calendar_nudge_sent BOOLEAN NOT NULL DEFAULT false;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Section 2: google_oauth_states (D-04)
-- Stores only the SHA-256 hash of the OAuth state. No extra index: the table is
-- tiny and short-lived.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS google_oauth_states (
  state_hash  TEXT PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  expires_at  TIMESTAMP NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Section 3: Row Level Security
-- Intentionally NO policy and NO GRANT to randevuclaw_app: only the admin pool
-- (table owner) can read or write this table, so the application role can never
-- read or forge OAuth states.
-- ---------------------------------------------------------------------------

ALTER TABLE google_oauth_states ENABLE ROW LEVEL SECURITY;

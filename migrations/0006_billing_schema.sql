-- Migration: 0006_billing_schema.sql
-- Purpose: Add billing_packages, memberships, membership_ledger tables and
--   client_name column to client_business_relationships (Phase 7 D-01..D-11).
--
-- How to apply:
--   psql $DATABASE_URL -f migrations/0006_billing_schema.sql
--
-- Idempotency: CREATE TABLE is wrapped in a DO block with IF NOT EXISTS check.
--   CREATE UNIQUE INDEX uses IF NOT EXISTS. ADD COLUMN uses IF NOT EXISTS.
--   GRANT is natively idempotent. Safe to run multiple times.

-- ---------------------------------------------------------------------------
-- Section 1: Add client_name column to client_business_relationships (D-04)
-- Nullable — table is non-empty; captured from Telegram from.first_name on
-- each incoming message and upserted to reflect the latest display name.
-- Used in payment flow UI to show client display names in keyboard buttons.
-- ---------------------------------------------------------------------------

ALTER TABLE client_business_relationships
  ADD COLUMN IF NOT EXISTS client_name TEXT;

-- ---------------------------------------------------------------------------
-- Section 2: billing_packages table (D-01)
-- Owner creates packages via Gemini NLU (name, price, valid_days, session_count).
-- Soft-delete via is_active flag — packages are never hard-deleted (D-03).
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'billing_packages') THEN
    CREATE TABLE billing_packages (
      id            SERIAL PRIMARY KEY,
      business_id   INTEGER NOT NULL REFERENCES businesses(id),
      name          TEXT NOT NULL,
      price_cents   INTEGER NOT NULL,         -- price in euro cents (e.g. 8000 = €80.00)
      valid_days    INTEGER NOT NULL,         -- validity period in days
      session_count INTEGER,                  -- NULL = unlimited sessions (D-02)
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,  -- soft-delete flag (D-03)
      created_at    TIMESTAMP NOT NULL DEFAULT NOW()
    );
  END IF;
END
$$;

-- Partial index: WHERE is_active = true allows a new active package to be
-- created with the same name as a deactivated package.
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_package_name
  ON billing_packages (business_id, name)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Section 3: memberships table (D-02, D-10)
-- Created when owner records an external payment. Rolling expiry window.
-- One active membership per (business_id, client_phone) enforced at DB level.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'memberships') THEN
    CREATE TABLE memberships (
      id                 SERIAL PRIMARY KEY,
      business_id        INTEGER NOT NULL REFERENCES businesses(id),
      client_phone       TEXT NOT NULL,         -- Telegram from.id stringified
      package_id         INTEGER NOT NULL REFERENCES billing_packages(id),
      purchase_date      TEXT NOT NULL,         -- "YYYY-MM-DD" in Athens local time
      expires_at         TIMESTAMP NOT NULL,    -- TIMESTAMP WITH TIME ZONE (DST-safe)
      sessions_remaining INTEGER,               -- NULL = unlimited (D-02)
      is_active          BOOLEAN NOT NULL DEFAULT TRUE,
      created_at         TIMESTAMP NOT NULL DEFAULT NOW()
    );
  END IF;
END
$$;

-- D-10: one active membership per (business_id, client_phone) pair.
-- Partial index — expired/deactivated memberships do not block a new one.
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_membership
  ON memberships (business_id, client_phone)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Section 4: membership_ledger table (D-11 immutable append-only)
-- idempotency_key UNIQUE constraint prevents duplicate INSERT on webhook replay.
-- No UPDATE ever issued on this table — append-only ledger pattern.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'membership_ledger') THEN
    CREATE TABLE membership_ledger (
      id                SERIAL PRIMARY KEY,
      membership_id     INTEGER NOT NULL REFERENCES memberships(id),
      operation_type    TEXT NOT NULL,         -- 'payment_recorded' | 'session_deducted' | 'credit_restored'
      sessions_deducted INTEGER NOT NULL DEFAULT 0,  -- positive for deductions, negative for credits
      booking_id        INTEGER REFERENCES bookings(id),  -- nullable (Phase 8+)
      reason            TEXT,                  -- nullable human-readable audit note
      idempotency_key   TEXT NOT NULL UNIQUE,  -- D-11: prevents replay duplicates
      created_at        TIMESTAMP NOT NULL DEFAULT NOW()
    );
  END IF;
END
$$;

-- Explicit index to complement the inline UNIQUE for query performance.
CREATE UNIQUE INDEX IF NOT EXISTS unique_ledger_idempotency
  ON membership_ledger (idempotency_key);

-- ---------------------------------------------------------------------------
-- Section 5: Grant permissions to randevuclaw_app role
-- membership_ledger grants SELECT + INSERT only (no UPDATE — append-only).
-- GRANT is natively idempotent.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON billing_packages TO randevuclaw_app;
GRANT SELECT, INSERT, UPDATE ON memberships TO randevuclaw_app;
GRANT SELECT, INSERT ON membership_ledger TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE billing_packages_id_seq TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE memberships_id_seq TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE membership_ledger_id_seq TO randevuclaw_app;

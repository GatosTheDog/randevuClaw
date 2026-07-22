-- Migration: 0010_session_catalog_schema.sql
-- Purpose: Phase 10 — Add session_catalog, session_instances, slotless_requests
--   tables; add 7 business config columns (bookingMode, cancellationCutoff*,
--   slotlessRequestsEnabled, lastSessionThreshold*, allowMultiBooking); add
--   nullable session_instance_id FK column on bookings.
--
-- How to apply (manual / recovery path):
--   psql $DATABASE_URL -f migrations/0010_session_catalog_schema.sql
--
-- NOTE: drizzle-kit push applies from schema.ts directly. This file is an
--   idempotent documentation and recovery reference artifact.
--
-- Idempotency: All ADD COLUMN uses IF NOT EXISTS. CREATE TABLE wrapped in
--   DO $$ IF NOT EXISTS blocks. CREATE UNIQUE INDEX uses IF NOT EXISTS.
--   GRANT is natively idempotent. Safe to run multiple times.
--
-- IMPORTANT (Section 2 ordering): bookings.session_instance_id references
--   session_instances, which is created in Section 4. If applying manually
--   via psql, run this file as a single transaction (default psql behavior)
--   or apply Sections 3–4 first, then Section 2. drizzle-kit push handles
--   ordering automatically.

-- ---------------------------------------------------------------------------
-- Section 1: businesses table — 7 new config columns (all NOT NULL + DEFAULT)
-- NOT NULL with DEFAULT is safe on a non-empty table — Postgres backfills the
-- default for existing rows during the ALTER TABLE without a separate UPDATE.
-- ---------------------------------------------------------------------------

-- Phase 10 (CLSS-01): booking mode — 'open_slots' (v1.2 behavior, default)
-- or 'fixed_sessions' (class-schedule mode introduced in Phase 10).
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS booking_mode TEXT NOT NULL DEFAULT 'open_slots';

-- Phase 12 (CANC-01): cancellation cutoff window toggle and threshold.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS cancellation_cutoff_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS cancellation_cutoff_hours INTEGER NOT NULL DEFAULT 8;

-- Phase 13 (SLOT-01): slotless booking request feature toggle.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS slotless_requests_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Phase 14 (RENW-01): last-session renewal nudge toggle and threshold count.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS last_session_threshold_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS last_session_threshold_count INTEGER NOT NULL DEFAULT 1;

-- Phase 11 (SBOK-04): multi-session booking toggle.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS allow_multi_booking BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- Section 2: bookings table — nullable session_instance_id FK
-- Nullable for backward compatibility: open_slots mode bookings (v1.2 and
-- earlier) have NULL; fixed_sessions mode bookings (v1.3+) reference a row
-- in session_instances. Forward reference: session_instances is created in
-- Section 4 below. When applying manually, ensure Section 4 runs first in
-- the same transaction (or run sections 3–4 before this section).
-- ---------------------------------------------------------------------------

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS session_instance_id INTEGER REFERENCES session_instances(id);

-- ---------------------------------------------------------------------------
-- Section 3: session_catalog table (Phase 10, CLSS-01, CLSS-02)
-- Owner-defined recurring session templates. One active catalog entry per
-- (business, service) at DB level (partial unique index below).
-- capacity > 0 enforced via CHECK constraint.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'session_catalog') THEN
    CREATE TABLE session_catalog (
      id            SERIAL PRIMARY KEY,
      business_id   INTEGER NOT NULL REFERENCES businesses(id),
      service_id    INTEGER NOT NULL REFERENCES services(id),
      rrule_string  TEXT NOT NULL,                         -- RFC 5545 recurrence rule, e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"
      start_time    TEXT NOT NULL,                         -- wall-clock "HH:MM" Europe/Athens local (24h)
      capacity      INTEGER NOT NULL CHECK (capacity > 0), -- hard cap; sessions cannot overfill
      is_active     BOOLEAN NOT NULL DEFAULT TRUE,         -- soft-delete; false = deactivated entry
      created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT booking_mode_capacity_positive CHECK (capacity > 0)
    );
  END IF;
END
$$;

-- Partial unique: one active catalog entry per (business, service). Multiple
-- inactive entries with the same (business, service) are allowed for audit.
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_catalog_per_business_service
  ON session_catalog (business_id, service_id)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Section 4: session_instances table (Phase 10, CLSS-02, CLSS-05)
-- Concrete occurrences expanded from a session_catalog entry (~90 days forward).
-- idempotency_key UNIQUE guards against duplicate creation on rrule replay.
-- booked_count is denormalized for O(1) list_sessions queries; updated
-- atomically on booking insert/cancel.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'session_instances') THEN
    CREATE TABLE session_instances (
      id               SERIAL PRIMARY KEY,
      catalog_id       INTEGER NOT NULL REFERENCES session_catalog(id),
      session_date     TEXT NOT NULL,                     -- ISO "YYYY-MM-DD" Europe/Athens wall-clock
      session_time     TEXT NOT NULL,                     -- "HH:MM" Europe/Athens wall-clock
      booked_count     INTEGER NOT NULL DEFAULT 0,        -- denormalized; updated atomically on booking
      is_cancelled     BOOLEAN NOT NULL DEFAULT FALSE,    -- soft-delete: owner cancelled this instance
      idempotency_key  TEXT NOT NULL UNIQUE,              -- "catalog:{catalogId}:{sessionDate}:{sessionTime}"
      created_at       TIMESTAMP NOT NULL DEFAULT NOW()
    );
  END IF;
END
$$;

-- Complementary unique constraint to idempotency_key; one instance per
-- (catalog, date, time) regardless of cancellation state.
CREATE UNIQUE INDEX IF NOT EXISTS unique_session_instance
  ON session_instances (catalog_id, session_date, session_time);

-- ---------------------------------------------------------------------------
-- Section 5: slotless_requests table (Phase 13, SLOT-01 foundation)
-- Clients can request a booking with no open slot when
-- businesses.slotless_requests_enabled = TRUE. Owner approves/rejects via chat.
-- status CHECK constraint enforces valid values at DB level (defense in depth
-- alongside Zod app-layer validation in Phase 13).
-- booking_id nullable FK: set when owner approves and booking is created.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'slotless_requests') THEN
    CREATE TABLE slotless_requests (
      id                      SERIAL PRIMARY KEY,
      business_id             INTEGER NOT NULL REFERENCES businesses(id),
      client_phone            TEXT NOT NULL,               -- Telegram from.id stringified
      requested_session_date  TEXT NOT NULL,               -- ISO "YYYY-MM-DD" Athens local
      requested_session_time  TEXT NOT NULL,               -- "HH:MM" Athens local
      service_id              INTEGER NOT NULL REFERENCES services(id),
      status                  TEXT NOT NULL DEFAULT 'pending'
                              CONSTRAINT slotless_status_valid CHECK (status IN ('pending', 'approved', 'rejected')),
      booking_id              INTEGER REFERENCES bookings(id),  -- nullable; set on approval
      idempotency_key         TEXT NOT NULL UNIQUE,         -- "client:{clientPhone}:service:{serviceId}:{date}:{time}"
      created_at              TIMESTAMP NOT NULL DEFAULT NOW()
    );
  END IF;
END
$$;

-- Partial unique: one pending request per (business, client, service, date).
-- Approved/rejected requests do not block new requests for the same slot.
CREATE UNIQUE INDEX IF NOT EXISTS unique_pending_slotless_per_client_service
  ON slotless_requests (business_id, client_phone, service_id, requested_session_date)
  WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Section 6: Grant permissions to randevuclaw_app role
-- SELECT + INSERT + UPDATE on all 3 new tables.
-- GRANT is natively idempotent.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON session_catalog TO randevuclaw_app;
GRANT SELECT, INSERT, UPDATE ON session_instances TO randevuclaw_app;
GRANT SELECT, INSERT, UPDATE ON slotless_requests TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE session_catalog_id_seq TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE session_instances_id_seq TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE slotless_requests_id_seq TO randevuclaw_app;

-- Column-level UPDATE grants for new businesses columns (row-level SELECT
-- already covered by existing SELECT grant on businesses table).
GRANT UPDATE (booking_mode, cancellation_cutoff_enabled, cancellation_cutoff_hours,
              slotless_requests_enabled, last_session_threshold_enabled,
              last_session_threshold_count, allow_multi_booking)
  ON businesses TO randevuclaw_app;

-- Column-level UPDATE grant for new bookings column.
GRANT UPDATE (session_instance_id) ON bookings TO randevuclaw_app;

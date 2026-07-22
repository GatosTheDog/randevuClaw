-- Migration: 0011_session_cancellation_notifications.sql
-- Purpose: Phase 10 — Add session_cancellation_notifications dedup table —
--   prevents duplicate cancellation notification broadcasts on poller re-run (CLSS-03).
--
-- How to apply (manual / recovery path):
--   psql $DATABASE_URL -f migrations/0011_session_cancellation_notifications.sql
--
-- NOTE: drizzle-kit push applies from schema.ts directly. This file is an
--   idempotent documentation and recovery reference artifact.
--
-- Idempotency: CREATE TABLE wrapped in DO $$ IF NOT EXISTS block.
--   CREATE UNIQUE INDEX uses IF NOT EXISTS. GRANT is natively idempotent.
--   Safe to run multiple times.

-- ---------------------------------------------------------------------------
-- Section 1: session_cancellation_notifications table (Phase 10, CLSS-03)
-- Dedup table: one row per cancelled session instance (not per client).
-- The broadcast covers all clients in one batch; inserting this row marks the
-- batch as "processed" and prevents re-sends on subsequent poller runs.
-- Append-only: no UPDATE or DELETE grants — this table is write-once.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'session_cancellation_notifications') THEN
    CREATE TABLE session_cancellation_notifications (
      id                  SERIAL PRIMARY KEY,
      session_instance_id INTEGER NOT NULL REFERENCES session_instances(id),
      sent_at             TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at          TIMESTAMP NOT NULL DEFAULT NOW()
    );
  END IF;
END
$$;

-- CLSS-03: UNIQUE on session_instance_id enforces at-most-one notification
-- batch per cancelled instance at DB level. onConflictDoNothing on the Drizzle
-- insert provides the application-layer guard.
CREATE UNIQUE INDEX IF NOT EXISTS unique_session_cancellation_notification
  ON session_cancellation_notifications (session_instance_id);

-- ---------------------------------------------------------------------------
-- Section 2: Grant permissions to randevuclaw_app role
-- SELECT + INSERT only (no UPDATE, no DELETE — append-only dedup table).
-- GRANT is natively idempotent.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON session_cancellation_notifications TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE session_cancellation_notifications_id_seq TO randevuclaw_app;

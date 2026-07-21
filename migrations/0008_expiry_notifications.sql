-- Migration: 0008_expiry_notifications.sql
-- Purpose: Add membership_expiry_notifications table — Phase 9 NOTF-03 dedup.
--   Tracks which (membership, notification_type, expiry_date) triples have
--   already fired so the expiry sweep never double-sends a 7-day warning.
--   UNIQUE INDEX enforces the dedup constraint at DB level atomically alongside
--   the onConflictDoNothing() call in the sweep (Plan 02).
--
-- How to apply:
--   psql $DATABASE_URL -f migrations/0008_expiry_notifications.sql
--
-- Idempotency: CREATE TABLE IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS
--   — safe to run multiple times.

-- ---------------------------------------------------------------------------
-- Section 1: Create membership_expiry_notifications table
-- membership_id FK anchors every dedup row to a specific membership.
-- notification_type TEXT stores '7_day_client' or '7_day_owner' (D-05) so
--   client and owner notifications dedup independently.
-- expiry_date TEXT stores YYYY-MM-DD (Athens local date via isoDateInAthens())
--   matching the memberships.purchase_date TEXT convention.
-- sent_at / created_at default to NOW() — audit trail for when the row was
--   inserted (i.e. when the notification was sent).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS membership_expiry_notifications (
  id SERIAL PRIMARY KEY,
  membership_id INTEGER NOT NULL REFERENCES memberships(id),
  notification_type TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Section 2: UNIQUE INDEX — NOTF-03 dedup constraint
-- Covers all three dimensions: which membership, which recipient type, and
-- which expiry event (date). No partial WHERE — dedup is unconditional.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS unique_membership_expiry_notification
  ON membership_expiry_notifications (membership_id, notification_type, expiry_date);

-- ---------------------------------------------------------------------------
-- Section 3: Grant DML permissions to randevuclaw_app role
-- SELECT + INSERT only — the sweep inserts rows; no UPDATE or DELETE needed
-- (dedup rows are immutable once written). GRANT is natively idempotent.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON membership_expiry_notifications TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE membership_expiry_notifications_id_seq TO randevuclaw_app;

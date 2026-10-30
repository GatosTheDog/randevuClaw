-- Migration: 0015_session_bookings_slot_index.sql
-- Purpose: debug session approve-reject-action-not-recognized.
--
-- unique_active_slot_per_business (business_id, calendar_date, calendar_time)
-- was designed for open_slots mode, where exactly ONE client may hold a given
-- start time. A fixed-session CLASS legitimately holds many clients at the same
-- date/time (capacity N), so the index silently made every class bookable by a
-- single active client only: the 2nd client's INSERT was swallowed by
-- ON CONFLICT DO NOTHING, bookSessionInstance reported success with no
-- bookingId, and the owner received an approval keyboard with
-- `sbk:approve:undefined` (-> "Η ενέργεια δεν αναγνωρίστηκε.").
--
-- Fix, schema side:
--   1. Scope unique_active_slot_per_business to NON-session bookings
--      (session_instance_id IS NULL). Open-slot semantics are unchanged.
--   2. Add unique_active_client_per_session_instance so one client still cannot
--      hold two active seats in the same class instance (previously prevented
--      only incidentally by index 1).
--
-- How to apply:
--   npm run db:apply-sql -- migrations/0015_session_bookings_slot_index.sql
--
-- Deploy order: apply BEFORE (or together with) the code change. Until it is
--   applied, the code now fails closed (a 2nd client booking a class gets a
--   "not available" reply instead of a broken approval button) but classes
--   still cannot hold more than one active booking.
--
-- Safety: the old index was strictly stricter than both new ones, so no existing
--   row can violate the new unique index. Idempotent: the slot index is only
--   rebuilt when its definition does not yet carry the session_instance_id
--   predicate; CREATE ... IF NOT EXISTS for the new index. Safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'bookings'
      AND indexname = 'unique_active_slot_per_business'
      AND indexdef LIKE '%session_instance_id IS NULL%'
  ) THEN
    DROP INDEX IF EXISTS unique_active_slot_per_business;
    CREATE UNIQUE INDEX unique_active_slot_per_business
      ON bookings (business_id, calendar_date, calendar_time)
      WHERE booking_status IN ('pending_owner_approval', 'confirmed')
        AND session_instance_id IS NULL;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS unique_active_client_per_session_instance
  ON bookings (session_instance_id, client_phone)
  WHERE booking_status IN ('pending_owner_approval', 'confirmed')
    AND session_instance_id IS NOT NULL;

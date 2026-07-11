-- Migration: 0003_phase4_per_bot.sql
-- Purpose: Per-bot multi-tenant RLS infrastructure for Phase 04 (D-10, D-11, D-12).
--
-- What this file does NOT do:
--   Column additions (bot_token, webhook_id, webhook_secret) are handled by
--   `drizzle-kit push` from schema.ts — drizzle-kit cannot model RLS.
--
-- How to apply:
--   psql $DATABASE_URL -f migrations/0003_phase4_per_bot.sql
--
-- Idempotency: CREATE ROLE and CREATE POLICY are wrapped in DO blocks.
--   GRANT, ENABLE RLS, and ALTER ROLE are natively idempotent in PostgreSQL
--   (re-running them produces no error).

-- ---------------------------------------------------------------------------
-- Section 1: Create non-superuser app role (D-11)
-- The randevuclaw_app role is used by the app server for all conversation-handling
-- DB operations. RLS policies (Section 3) enforce per-business row isolation on
-- this connection. The superuser connection (DATABASE_URL) is only used for
-- migrations and pre-auth lookups.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'randevuclaw_app') THEN
    CREATE ROLE randevuclaw_app WITH LOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE randevuclaw TO randevuclaw_app;
GRANT USAGE ON SCHEMA public TO randevuclaw_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO randevuclaw_app;
ALTER ROLE randevuclaw_app SET search_path = public;

-- ---------------------------------------------------------------------------
-- Section 2: Enable RLS on business-scoped tables (D-12)
-- Note: telegram_updates is intentionally excluded — its business_id is nullable
-- (resolution happens after the dedup-INSERT), making strict FOR ALL policies
-- incompatible with the INSERT flow in Phase 4.
-- ENABLE RLS is natively idempotent; no DO block needed.
-- ---------------------------------------------------------------------------

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_business_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Section 3: FOR ALL RLS policies using transaction-scoped context (D-10, D-12)
-- Context variable app.current_business_id is set via SET LOCAL inside each
-- withBusinessContext() transaction wrapper (queries.ts, Plan 04-03).
-- SET LOCAL is transaction-scoped: auto-cleared on commit/rollback; no leakage
-- across connection-pool reuse.
-- ---------------------------------------------------------------------------

-- messages: filter by business_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE policyname = 'messages_business_isolation' AND tablename = 'messages'
  ) THEN
    CREATE POLICY messages_business_isolation ON messages
      FOR ALL
      USING (business_id = current_setting('app.current_business_id', true)::INTEGER)
      WITH CHECK (business_id = current_setting('app.current_business_id', true)::INTEGER);
  END IF;
END
$$;

-- bookings: filter by business_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE policyname = 'bookings_business_isolation' AND tablename = 'bookings'
  ) THEN
    CREATE POLICY bookings_business_isolation ON bookings
      FOR ALL
      USING (business_id = current_setting('app.current_business_id', true)::INTEGER)
      WITH CHECK (business_id = current_setting('app.current_business_id', true)::INTEGER);
  END IF;
END
$$;

-- services: filter by business_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE policyname = 'services_business_isolation' AND tablename = 'services'
  ) THEN
    CREATE POLICY services_business_isolation ON services
      FOR ALL
      USING (business_id = current_setting('app.current_business_id', true)::INTEGER)
      WITH CHECK (business_id = current_setting('app.current_business_id', true)::INTEGER);
  END IF;
END
$$;

-- business_hours: filter by business_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE policyname = 'business_hours_business_isolation' AND tablename = 'business_hours'
  ) THEN
    CREATE POLICY business_hours_business_isolation ON business_hours
      FOR ALL
      USING (business_id = current_setting('app.current_business_id', true)::INTEGER)
      WITH CHECK (business_id = current_setting('app.current_business_id', true)::INTEGER);
  END IF;
END
$$;

-- client_business_relationships: filter by business_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE policyname = 'cbr_business_isolation' AND tablename = 'client_business_relationships'
  ) THEN
    CREATE POLICY cbr_business_isolation ON client_business_relationships
      FOR ALL
      USING (business_id = current_setting('app.current_business_id', true)::INTEGER)
      WITH CHECK (business_id = current_setting('app.current_business_id', true)::INTEGER);
  END IF;
END
$$;

-- conversation_turns: filter by business_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE policyname = 'conversation_turns_business_isolation' AND tablename = 'conversation_turns'
  ) THEN
    CREATE POLICY conversation_turns_business_isolation ON conversation_turns
      FOR ALL
      USING (business_id = current_setting('app.current_business_id', true)::INTEGER)
      WITH CHECK (business_id = current_setting('app.current_business_id', true)::INTEGER);
  END IF;
END
$$;

-- businesses: filter by id (not business_id — this IS the businesses table)
-- Allows each Telegraf instance to read only its own row (D-12).
-- INSERT and DELETE on businesses are superuser-only in Phase 4; the
-- WITH CHECK uses id comparison so UPDATE is also scoped.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies WHERE policyname = 'businesses_isolation' AND tablename = 'businesses'
  ) THEN
    CREATE POLICY businesses_isolation ON businesses
      FOR ALL
      USING (id = current_setting('app.current_business_id', true)::INTEGER)
      WITH CHECK (id = current_setting('app.current_business_id', true)::INTEGER);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Section 4: Grant permissions to randevuclaw_app role (D-11)
-- Business-scoped tables: full CRUD (RLS further restricts to current business).
-- businesses: SELECT + UPDATE only; INSERT/DELETE remain superuser-only (Phase 4).
-- GRANT is natively idempotent; re-running produces no error.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO randevuclaw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings TO randevuclaw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON services TO randevuclaw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON business_hours TO randevuclaw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_business_relationships TO randevuclaw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_turns TO randevuclaw_app;
GRANT SELECT, UPDATE ON businesses TO randevuclaw_app;
-- telegram_updates: excluded from RLS (nullable businessId), but app role still needs CRUD.
GRANT SELECT, INSERT, UPDATE, DELETE ON telegram_updates TO randevuclaw_app;

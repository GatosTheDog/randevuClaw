-- Migration: 0007_enforcement_policy.sql
-- Purpose: Add enforcement_policy column to businesses table — Phase 8 D-07.
--   Controls how the booking engine reacts when a client has no active membership:
--   'allow' (default) = proceed; 'block' = reject; 'flag' = allow with owner alert.
--
-- How to apply:
--   psql $DATABASE_URL -f migrations/0007_enforcement_policy.sql
--
-- Idempotency: ADD COLUMN IF NOT EXISTS — safe to run multiple times.

-- ---------------------------------------------------------------------------
-- Section 1: Add enforcement_policy column to businesses (D-07)
-- NOT NULL with DEFAULT 'allow' — existing rows receive 'allow' (permit-by-default)
-- without requiring a separate UPDATE pass.
-- CHECK constraint enforces valid values at DB layer (defense in depth alongside
-- Zod app-layer validation per RESEARCH.md open question 1).
-- ---------------------------------------------------------------------------

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS enforcement_policy TEXT NOT NULL DEFAULT 'allow'
  CONSTRAINT enforcement_policy_valid CHECK (enforcement_policy IN ('allow', 'block', 'flag'));

-- ---------------------------------------------------------------------------
-- Section 2: Grant column-level UPDATE permission to randevuclaw_app role
-- Row-level SELECT is already covered by the existing SELECT grant on businesses.
-- GRANT is natively idempotent.
-- ---------------------------------------------------------------------------

GRANT UPDATE (enforcement_policy) ON businesses TO randevuclaw_app;

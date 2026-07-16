-- Migration: 0005_split_hours.sql
-- Purpose: Add optional second time range to business_hours for split-day support.
-- Idempotency: ADD COLUMN IF NOT EXISTS (Postgres 9.6+).

ALTER TABLE business_hours
  ADD COLUMN IF NOT EXISTS open_time_2 TEXT,
  ADD COLUMN IF NOT EXISTS close_time_2 TEXT;

-- Phase 8 enforcement policy column (ENFC-01)
-- Stores per-business booking enforcement policy: 'block' or 'flag'
-- NULL means 'flag' (allow booking + alert owner) — handled at application layer

ALTER TABLE businesses ADD COLUMN enforcement_policy TEXT;

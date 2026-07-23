BEGIN;
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;
UPDATE businesses b
  SET onboarding_completed = true
  WHERE EXISTS (
    SELECT 1 FROM onboarding_sessions os
    WHERE os.business_id = b.id
      AND os.current_step = 'done'
  );
COMMIT;

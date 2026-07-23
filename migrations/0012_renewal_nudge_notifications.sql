DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'renewal_nudge_notifications') THEN
    CREATE TABLE renewal_nudge_notifications (
      id SERIAL PRIMARY KEY,
      membership_id INTEGER NOT NULL REFERENCES memberships(id),
      nudge_date DATE NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS unique_renewal_nudge
  ON renewal_nudge_notifications (membership_id, nudge_date);

GRANT SELECT, INSERT ON renewal_nudge_notifications TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE renewal_nudge_notifications_id_seq TO randevuclaw_app;

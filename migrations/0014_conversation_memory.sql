-- Migration: 0014_conversation_memory.sql
-- Purpose: debug session bot-loses-conversation-memory — unified conversation
--   memory for ALL bot agents (client, owner, onboarding) plus the state needed
--   to manage the Gemini context window (token budget, turn cap, rolling
--   summary, bounded verbatim transcript for re-seeding a fresh chain).
--
-- How to apply:
--   npm run db:apply-sql -- migrations/0014_conversation_memory.sql
--
-- Deploy order: apply this BEFORE (or together with) deploying the code that
--   reads/writes it. The app degrades safely if the table is missing (memory
--   is best-effort and falls back to the previous stateless behaviour), but no
--   conversation memory is stored until the table exists.
--
-- Idempotency: CREATE TABLE / INDEX IF NOT EXISTS, policy creation guarded,
--   ENABLE ROW LEVEL SECURITY and GRANT are natively idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS conversation_memory (
  id               SERIAL PRIMARY KEY,
  business_id      INTEGER NOT NULL REFERENCES businesses(id),
  agent_role       TEXT NOT NULL,
  participant_id   TEXT NOT NULL,
  interaction_id   TEXT,
  summary          TEXT,
  context_tokens   INTEGER NOT NULL DEFAULT 0,
  chain_turns      INTEGER NOT NULL DEFAULT 0,
  recent_exchanges TEXT,
  last_active_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_conversation_memory_participant
  ON conversation_memory (business_id, agent_role, participant_id);

ALTER TABLE conversation_memory ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_policies
    WHERE policyname = 'conversation_memory_business_isolation' AND tablename = 'conversation_memory'
  ) THEN
    CREATE POLICY conversation_memory_business_isolation ON conversation_memory
      FOR ALL
      USING (business_id = current_setting('app.current_business_id', true)::INTEGER)
      WITH CHECK (business_id = current_setting('app.current_business_id', true)::INTEGER);
  END IF;
END
$$;

-- The randevuclaw_app role only exists on environments that ran migration 0003;
-- guard so the file also applies cleanly on a bare local test database.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'randevuclaw_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_memory TO randevuclaw_app;
    GRANT USAGE, SELECT ON SEQUENCE conversation_memory_id_seq TO randevuclaw_app;
  END IF;
END
$$;

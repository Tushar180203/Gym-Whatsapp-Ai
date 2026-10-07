ALTER TABLE routines ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE exercise_identities ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE exercise_identities ADD COLUMN merged_into_id text REFERENCES exercise_identities(id);
ALTER TABLE outbound_messages ADD COLUMN body text;
ALTER TABLE inbound_messages ADD COLUMN result_body text;
ALTER TABLE inbound_messages ADD COLUMN clarification_action jsonb;
ALTER TABLE inbound_messages ADD COLUMN clarification_resolved_at timestamptz;
ALTER TABLE inbound_messages ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE planned_exercises ADD COLUMN removed_at timestamptz;
ALTER TABLE planned_exercises ALTER COLUMN planned_set_count DROP NOT NULL;
ALTER TABLE planned_exercises ALTER COLUMN rep_target_min DROP NOT NULL;
ALTER TABLE planned_exercises ALTER COLUMN rep_target_max DROP NOT NULL;
ALTER TABLE session_exercises ALTER COLUMN planned_set_count_snapshot DROP NOT NULL;
ALTER TABLE session_exercises ALTER COLUMN rep_target_min_snapshot DROP NOT NULL;
ALTER TABLE session_exercises ALTER COLUMN rep_target_max_snapshot DROP NOT NULL;
ALTER TABLE session_exercises ADD COLUMN skipped_set_count integer NOT NULL DEFAULT 0 CHECK (skipped_set_count >= 0);
UPDATE session_exercises SET status='IN_PROGRESS' WHERE status='ACTIVE';
-- Timestamp actual insertion after the per-user lock, not an earlier transaction start.
ALTER TABLE workout_sets ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE TABLE exercise_aliases (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  exercise_identity_id text NOT NULL REFERENCES exercise_identities(id),
  alias_text text NOT NULL,
  normalized_alias text NOT NULL,
  status text NOT NULL CHECK (status IN ('CONFIRMED', 'REVOKED')),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX confirmed_alias_per_user ON exercise_aliases(user_id, normalized_alias) WHERE status = 'CONFIRMED';
CREATE TABLE pending_confirmations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  action_type text NOT NULL,
  proposed_action jsonb NOT NULL,
  summary text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED', 'EXPIRED', 'STALE')),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  applied_command_id text REFERENCES command_executions(id),
  result_body text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_pending_confirmation ON pending_confirmations(user_id) WHERE status = 'PENDING';
CREATE TABLE corrections (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  workout_session_id text REFERENCES workout_sessions(id),
  type text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  source_surface text NOT NULL CHECK (source_surface IN ('WHATSAPP', 'WEB')),
  source_message_id text REFERENCES inbound_messages(id),
  confirmation_id text REFERENCES pending_confirmations(id),
  command_id text NOT NULL REFERENCES command_executions(id),
  applied_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(command_id, target_id)
);

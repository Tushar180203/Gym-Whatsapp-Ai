CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_profiles (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES users(id),
  preferred_weight_unit text NOT NULL CHECK (preferred_weight_unit IN ('KG', 'LB')),
  display_name text
);

CREATE TABLE auth_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE whatsapp_provider_accounts (
  id text PRIMARY KEY,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE whatsapp_provider_user_identities (
  id text PRIMARY KEY,
  whatsapp_provider_account_id text NOT NULL REFERENCES whatsapp_provider_accounts(id),
  provider_user_identity_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (whatsapp_provider_account_id, provider_user_identity_hash)
);

CREATE TABLE whatsapp_identity_links (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  whatsapp_provider_user_identity_id text NOT NULL REFERENCES whatsapp_provider_user_identities(id),
  linked_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE UNIQUE INDEX one_active_whatsapp_identity_link
ON whatsapp_identity_links (whatsapp_provider_user_identity_id)
WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX one_active_whatsapp_link_per_user
ON whatsapp_identity_links (user_id, whatsapp_provider_user_identity_id)
WHERE revoked_at IS NULL;

CREATE TABLE account_link_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE routines (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE exercise_identities (
  id text PRIMARY KEY,
  owner_user_id text REFERENCES users(id),
  display_name text NOT NULL,
  default_load_semantics text NOT NULL
);

CREATE TABLE workout_session_templates (
  id text PRIMARY KEY,
  routine_id text NOT NULL REFERENCES routines(id),
  name text NOT NULL,
  sequence_index integer NOT NULL,
  UNIQUE (routine_id, sequence_index)
);

CREATE TABLE routine_sequence_cursors (
  id text PRIMARY KEY,
  routine_id text NOT NULL REFERENCES routines(id),
  user_id text NOT NULL REFERENCES users(id),
  next_session_template_id text NOT NULL REFERENCES workout_session_templates(id),
  cursor_sequence_index integer NOT NULL,
  UNIQUE (routine_id)
);

CREATE TABLE planned_exercises (
  id text PRIMARY KEY,
  session_template_id text NOT NULL REFERENCES workout_session_templates(id),
  exercise_identity_id text NOT NULL REFERENCES exercise_identities(id),
  order_index integer NOT NULL,
  planned_set_count integer NOT NULL CHECK (planned_set_count > 0),
  rep_target_min integer NOT NULL,
  rep_target_max integer NOT NULL,
  UNIQUE (session_template_id, order_index)
);

CREATE TABLE workout_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  routine_id text NOT NULL REFERENCES routines(id),
  session_template_id text NOT NULL REFERENCES workout_session_templates(id),
  template_snapshot jsonb NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  active_session_exercise_id text,
  sequence_progression_policy text NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  discarded_at timestamptz,
  duration_seconds integer,
  completion_intent text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX one_active_workout_per_user
ON workout_sessions (user_id)
WHERE status IN ('PROPOSED', 'ACTIVE', 'PAUSED');

CREATE TABLE session_exercises (
  id text PRIMARY KEY,
  workout_session_id text NOT NULL REFERENCES workout_sessions(id),
  exercise_identity_id text NOT NULL REFERENCES exercise_identities(id),
  source_planned_exercise_id text REFERENCES planned_exercises(id),
  order_index integer NOT NULL,
  status text NOT NULL,
  planned_set_count_snapshot integer NOT NULL,
  rep_target_min_snapshot integer NOT NULL,
  rep_target_max_snapshot integer NOT NULL
);

CREATE TABLE workout_sets (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  workout_session_id text NOT NULL REFERENCES workout_sessions(id),
  session_exercise_id text NOT NULL REFERENCES session_exercises(id),
  exercise_identity_id text NOT NULL REFERENCES exercise_identities(id),
  set_index integer NOT NULL,
  load_value numeric NOT NULL,
  weight_unit text NOT NULL,
  load_semantics text NOT NULL,
  reps integer NOT NULL,
  status text NOT NULL,
  idempotency_key text NOT NULL,
  source_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_exercise_id, set_index),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE inbound_messages (
  id text PRIMARY KEY,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  provider_message_id text NOT NULL,
  provider_user_identity_hash text NOT NULL,
  user_id text REFERENCES users(id),
  text_redacted text,
  raw_payload_hash text NOT NULL,
  processing_status text NOT NULL,
  command_execution_id text,
  outbound_message_id text,
  processed_at timestamptz,
  error_category text,
  UNIQUE (provider_account_id, provider_message_id)
);

CREATE TABLE command_executions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  command_type text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL,
  result_summary jsonb,
  applied_at timestamptz,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE outbound_messages (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  inbound_message_id text NOT NULL REFERENCES inbound_messages(id),
  provider_account_id text NOT NULL,
  provider_user_identity_hash text NOT NULL,
  body_hash text NOT NULL,
  status text NOT NULL,
  sent_at timestamptz,
  UNIQUE (inbound_message_id)
);

ALTER TABLE users ADD COLUMN data_control_generation integer NOT NULL DEFAULT 0;
ALTER TABLE inbound_messages ADD COLUMN data_control_generation integer NOT NULL DEFAULT 0;
ALTER TABLE workout_sessions ADD COLUMN data_deleted_at timestamptz;
ALTER TABLE users DROP CONSTRAINT users_email_key;
CREATE UNIQUE INDEX active_user_email ON users(email) WHERE deleted_at IS NULL;
CREATE TABLE data_control_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK(type IN ('EXPORT','DELETE_ACCOUNT','DELETE_WORKOUT_DATA')),
  status text NOT NULL CHECK(status IN ('AWAITING_CONFIRMATION','COMPLETED','EXPIRED','STALE','REVOKED')),
  idempotency_key text NOT NULL,
  creator_session_hash text NOT NULL,
  target_digest text,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  result_location text,
  result_data jsonb,
  audit_summary jsonb NOT NULL DEFAULT '{}',
  UNIQUE(user_id,idempotency_key),
  CHECK(type='EXPORT' OR expires_at IS NOT NULL),
  CHECK(status <> 'COMPLETED' OR completed_at IS NOT NULL)
);
CREATE UNIQUE INDEX one_pending_data_deletion ON data_control_requests(user_id) WHERE status='AWAITING_CONFIRMATION';

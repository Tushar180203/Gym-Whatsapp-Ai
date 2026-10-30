ALTER TABLE user_profiles ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC';
ALTER TABLE user_profiles ADD COLUMN conversation_memory_enabled boolean NOT NULL DEFAULT true;
CREATE TABLE conversation_turns (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  inbound_message_id text NOT NULL REFERENCES inbound_messages(id),
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL CHECK (length(content) <= 1000),
  occurred_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (inbound_message_id, role)
);
CREATE INDEX conversation_turns_owner_time ON conversation_turns(user_id,occurred_at DESC,id DESC);
CREATE INDEX conversation_turns_expiry ON conversation_turns(expires_at);

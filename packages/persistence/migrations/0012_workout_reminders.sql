ALTER TABLE user_profiles ADD COLUMN workout_reminders_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE outbound_messages
  ADD COLUMN message_template jsonb CHECK (message_template IS NULL OR jsonb_typeof(message_template)='object'),
  ADD COLUMN notification_expires_at timestamptz;

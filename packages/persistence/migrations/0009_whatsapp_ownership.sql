ALTER TABLE account_link_tokens
  ADD COLUMN expected_provider_identity_hash text CHECK (expected_provider_identity_hash ~ '^[a-f0-9]{64}$'),
  ADD COLUMN masked_number text,
  ADD COLUMN status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONSUMED','SUPERSEDED','EXPIRED')),
  ADD COLUMN change_intent boolean NOT NULL DEFAULT false,
  ADD COLUMN opt_in_at timestamptz,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20);
UPDATE account_link_tokens SET status=CASE WHEN consumed_at IS NOT NULL THEN 'CONSUMED' ELSE 'SUPERSEDED' END;
ALTER TABLE account_link_tokens ADD CONSTRAINT challenge_pending_bound CHECK (status<>'PENDING' OR expected_provider_identity_hash IS NOT NULL);
ALTER TABLE account_link_tokens ADD CONSTRAINT challenge_consumption CHECK ((status='CONSUMED')=(consumed_at IS NOT NULL));
ALTER TABLE account_link_tokens ADD CONSTRAINT challenge_owner_key UNIQUE(id,user_id);
CREATE UNIQUE INDEX one_pending_whatsapp_challenge ON account_link_tokens(user_id) WHERE status='PENDING';
CREATE INDEX whatsapp_challenge_owner_status ON account_link_tokens(user_id,status,expires_at);

ALTER TABLE whatsapp_identity_links
  ADD COLUMN status text NOT NULL DEFAULT 'VERIFIED' CHECK (status IN ('VERIFIED','REVOKED')),
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN masked_number text,
  ADD COLUMN opt_in_at timestamptz,
  ADD COLUMN verification_challenge_id text,
  ADD CONSTRAINT verified_challenge_owner FOREIGN KEY(verification_challenge_id,user_id) REFERENCES account_link_tokens(id,user_id);
UPDATE whatsapp_identity_links SET status=CASE WHEN revoked_at IS NULL THEN 'VERIFIED' ELSE 'REVOKED' END,verified_at=linked_at;
ALTER TABLE whatsapp_identity_links ADD CONSTRAINT verified_link_timestamp CHECK (verified_at IS NOT NULL);
ALTER TABLE whatsapp_identity_links ADD CONSTRAINT link_revocation_status CHECK ((status='REVOKED')=(revoked_at IS NOT NULL));
ALTER TABLE whatsapp_identity_links ADD CONSTRAINT whatsapp_link_owner_key UNIQUE(id,user_id);
CREATE UNIQUE INDEX one_number_bound_verified_link_per_user ON whatsapp_identity_links(user_id)
  WHERE revoked_at IS NULL AND verification_challenge_id IS NOT NULL;
ALTER TABLE inbound_messages ADD COLUMN verified_link_id text,
  ADD CONSTRAINT inbound_verified_link_owner FOREIGN KEY(verified_link_id,user_id) REFERENCES whatsapp_identity_links(id,user_id);

-- Keep existing idempotent conversational replies; allow durable plan-ready intents without a synthetic inbound event.
ALTER TABLE outbound_messages ALTER COLUMN inbound_message_id DROP NOT NULL;
ALTER TABLE outbound_messages ADD COLUMN notification_key text UNIQUE,
  ADD COLUMN notification_link_id text REFERENCES whatsapp_identity_links(id),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN owner_generation integer NOT NULL DEFAULT 0;
UPDATE outbound_messages o SET owner_generation=m.data_control_generation FROM inbound_messages m WHERE m.id=o.inbound_message_id;
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_intent_origin CHECK (inbound_message_id IS NOT NULL OR notification_key IS NOT NULL);
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_notification_link_owner FOREIGN KEY(notification_link_id,user_id) REFERENCES whatsapp_identity_links(id,user_id);
CREATE INDEX pending_owner_notifications ON outbound_messages(user_id,created_at) WHERE notification_key IS NOT NULL AND status IN ('PENDING','FAILED_RETRYABLE');

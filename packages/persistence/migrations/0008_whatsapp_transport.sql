CREATE TABLE whatsapp_recipient_addresses (
  identity_id text PRIMARY KEY REFERENCES whatsapp_provider_user_identities(id),
  address_ciphertext text NOT NULL CHECK (address_ciphertext LIKE 'v1:%'),
  last_inbound_at timestamptz NOT NULL
);

ALTER TABLE outbound_messages
  ADD COLUMN recipient_identity_id text REFERENCES whatsapp_provider_user_identities(id),
  ADD COLUMN provider_outbound_message_id text,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  ADD COLUMN attempt_started_at timestamptz,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN error_category text,
  ADD COLUMN safe_to_retry boolean NOT NULL DEFAULT true,
  ADD COLUMN reconciliation_state text NOT NULL DEFAULT 'CURRENT'
    CHECK (reconciliation_state IN ('CURRENT','LEGACY_UNKNOWN','LEGACY_NEVER_ATTEMPTED','PROVIDER_ACCEPTED','DELIVERY_UNKNOWN')),
  ADD COLUMN delivery_status text CHECK (delivery_status IN ('sent','delivered','failed')),
  ADD COLUMN receipt_at timestamptz;

-- Old SENT represented local persistence, not provider acceptance. No evidence exists in the old schema.
-- Also quarantine old PENDING/FAILED rows: their age/service window cannot justify automatic replay.
UPDATE outbound_messages SET reconciliation_state=CASE WHEN status='SENT' THEN 'LEGACY_UNKNOWN' ELSE 'LEGACY_NEVER_ATTEMPTED' END,
  safe_to_retry=false, error_category='LEGACY_REVIEW_REQUIRED', sent_at=NULL,
  status=CASE WHEN status IN ('SENT','FAILED','FAILED_RETRYABLE') THEN 'FAILED_FINAL' ELSE status END;

ALTER TABLE outbound_messages ADD CONSTRAINT outbound_transport_status CHECK (status IN ('PENDING','SENDING','SENT','FAILED_RETRYABLE','FAILED_FINAL'));
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_sent_requires_evidence CHECK (status<>'SENT' OR provider_outbound_message_id IS NOT NULL);
CREATE UNIQUE INDEX outbound_provider_message_unique ON outbound_messages(provider_account_id,provider_outbound_message_id) WHERE provider_outbound_message_id IS NOT NULL;
CREATE INDEX outbound_retry_lookup ON outbound_messages(next_attempt_at) WHERE safe_to_retry AND status='FAILED_RETRYABLE';

CREATE TABLE outbound_delivery_attempts (
  outbound_message_id text NOT NULL REFERENCES outbound_messages(id),
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  outcome text NOT NULL CHECK (outcome IN ('SENDING','ACCEPTED','REJECTED','UNKNOWN')),
  error_category text,
  http_status integer,
  PRIMARY KEY (outbound_message_id,attempt_number)
);

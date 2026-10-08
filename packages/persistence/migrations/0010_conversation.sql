CREATE TABLE conversation_states (
  user_id text PRIMARY KEY REFERENCES users(id),
  version integer NOT NULL CHECK (version >= 0),
  state jsonb NOT NULL CHECK (
    coalesce(state->>'schemaVersion'='conversation.v1',false)
    AND jsonb_typeof(state)='object'
    AND state ?& ARRAY['schemaVersion','mode','stack','version']
    AND state->'version'=to_jsonb(version)
    AND state->>'mode' IN ('IDLE','WORKOUT_PROPOSED','WORKOUT_ACTIVE','WORKOUT_FINISH_PENDING')
    AND jsonb_typeof(state->'stack')='array'
    AND jsonb_array_length(state->'stack')<=3
  ),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

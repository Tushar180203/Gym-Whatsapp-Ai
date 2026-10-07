CREATE TABLE exercise_muscle_classifications (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  exercise_identity_id text NOT NULL REFERENCES exercise_identities(id),
  muscle_group text NOT NULL CHECK(length(trim(muscle_group)) BETWEEN 1 AND 80),
  role text NOT NULL CHECK(role IN ('PRIMARY','SECONDARY')),
  status text NOT NULL CHECK(status IN ('CONFIRMED','UNCERTAIN','UNCLASSIFIED')),
  source text NOT NULL,
  confirmed_by_user_id text REFERENCES users(id),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(confirmed_by_user_id IS NULL OR confirmed_by_user_id=user_id)
);
CREATE UNIQUE INDEX unique_owner_exercise_muscle_role ON exercise_muscle_classifications(user_id,exercise_identity_id,lower(muscle_group),role);

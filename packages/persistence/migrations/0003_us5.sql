ALTER TABLE workout_sessions ADD COLUMN completion_choice_pending boolean NOT NULL DEFAULT false;
ALTER TABLE session_exercises ADD COLUMN exercise_name_snapshot text;
UPDATE session_exercises se SET exercise_name_snapshot=e.display_name
FROM exercise_identities e WHERE e.id=se.exercise_identity_id;
CREATE INDEX comparable_exercise_history ON workout_sets(user_id,exercise_identity_id,weight_unit,load_semantics)
WHERE status='RECORDED';

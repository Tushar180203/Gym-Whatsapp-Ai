-- Protect parent ownership and context relationships in addition to command authorization.
ALTER TABLE routines ADD CONSTRAINT routine_owner_key UNIQUE(id,user_id);
ALTER TABLE workout_session_templates ADD CONSTRAINT template_routine_key UNIQUE(id,routine_id);
ALTER TABLE workout_session_templates ADD CONSTRAINT template_cursor_key UNIQUE(id,routine_id,sequence_index);
ALTER TABLE workout_sessions ADD CONSTRAINT workout_owner_key UNIQUE(id,user_id);
ALTER TABLE session_exercises ADD CONSTRAINT session_exercise_workout_key UNIQUE(id,workout_session_id);
ALTER TABLE session_exercises ADD CONSTRAINT session_exercise_identity_key UNIQUE(id,exercise_identity_id);
ALTER TABLE workout_sessions ADD CONSTRAINT workout_routine_owner FOREIGN KEY(routine_id,user_id) REFERENCES routines(id,user_id);
ALTER TABLE workout_sessions ADD CONSTRAINT workout_template_routine FOREIGN KEY(session_template_id,routine_id) REFERENCES workout_session_templates(id,routine_id);
ALTER TABLE routine_sequence_cursors ADD CONSTRAINT cursor_routine_owner FOREIGN KEY(routine_id,user_id) REFERENCES routines(id,user_id);
ALTER TABLE routine_sequence_cursors ADD CONSTRAINT cursor_template_position FOREIGN KEY(next_session_template_id,routine_id,cursor_sequence_index) REFERENCES workout_session_templates(id,routine_id,sequence_index) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE workout_sets ADD CONSTRAINT set_workout_owner FOREIGN KEY(workout_session_id,user_id) REFERENCES workout_sessions(id,user_id);
ALTER TABLE workout_sets ADD CONSTRAINT set_exercise_workout FOREIGN KEY(session_exercise_id,workout_session_id) REFERENCES session_exercises(id,workout_session_id);
-- Confirmed merges update sets and session exercises together; validate their final transaction state.
ALTER TABLE workout_sets ADD CONSTRAINT set_exercise_identity FOREIGN KEY(session_exercise_id,exercise_identity_id) REFERENCES session_exercises(id,exercise_identity_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE workout_sets ADD CONSTRAINT valid_set_values CHECK(reps>0 AND load_value>=0 AND load_value<>'NaN'::numeric AND load_value<>'Infinity'::numeric AND set_index>0 AND weight_unit IN ('KG','LB') AND load_semantics IN ('UNSPECIFIED_DEFAULT','PER_HAND_PER_SIDE','TOTAL_LOAD','MACHINE_STACK'));
ALTER TABLE workout_sessions ADD CONSTRAINT active_exercise_workout FOREIGN KEY(active_session_exercise_id,id) REFERENCES session_exercises(id,workout_session_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX owner_saved_workouts ON workout_sessions(user_id,created_at) WHERE status IN ('COMPLETED','INCOMPLETE');
CREATE INDEX owner_session_sets ON workout_sets(user_id,workout_session_id,created_at) WHERE status='RECORDED';
CREATE INDEX session_exercise_order ON session_exercises(workout_session_id,order_index);
CREATE INDEX owner_correction_history ON corrections(user_id,workout_session_id);

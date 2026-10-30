ALTER TABLE routines ADD COLUMN schedule_metadata jsonb NOT NULL DEFAULT '{"plannedDays":[]}';
ALTER TABLE routines ADD COLUMN archived_at timestamptz;
ALTER TABLE workout_session_templates ADD COLUMN archived_at timestamptz;
ALTER TABLE routine_sequence_cursors ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE workout_sessions ADD COLUMN proposal_routine_version integer;
ALTER TABLE routines ADD CONSTRAINT routine_schedule_object CHECK(jsonb_typeof(schedule_metadata)='object');
CREATE INDEX owner_current_routines ON routines(user_id) WHERE archived_at IS NULL;
ALTER TABLE workout_session_templates DROP CONSTRAINT workout_session_templates_routine_id_sequence_index_key;
ALTER TABLE workout_session_templates ADD CONSTRAINT workout_session_templates_routine_id_sequence_index_key UNIQUE(routine_id,sequence_index) DEFERRABLE INITIALLY DEFERRED;
INSERT INTO exercise_identities(id,owner_user_id,display_name,default_load_semantics)
VALUES ('global_barbell_bench_press',NULL,'Barbell Bench Press','TOTAL_LOAD'),
       ('global_leg_extension',NULL,'Leg Extension','MACHINE_STACK'),
       ('global_lat_pulldown',NULL,'Lat Pulldown','MACHINE_STACK');

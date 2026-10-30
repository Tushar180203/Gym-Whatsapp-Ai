export const portableFields = {
  account: ["id", "email", "created_at"],
  profile: ["preferred_weight_unit", "display_name", "time_zone", "conversation_memory_enabled", "workout_reminders_enabled"],
  conversationMemory: ["role", "content", "occurred_at", "expires_at"],
  links: ["id", "provider", "provider_account_id", "linked_at", "revoked_at"],
  routines: ["id", "name", "version", "created_at"],
  cursors: ["routine_id", "next_session_template_id", "cursor_sequence_index"],
  templates: ["id", "routine_id", "name", "sequence_index"],
  plannedExercises: ["id", "session_template_id", "exercise_identity_id", "order_index", "planned_set_count", "rep_target_min", "rep_target_max", "removed_at"],
  exercises: ["id", "display_name", "default_load_semantics", "merged_into_id"],
  aliases: ["id", "exercise_identity_id", "alias_text", "status", "confirmed_at"],
  classifications: ["exercise_identity_id", "muscle_group", "role", "status", "source", "confirmed_at"],
  workouts: ["id", "routine_id", "session_template_id", "template_snapshot", "name", "status", "sequence_progression_policy", "started_at", "completed_at", "discarded_at", "duration_seconds", "completion_intent", "completion_choice_pending", "version", "created_at"],
  sessionExercises: ["id", "workout_session_id", "exercise_identity_id", "exercise_name_snapshot", "source_planned_exercise_id", "order_index", "status", "planned_set_count_snapshot", "rep_target_min_snapshot", "rep_target_max_snapshot", "skipped_set_count"],
  sets: ["id", "workout_session_id", "session_exercise_id", "exercise_identity_id", "set_index", "load_value", "weight_unit", "load_semantics", "reps", "status", "created_at"],
  corrections: ["id", "workout_session_id", "type", "target_type", "target_id", "before_snapshot", "after_snapshot", "source_surface", "applied_at"]
} as const;
export type ExportCategory = keyof typeof portableFields;
export type ExportRows = Partial<Record<ExportCategory, Record<string, unknown>[]>>;
export function portableExport(userId: string, rows: ExportRows) {
  return Object.fromEntries(Object.entries(portableFields).map(([category, fields]) => [category,
    (rows[category as ExportCategory] ?? []).filter(row => category === "exercises" ? row.owner_user_id === null || row.owner_user_id === userId : row.user_id === userId)
      .map(row => Object.fromEntries(fields.filter(field => row[field] !== undefined).map(field => [field, portableValue(row[field])])))
  ])) as Record<ExportCategory, Record<string, unknown>[]>;
}
function portableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(portableValue);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/password|secret|token|credential|api.?key|source_message_id|idempotency_key|provider_operation/i.test(key)).map(([key, child]) => [key, portableValue(child)]));
}

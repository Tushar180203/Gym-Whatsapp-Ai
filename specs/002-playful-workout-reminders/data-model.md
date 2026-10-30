# Reminder data model

- `user_profiles.workout_reminders_enabled`: non-null boolean, default false. Authenticated owner updates through the existing profile contract; included in portable export.
- `outbound_messages.message_template`: nullable JSON object `{ name, languageCode, bodyParameters }`, validated with a shared schema before queueing and sending. Ordinary conversational messages remain text payloads.
- `outbound_messages.notification_expires_at`: nullable timestamp. A reminder expires at 05:15 on its originating local morning; pending expired/opted-out reminders cannot send.
- Existing `notification_key`: `workout-reminder:<userId>:<localDate>` is unique. The linked identity and owner generation remain bound by existing foreign keys and delivery checks.
- State: eligible → PENDING → SENDING → SENT, or existing bounded failure/unknown states. Opt-out/expiry becomes FAILED_FINAL without a provider call. Reminder creation never changes workouts, sets, routines, or cursors.

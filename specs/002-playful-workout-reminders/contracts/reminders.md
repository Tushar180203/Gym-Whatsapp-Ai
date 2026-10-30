# Reminder contracts

## Profile

`PATCH /api/profile` accepts optional boolean `workoutRemindersEnabled` alongside the required preferred weight unit. GET returns the saved value. Omission preserves it; explicit false stops pending reminder sends. Existing authentication and foreign-field rejection apply.

## Scheduler

`npm run reminders:run` previews eligible reminder counts without queueing/sending. `npm run reminders:run -- --send` queues and delivers configured reminders once. `npm run reminders:worker` runs a sequential tick every 30 seconds and exits on termination. Logs contain counts/status only. Sending requires `WHATSAPP_PROVIDER=cloud_api`. Without template configuration, only verified users inside their 24-hour inbound chat window are queued. Optional approved `WHATSAPP_REMINDER_TEMPLATE_NAME` and matching `WHATSAPP_REMINDER_TEMPLATE_LANGUAGE` extend delivery outside that window.

## Approved template copy

Create a WhatsApp BODY template with one positional text parameter, matching this copy exactly:

```text
⏰ *5 AM workout reminder*

Today's plan: {{1}}

Yeahh buddy, let's gooo! 💪🔥

Reply START to see your workout. Turn reminders off in your profile.
```

The sole parameter is the saved routine/session summary, normalized to a single line and bounded to 900 characters. Multiple plans are included; an oversized list uses the actual plan count. No URLs, headers, buttons, media, or AI-generated parameters are needed. Meta chooses/approves the category; approval is an external deployment requirement.

The adapter sends `type: template`, the persisted approved name, `language.code`, and BODY text parameters. Ordinary replies retain their 24-hour-window check. Template sends still require a verified owned recipient and existing consent.

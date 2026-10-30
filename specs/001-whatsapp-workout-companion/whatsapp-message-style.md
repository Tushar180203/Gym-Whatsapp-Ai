# WhatsApp reply presentation

The 2026-10-29 follow-up adds playful icons, motivation and opt-in 5 AM reminders; see [the extension spec](../002-playful-workout-reminders/spec.md).

User request, 2026-10-29: structure all outgoing replies so they look professional and are easy to read in WhatsApp. This refines existing conversation and delivery behavior (FR-033, FR-050, FR-059, FR-067); it adds no workout actions.

## Expected behavior

- Use WhatsApp single-asterisk bold for short, factual headings. Use blank lines between context, recorded details, and the next action.
- Give each existing typed response category a suitable heading. A question, failed operation, or confirmation must never be presented as an applied change.
- Show multiple recorded sets, previous sets, personal records, and available workout choices on separate lines. Preserve units, load conventions, counts, names, dates, and confirmation wording.
- Keep routine plans in their original order. Keep follow-up instructions readable and show only commands already supported by the conversation flow.
- Cover connected-account and plan-ready notifications as well as interactive replies. Persist and deliver the same formatted body; retries must not add headings again.
- Apply presentation deterministically without AI calls. No extra messages, automatic exercise advancement, additional confirmation, or workout changes.
- Preserve all content near WhatsApp's existing 4096-character boundary. Omit optional decoration if it would push a valid reply over the limit; never truncate facts or a confirmation.

## Implementation plan

1. Add one pure layout helper shared by typed reply rendering and outgoing notification creation. Keep internal command results unformatted until the response boundary.
2. Improve previous-performance and completion-summary layouts using their structured inputs. Route the existing web formatter to the same helper.
3. Verify exact message examples, every response category, numeric preservation, pending questions, repeat formatting, length boundaries, and the outgoing body. Run the required lint/test gates.

## Tasks and evidence

- [X] W1 Implement the shared layout and response-category headings.
- [X] W2 Apply it to connection/plan-ready notifications and structured workout summaries.
- [X] W3 Add layout and flow regressions; run lint and the offline test suite.

There are no schema, SQL, provider, AI prompt, or intent changes. PostgreSQL-backed verification uses a disposable test database only.

## Sample replies (synthetic data)

```text
*✅ Sets recorded*

Solid work. One set at a time! 💪

Logged:
• 45 kg per hand/side x 10
• 45 kg per hand/side x 9

Stay on Incline Press; send another set, NEXT or DONE.
```

```text
*🤔 Quick question*

Unfinished work remains.

Reply with one option:
• Save completed
• Save incomplete
• Continue
• Discard
```

```text
*📝 Workout summary*

That's a wrap. Nice work showing up! 🙌

Push day: completed

*Session totals*
Exercises: 4
Sets: 12
Duration: 42m 0s

*Personal records*
• Bench Press 60 KG total x 8
```

## Verification

- `npm run lint`: passed (TypeScript strict checks).
- `npm test -- --reporter=dot`: 416 passed; 220 database-gated tests skipped in the default offline invocation.
- `npm run eval`: 114 passed; 1 opt-in live-provider case skipped.
- PostgreSQL suites against the existing disposable `workout_flow_test` database: 166 distinct tests passed across `us4`, `us5`, `us6`, `conversation`, `authenticated-conversations`, `whatsapp-ownership`, and `whatsapp-transport`. Delivery was checked again after the welcome-recovery compatibility adjustment (15 passed).
- The controlled HTTP provider received the exact persisted formatted body; duplicate delivery, confirmation, restart and retry checks retained their durable-state assertions.
- Live Meta sending and live AI evaluations were not run: this is deterministic presentation, and those external checks are opt-in. No web UI changed, so no browser UI suite was required.
- Existing analytics restart equality tests now use the original snapshot's `asOf` for both requests. This preserves full snapshot equality across restart while accounting for the timestamp added by the earlier analytics work.

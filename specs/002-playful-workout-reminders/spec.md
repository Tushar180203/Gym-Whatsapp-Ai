# Feature Specification: Playful replies and morning workout reminders

**Feature Branch**: `002-playful-workout-reminders`  
**Created**: 2026-10-29  
**Status**: Implementation requested by user  
**Input**: Add icons and motivation to WhatsApp replies, including “yeahh buddy les gooo”, plus a 5 AM reminder about today's workout.

## User Scenarios & Testing

### User Story 1 — A playful gym companion (P1)

Workout replies use a small, relevant icon and occasional upbeat language while keeping headings, recorded facts, questions, and next steps clear.

**Independent test**: Render workout start, set acknowledgement, history, confirmation, error, and completion replies. Success moments may celebrate; errors, cancellations, discard results, and clarification never claim progress.

**Acceptance**: A workout start says “Yeahh buddy, let's gooo! 💪🔥”; successful set logging has concise encouragement; a provider failure remains calm and useful. Reformatting a reply never repeats icons or motivation.

### User Story 2 — A 5 AM workout reminder (P1)

A user enables workout reminders in profile preferences and receives one WhatsApp reminder at 5 AM in their saved time zone on the training days in their saved routines.

**Independent test**: With a verified, opted-in identity and a scheduled routine, an enabled user receives exactly one reminder for the local date; concurrent/restarted workers do not duplicate it. A next session comes from the saved sequence; no workout is started by reminding.

**Acceptance**: Reminders include the next saved workout(s), the requested hype line and a START instruction. Off days, missing plans, disabled reminders, revoked links, deleted accounts, an active workout, and already-recorded training today do not receive a new reminder.

### User Story 3 — Control and reliable delivery (P2)

Users can disable reminders and inspect the time zone that controls them. Pending reminders stop after opting out and expire instead of arriving much later.

**Independent test**: Disable after enqueue, revoke a link, delete an account, or advance beyond expiry; delivery must not call the provider. A closed 24-hour chat window uses an optional configured approved template; without one, the reminder pauses until an inbound message reopens the window.

## Requirements

- **FR-001**: Keep factual values, supported commands, confirmation rules and deterministic workout state unchanged by tone.
- **FR-002**: Add relevant icons and short deterministic motivation to suitable success replies. Keep uncertain/error/destructive states free of celebration.
- **FR-003**: Reminders require a separate explicit opt-in, default off, and a verified messaging identity with workout messaging consent.
- **FR-004**: Schedule at 05:00 in the saved IANA time zone, with a 10-minute worker catch-up window and expiry at 05:15. Use the saved routine's planned weekdays; no planned weekdays means no scheduled reminder.
- **FR-005**: Include every eligible routine's next saved session, or a factual count if the list is too long. Never choose a replacement, skip a cursor, create a session, or invent exercises.
- **FR-006**: Deduplicate once per user and local date across workers, retries and identity changes. Recheck ownership, opt-in and expiry before sending.
- **FR-007**: Persist validated template metadata and the rendered message alongside the existing durable outbound intent. Use the existing delivery/retry/unknown-outcome protections.
- **FR-008**: Provide a read-only dry run and a runnable scheduler worker. Live delivery without a template is allowed only inside the existing 24-hour chat window. An optional configured Meta-approved template matching the documented copy extends reminders outside it.
- **FR-009**: Export the reminder preference with user data. Deletion/generation protections continue to block stale delivery.

## Key Entities

Profile reminder preference; existing routine planned days and sequence cursor; dated outbound reminder intent; configured approved message template.

## Assumptions and Dependencies

“5am” means each user's saved local time. The request authorizes adding reminders inside the existing companion scope; it does not authorize applying a production migration or activating external delivery. Existing message consent alone does not enable reminders. Deployment needs a continuously running worker. A Meta-approved template is optional; without one, reminders pause after 24 hours without an inbound message.

## Edge Cases

Local/UTC date differences and DST; duplicate ticks and changed links; no training days; multiple routines; active or early-completed training; late retries; provider timeout with unknown acceptance; invalid time zone in legacy data; missing or mismatched template configuration.

## Success Criteria

- Exactly one eligible reminder intent per user/local day, with zero workout mutations.
- All disabled, off-day, unverified, deleted, expired and active-workout cases produce no provider send.
- Layout tests preserve every numerical fact and never duplicate decoration.
- Automated verification covers scheduling boundaries, durable replay/ownership, template delivery and the preference UI.

## Clarification, 2026-10-29

The user has no approved template and no time to obtain approval. Build reminders that work within the existing 24-hour messaging window now; skip unsupported sends outside it. Optional approved-template support remains available for later. No template approval is required to use the first version.

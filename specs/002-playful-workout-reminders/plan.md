# Implementation Plan: Playful replies and morning reminders

**Branch**: `002-playful-workout-reminders` | **Date**: 2026-10-29 | **Spec**: [spec.md](spec.md)

## Summary

Extend the shared deterministic WhatsApp renderer with icons and sparse celebration. Add an explicit profile opt-in and a 5 AM scheduler using the existing verified identity, routine planned days, sequence cursor and durable outbound delivery pipeline. Send within the existing 24-hour window by default; optionally persist an approved-template envelope to extend reminders beyond it.

## Technical Context

**Language/Version**: Node 22, strict TypeScript, Next.js 16 / React 19.  
**Dependencies**: Existing pg, Zod, Vitest and Playwright; no additions.  
**Storage**: New ordered migration adds one profile preference plus nullable outbound template/expiry metadata.  
**Testing**: Layout/scheduling unit tests, mocked provider contracts, disposable PostgreSQL tests and preference browser checks.  
**Platform/type**: Existing Linux web application plus a separate scheduler CLI/worker.  
**Performance**: One bounded tick every 30 seconds; only users inside the local 05:00–05:09 window generate plans; delivery attempts remain bounded by the existing transport.  
**Constraints**: No live sends or production migrations during implementation. No AI calls or new intent behavior. No raw chat, secrets or phone addresses in scheduler logs.  
**Scope**: Existing pilot application and opt-in users; routine changes and workout progression remain authoritative.

## Constitution Check

Passed before and after design: user request authorizes this reminder extension; spec precedes code; facts and schedule selection are deterministic; approved template config is in messaging contracts/adapters; user opt-in and opt-out are explicit; outbound owner locks/dedup/retry and deletion protections are reused. Production migration and activation remain a human-reviewed deployment step. No new dependencies or automatic coaching.

## Project Structure

- `packages/domain/src/messaging/response-layout.ts`: playful presentation.
- `packages/domain/src/reminders/morning-reminder.ts`: pure local-time/day planner and fixed approved copy.
- `packages/contracts/src/messaging/template.ts`: validated template envelope.
- `packages/persistence/migrations/0012_workout_reminders.sql`: preference and outbound metadata.
- `packages/persistence/src/workout-reminders.ts`: owner-locked queue/read-only preview.
- `packages/messaging/src/postgres-delivery.ts`, `whatsapp/outbound-adapter.ts`: opt-out/expiry and template delivery.
- `apps/web/components/routines/setup-view.tsx`: reminder preference and time-zone explanation.
- `scripts/workout-reminders.ts`: once/dry-run/watch worker.

## Research and Design

Research delegated to a read-only provider researcher per the plan workflow; results recorded in [research.md](research.md). No mandatory extension hooks are registered. Data, API and runtime contracts are documented separately. Build the two stories sequentially: tone first, then reminder queue/transport/settings, then verification.

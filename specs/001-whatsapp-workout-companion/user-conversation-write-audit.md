# User conversation and write audit

Generated: 2026-10-29T05:25:47.109Z

Audited **2,640 scenarios**, **6,320 evaluated turns**, and **820 distinct user messages**. 2,640 scenarios passed (100.00%); 0 failed.

There were 2,640 raw scenario evaluations, including 0 reruns. Final case results use the latest evaluation for each scenario ID. Earlier failures remain in their original artifacts; 0 raw evaluations failed before any later correction or rerun. A provider failure does not count as a passing language-understanding case merely because the fallback left data unchanged.


This report checks the backend with authored intent proposals. It does NOT measure AI language understanding. The actual orchestrator, signed production webhook and isolated PostgreSQL persistence are exercised, with fake outbound delivery and no WhatsApp sends.

## Results

| Check | Result |
| --- | --- |
| Real model calls, including retries | 0 |
| Turns supplied with authored intents | 1141 |
| Turns handled by production deterministic routes | 5179 |
| Provider-failure turns | 0 |
| Follow-up operation checks passed | 3120/3120 |
| Turns with unintended writes or wrong persisted values | 0 |
| Turns with response-quality failures | 0 |

A passing write check verifies actual saved rows, including set count, load, reps, units, exercise identity and preservation of earlier sets. Read-only and clarification turns must preserve workout facts. Permanent changes must wait for confirmation and update the saved template; they must preserve the current workout snapshot. Duplicate delivery must produce one logical response and one send.

Response checks require relevant plan/exercise names, meaningful questions, saved-value acknowledgements and completion status. These are authored task-specific checks, not a subjective human rating or a guarantee for every possible utterance.

## Scenario families

| Family | Passed | Failed |
| --- | ---: | ---: |
| alias-confirmation-followup | 80 | 0 |
| ambiguous-exercise-followup | 80 | 0 |
| ambiguous-field-followup | 80 | 0 |
| analytics-questions | 80 | 0 |
| cancel-pending-change | 80 | 0 |
| coaching-boundary | 80 | 0 |
| continue-after-finish-question | 80 | 0 |
| delete-last-set-followup | 80 | 0 |
| discard-confirmation-followup | 80 | 0 |
| duplicate-delivery | 80 | 0 |
| extra-set-followup | 80 | 0 |
| factual-plan-and-state | 80 | 0 |
| finish-completed-followup | 80 | 0 |
| finish-incomplete-followup | 80 | 0 |
| history-questions | 80 | 0 |
| idle-start-and-log | 80 | 0 |
| invalid-set-does-not-write | 80 | 0 |
| named-exercise-set | 80 | 0 |
| natural-delete-followup | 80 | 0 |
| natural-multiple-sets | 80 | 0 |
| natural-reps-correction | 80 | 0 |
| natural-single-set | 80 | 0 |
| partial-load-followup | 80 | 0 |
| permanent-confirmation-followup | 80 | 0 |
| policy-bypass-does-not-write | 80 | 0 |
| proposed-start-followup | 80 | 0 |
| reject-permanent-change | 80 | 0 |
| replacement-scope-followup | 80 | 0 |
| replacement-target-followup | 80 | 0 |
| return-to-exercise | 80 | 0 |
| same-load-followup | 80 | 0 |
| social-and-help | 80 | 0 |
| unknown-exercise-followup | 80 | 0 |

## Corrections made during the audit

- Natural set logging now acknowledges the exact saved values instead of a generic applied message.
- Explicit counts such as three completed bench sets preserve the full set count.
- Invalid semantic sets, including zero reps, receive an explanation without a failed webhook or a write.
- Explicit load-only statements retain the load and ask for reps; the user's reply records the completed set.
- Named-exercise logging validates that exercise's saved load convention and acknowledges the actual active exercise.
- Complete alias requests proceed to a locally validated confirmation even when the model flags clarification.
- Private aliases on shared exercise identities no longer invalidate another user's confirmation. Private-identity version and stale-target checks remain enforced.
- Temporary interpretation failures explain that the request could not be processed and workout data stayed unchanged.

## Failures

No failures were observed in these runs.

## Evidence and reproduction

- [controlled-full summary](evaluation-runs/user-scale/controlled-full/summary.json), [per-turn results and write evidence](evaluation-runs/user-scale/controlled-full/cases.jsonl), [authored corpus](evaluation-runs/user-scale/controlled-full/corpus.json). Prompt: intent-interpreter.prompt.v14; SHA-256: c495cc94d040209f3055bc20f84e066f693a9df72999f86d08e9838de2cbd977.

Run with a disposable TEST_DATABASE_URL, a configured GEMINI_API_KEY, and RUN_SCALE_CONVERSATION_EVAL=1. SCALE_VARIANTS controls variants per family; SCALE_FAMILIES and SCALE_CASE_IDS select targeted reruns. SCALE_AI_INTERVAL_MS controls provider pacing. The suite never uses DATABASE_URL for test persistence.

```bash
RUN_SCALE_CONVERSATION_EVAL=1 TEST_DATABASE_URL=postgresql://USER@127.0.0.1:56432/workout_flow_test \
  node --env-file=.env node_modules/vitest/vitest.mjs run tests/postgres/conversation-scale.test.ts --maxWorkers=1 --minWorkers=1
```

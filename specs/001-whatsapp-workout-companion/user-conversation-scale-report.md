# User conversation and write audit

Generated: 2026-10-30T08:14:41.793Z

Audited **2,319 scenarios**, **5,543 evaluated turns**, and **740 distinct user messages**. 2,310 scenarios passed (99.61%); 9 failed.

There were 3,191 raw scenario evaluations, including 872 reruns. Final case results use the latest evaluation for each scenario ID. Earlier failures remain in their original artifacts; 38 raw evaluations failed before any later correction or rerun. A provider failure does not count as a passing language-understanding case merely because the fallback left data unchanged.

**Live-AI audit remains incomplete.** At report generation the worker had 2310/2640 passing scenarios, with 330 pending. Worker status: RUNNING. Next attempt: not scheduled. See [current automatic-resume status](evaluation-runs/user-scale/automatic-resume.json).
The model was Gemini, using the actual structured interpreter and signed production webhook. All persistent effects were checked in an isolated PostgreSQL schema. Outbound delivery used a fake transport; no real WhatsApp messages were sent. Cases include generated numeric/profile variants and repeated wording in different contexts, not thousands of independently authored phrases. The evaluation runner paces provider requests and retries transient failures up to three times; provider retry counts are reported separately. This is not a production latency or load benchmark.

## Results

| Check | Result |
| --- | --- |
| Real model calls, including retries | 1415 |
| Turns requiring AI interpretation | 985 |
| Turns handled by production deterministic routes | 4558 |
| Provider-failure turns | 4 |
| Follow-up operation checks passed | 2729/2730 |
| Turns with unintended writes or wrong persisted values | 0 |
| Turns with response-quality failures | 9 |

A passing write check verifies actual saved rows, including set count, load, reps, units, exercise identity and preservation of earlier sets. Read-only and clarification turns must preserve workout facts. Permanent changes must wait for confirmation and update the saved template; they must preserve the current workout snapshot. Duplicate delivery must produce one logical response and one send.

Response checks require relevant plan/exercise names, meaningful questions, saved-value acknowledgements and completion status. These are authored task-specific checks, not a subjective human rating or a guarantee for every possible utterance.

## Scenario families

| Family | Passed | Failed |
| --- | ---: | ---: |
| alias-confirmation-followup | 70 | 0 |
| ambiguous-exercise-followup | 70 | 0 |
| ambiguous-field-followup | 70 | 0 |
| analytics-questions | 66 | 4 |
| cancel-pending-change | 70 | 0 |
| coaching-boundary | 70 | 0 |
| continue-after-finish-question | 70 | 0 |
| delete-last-set-followup | 70 | 0 |
| discard-confirmation-followup | 70 | 0 |
| duplicate-delivery | 70 | 0 |
| extra-set-followup | 70 | 0 |
| factual-plan-and-state | 70 | 0 |
| finish-completed-followup | 70 | 0 |
| finish-incomplete-followup | 70 | 0 |
| history-questions | 70 | 0 |
| idle-start-and-log | 70 | 0 |
| invalid-set-does-not-write | 70 | 0 |
| named-exercise-set | 70 | 1 |
| natural-delete-followup | 70 | 0 |
| natural-multiple-sets | 70 | 1 |
| natural-reps-correction | 70 | 1 |
| natural-single-set | 70 | 1 |
| partial-load-followup | 74 | 0 |
| permanent-confirmation-followup | 69 | 1 |
| policy-bypass-does-not-write | 70 | 0 |
| proposed-start-followup | 70 | 0 |
| reject-permanent-change | 70 | 0 |
| replacement-scope-followup | 70 | 0 |
| replacement-target-followup | 70 | 0 |
| return-to-exercise | 70 | 0 |
| same-load-followup | 71 | 0 |
| social-and-help | 70 | 0 |
| unknown-exercise-followup | 70 | 0 |

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

- **analytics-questions-038**: RESPONSE_NOT_RELEVANT. User: "count my completed workouts this month please". Response: "*📈 Your training insights*\n\nPlease ask for your overall completed workout count this month.".
- **analytics-questions-058**: RESPONSE_NOT_RELEVANT. User: "count my completed workouts this month please". Response: "*📈 Your training insights*\n\nPlease ask for your overall completed workout count this month.".
- **permanent-confirmation-followup-062**: CONFIRMED_ROUTINE_WRITE_MISSING, RESPONSE_DID_NOT_ACKNOWLEDGE_REPLACEMENT. User: "yes". Response: "*💬 Next step*\n\nConfirmation expired. Request the change again.".
- **analytics-questions-066**: RESPONSE_NOT_RELEVANT. User: "count my completed workouts this month please". Response: "*📈 Your training insights*\n\nPlease ask for your overall completed workout count this month.".
- **analytics-questions-070**: RESPONSE_NOT_RELEVANT. User: "count my completed workouts this month please". Response: "*📈 Your training insights*\n\nPlease ask for your overall completed workout count this month.".
- **natural-single-set-071**: WRONG_SET_COUNT, RESPONSE_DID_NOT_ACKNOWLEDGE_WRITE, PROVIDER_UNAVAILABLE. User: "I've just done 5 reps with 45 kg". Response: "*🛠️ Please try again*\n\nI couldn't process that right now. Your workout data is unchanged. You're on Barbell Bench Press.\n\nSend a set like 45kg 8, say NEXT, change the exercise, or say DONE.".
- **named-exercise-set-071**: WRONG_SET_COUNT, RESPONSE_DID_NOT_ACKNOWLEDGE_WRITE, WRONG_NAMED_EXERCISE, RESPONSE_WRONG_EXERCISE_CONTEXT, PROVIDER_UNAVAILABLE. User: "I've just done 5 reps with 45kg on lat pulldown". Response: "*🛠️ Please try again*\n\nI couldn't process that right now. Your workout data is unchanged. You're on Barbell Bench Press.\n\nSend a set like 45kg 8, say NEXT, change the exercise, or say DONE.".
- **natural-reps-correction-071**: WRONG_CORRECTION_WRITE, RESPONSE_DID_NOT_ACKNOWLEDGE_CORRECTION, PROVIDER_UNAVAILABLE. User: "actully last was 5". Response: "*🛠️ Please try again*\n\nI couldn't process that right now. Your workout data is unchanged. You're on Barbell Bench Press.\n\nSend a set like 45kg 8, say NEXT, change the exercise, or say DONE.".
- **natural-multiple-sets-071**: WRONG_SET_COUNT, RESPONSE_DID_NOT_ACKNOWLEDGE_WRITE, PROVIDER_UNAVAILABLE. User: "log my three completed bench sets: 45kg for 5 each". Response: "*🛠️ Please try again*\n\nI couldn't process that right now. Your workout data is unchanged. You're on Barbell Bench Press.\n\nSend a set like 45kg 8, say NEXT, change the exercise, or say DONE.".

## Evidence and reproduction

- [full-v1 summary](evaluation-runs/user-scale/full-v1/summary.json), [per-turn results and write evidence](evaluation-runs/user-scale/full-v1/cases.jsonl), [authored corpus](evaluation-runs/user-scale/full-v1/corpus.json). Prompt: intent-interpreter.prompt.v14; SHA-256: c495cc94d040209f3055bc20f84e066f693a9df72999f86d08e9838de2cbd977.
- [auto-2026-10-29T05-10-28-789Z summary](evaluation-runs/user-scale/auto-2026-10-29T05-10-28-789Z/summary.json), [per-turn results and write evidence](evaluation-runs/user-scale/auto-2026-10-29T05-10-28-789Z/cases.jsonl), [authored corpus](evaluation-runs/user-scale/auto-2026-10-29T05-10-28-789Z/corpus.json). Prompt: intent-interpreter.prompt.v14; SHA-256: c495cc94d040209f3055bc20f84e066f693a9df72999f86d08e9838de2cbd977.
- [auto-2026-10-29T07-00-59-806Z summary](evaluation-runs/user-scale/auto-2026-10-29T07-00-59-806Z/summary.json), [per-turn results and write evidence](evaluation-runs/user-scale/auto-2026-10-29T07-00-59-806Z/cases.jsonl), [authored corpus](evaluation-runs/user-scale/auto-2026-10-29T07-00-59-806Z/corpus.json). Prompt: intent-interpreter.prompt.v15; SHA-256: 4492992172149af5d3d8281e5387f4740564cac23580ab13eba4ebd69ea38720.
- [auto-2026-10-30T07-00-59-389Z summary](evaluation-runs/user-scale/auto-2026-10-30T07-00-59-389Z/summary.json), [per-turn results and write evidence](evaluation-runs/user-scale/auto-2026-10-30T07-00-59-389Z/cases.jsonl), [authored corpus](evaluation-runs/user-scale/auto-2026-10-30T07-00-59-389Z/corpus.json). Prompt: intent-interpreter.prompt.v15; SHA-256: 4492992172149af5d3d8281e5387f4740564cac23580ab13eba4ebd69ea38720.
- [load-only-regression summary](evaluation-runs/user-scale/load-only-regression/summary.json), [per-turn results and write evidence](evaluation-runs/user-scale/load-only-regression/cases.jsonl), [authored corpus](evaluation-runs/user-scale/load-only-regression/corpus.json). Prompt: intent-interpreter.prompt.v14; SHA-256: c495cc94d040209f3055bc20f84e066f693a9df72999f86d08e9838de2cbd977.

Run with a disposable TEST_DATABASE_URL, a configured GEMINI_API_KEY, and RUN_SCALE_CONVERSATION_EVAL=1. SCALE_VARIANTS controls variants per family; SCALE_FAMILIES and SCALE_CASE_IDS select targeted reruns. SCALE_AI_INTERVAL_MS controls provider pacing. The suite never uses DATABASE_URL for test persistence.

```bash
RUN_SCALE_CONVERSATION_EVAL=1 TEST_DATABASE_URL=postgresql://USER@127.0.0.1:56432/workout_flow_test \
  node --env-file=.env node_modules/vitest/vitest.mjs run tests/postgres/conversation-scale.test.ts --maxWorkers=1 --minWorkers=1
```

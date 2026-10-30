import { intentPromptV12 } from "./intent-prompt-v12.js";

export const intentPromptV13 = `${intentPromptV12}

Distinguish a request to do a future set from a report of a completed set.
"i have to do one set more", "another set", "let me squeeze in an extra round"
and "i want to do 4set for barbell bench" are PREPARE_SET, with exerciseRef
only when a target is supplied. PREPARE_SET asks for the actual load and completed
reps; it never logs a completed set, copies previous values or changes the routine.
This remains supported after the planned set count has been reached.
"i want to do one set more for the barbell bench" while on another exercise is
PREPARE_SET with exerciseRef "barbell bench". Use the exercise reference the user
actually supplied; the backend resolves abbreviations and ambiguity.

"i want to go back to barbell bench", "take me back to bench" and equivalent
natural requests are CHANGE_ACTIVE_EXERCISE, not replacement, reordering or a
routine update. Previously recorded sets stay recorded and more sets can be
logged on that exercise. "go back to the previous exercise" is PREVIOUS_EXERCISE.
When a workout is proposed, "lets start", "let's start", "let us begin" and
equivalent acceptance mean START_WORKOUT without a sessionRef or routineRef;
do not interpret the acceptance phrase as the name of a new workout.

Handle unfamiliar wording by its meaning and context, rather than requiring an
exact example phrase. Missing load/reps for a future set is PREPARE_SET; an
ambiguous exercise must still be clarified. Never invent completed workout data.`;

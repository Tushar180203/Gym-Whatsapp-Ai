import { intentPromptV11 } from "./intent-prompt-v11.js";

// v12 clarifies how natural replies resolve a persisted finish-choice question.
export const intentPromptV12 = `${intentPromptV11}

When conversationMode is WORKOUT_FINISH_PENDING, interpret "save i am done" and
"save it im done" as FINISH_WORKOUT with requestedCompletion COMPLETE;
"save incomplete" as INCOMPLETE; "continue" or "keep going" as CONTINUE; and
"discard" as DISCARD. Treat these as answers to the pending choice, not standalone
commands. Outside that pending context, do not infer a completion choice from a
vague "save" phrase. A proposed choice is advisory: the application checks the
user's wording and pending state before applying it.`;

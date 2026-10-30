import { intentPromptV13 } from "./intent-prompt-v13.js";

export const intentPromptV14 = `${intentPromptV13}

Latest/last/most-recent set in an ACTIVE workout means the user's latest recorded
set in that active workout. For "delete my latest set", "please remove the last
set I just recorded", and equivalent wording use DELETE_SET with targetRef
last-active-set. Never use the completed: prefix merely because that set's reps
were completed. That prefix refers only to an explicitly finished past workout.
If the user explicitly names an exercise or ordinal, preserve that target instead
of substituting last-active-set. The backend retains all confirmation decisions.

"three completed bench sets" still explicitly states three sets. Completion
adjectives and exercise names between the count and sets do not erase that count.
An extra future set remains PREPARE_SET and must not become a completed record.

When the user explicitly logs a different named exercise, use that exercise's
loadSemantics from workoutContext.exercises, not the currently active exercise's
convention. Omit a convention rather than copying one from the wrong exercise.
The backend validates and applies the target exercise's saved convention.

For a complete alias request such as "please call Barbell Bench Press bench
buddy 2", preserve "bench buddy 2" as the alias and the named saved exercise as
exerciseRef. Digits can be part of an alias. A required confirmation is not a
missing-information clarification: use requiresConfirmation for protected alias
creation; requiresClarification is for a genuinely missing or ambiguous target.`;

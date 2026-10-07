import type { ProposedAction } from "../../../contracts/src/ai/actions.js";
import { hasSetNotation } from "./set-parser.js";
export type Us4Action = ProposedAction
  | { type: "REORDER_EXERCISE"; exerciseRef: string; ordinal: number }
  | { type: "SKIP_SET" }
  | { type: "NEXT_EXERCISE" }
  | { type: "LOG_CONTEXT_SETS"; exerciseRef: string; setText: string }
  | { type: "DELETE_GROUP"; kind: "EXERCISE" | "WORKOUT" | "HISTORY"; reference: string }
  | { type: "MERGE_IDENTITIES"; fromExerciseRef: string; toExerciseRef: string };
export type ReplaceWorkoutAction = { type: "REPLACE_WORKOUT"; sessionRef: string };

export function parseUs4Message(text: string): Us4Action | undefined {
  const value = text.trim();
  if (/^next$/i.test(value)) return { type: "NEXT_EXERCISE" };
  if (/^delete last set$/i.test(value)) return { type: "DELETE_SET", targetRef: "last-active-set" };
  if (/^skip (?:this |a )?set$/i.test(value)) return { type: "SKIP_SET" };
  let match = value.match(/^actually (?:that|it) was (\d+)$/i);
  const sequence = value.match(/^(?:from now on|permanently) (?:move|reorder) session (.+?) to (first|\d+)$/i);
  if (sequence) return { type: "UPDATE_ROUTINE_REQUEST", scope: "PERMANENT_ROUTINE", requestedChange: { operation: "REORDER_SESSION", sessionRef: sequence[1]!, newOrderRef: sequence[2]! } };
  if (match) return { type: "CORRECT_SET", replacement: { reps: Number(match[1]) } };
  match = value.match(/^(.+?) set (\d+) was actually (\d+)$/i);
  if (match) {
    const completed = /^completed /i.test(match[1]!);
    const exerciseRef = match[1]!.replace(/^completed /i, "");
    return { type: "CORRECT_SET", targetRef: `${completed ? "completed:" : ""}exercise:${exerciseRef}:set:${match[2]}`, replacement: { reps: Number(match[3]) } };
  }
  match = value.match(/^delete (.+?) set (\d+)$/i);
  if (match) return { type: "DELETE_SET", targetRef: `exercise:${match[1]}:set:${match[2]}` };
  match = value.match(/^(?:switch to|use|go back to) (.+)$/i);
  if (match) return { type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: match[1]! };
  match = value.match(/^do (.+?) first$/i);
  if (match) return { type: "REORDER_EXERCISE", exerciseRef: match[1]!, ordinal: 1 };
  match = value.match(/^move (.+?) to (\d+)$/i);
  if (match) return { type: "REORDER_EXERCISE", exerciseRef: match[1]!, ordinal: Number(match[2]) };
  match = value.match(/^skip (.+?) (?:today|this session)$/i);
  if (match) return { type: "SKIP_EXERCISE", exerciseRef: match[1]!, scope: "SESSION_ONLY" };
  match = value.match(/^(from now on )?replace (.+?) with (.+?)( today| permanently)?$/i);
  if (match) return { type: "REPLACE_EXERCISE", fromExerciseRef: match[2]!, toExerciseRef: match[3]!, scope: match[1] || /permanently/i.test(match[4] ?? "") ? "PERMANENT_ROUTINE" : match[4] ? "SESSION_ONLY" : "AMBIGUOUS" };
  match = value.match(/^add (.+?)( today| permanently)?$/i);
  if (match) return { type: "ADD_EXERCISE", exerciseRef: match[1]!, scope: /permanently/i.test(match[2] ?? "") ? "PERMANENT_ROUTINE" : match[2] ? "SESSION_ONLY" : "AMBIGUOUS" };
  match = value.match(/^delete (exercise|workout|history) (.+)$/i);
  if (match) return { type: "DELETE_GROUP", kind: match[1]!.toUpperCase() as "EXERCISE" | "WORKOUT" | "HISTORY", reference: match[2]! };
  match = value.match(/^merge identity (.+?) into (.+)$/i);
  if (match) return { type: "MERGE_IDENTITIES", fromExerciseRef: match[1]!, toExerciseRef: match[2]! };
  match = value.match(/^([a-z][a-z '-]+?)\s+(\d+(?:\.\d+)?\s*(?:kg|lb)?\s*(?:x|for|each)\s*\d+.*)$/i);
  if (match && hasSetNotation(match[2]!) && !/^(actually|correct|delete|replace|add|skip|change|fix|make|set|completed)\b/i.test(match[1]!)) return { type: "LOG_CONTEXT_SETS", exerciseRef: match[1]!, setText: match[2]! };
  return undefined;
}

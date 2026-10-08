import type { ConversationContext, ConversationState, ConversationSet } from "./state.js";
export function formatSetFact(set: ConversationSet): string {
  const convention = ({ PER_HAND_PER_SIDE: " per hand/side", TOTAL_LOAD: " total", MACHINE_STACK: " stack", UNSPECIFIED_DEFAULT: "" } as Record<string, string>)[set.semantics] ?? "";
  return `${set.load} ${set.unit.toLowerCase()}${convention} x ${set.reps}`;
}

export type ConversationResponse =
  | { type: "DomainResult" | "HistoryFact" | "Plan" | "Confirmation"; body: string }
  | { type: "Clarification"; question: string }
  | { type: "SetLogged"; body: string; exerciseName?: string }
  | { type: "Recovery" | "Help" | "Greeting"; context: ConversationContext; state: ConversationState }
  | { type: "Cancelled" } | { type: "Expired" } | { type: "Stale" } | { type: "OlderEvent" };
export function formatConversationResponse(response: ConversationResponse): string {
  if ("body" in response) return response.type === "SetLogged" && response.exerciseName ? `${response.body}\nStay on ${response.exerciseName}; send another set, NEXT or DONE.` : response.body;
  if (response.type === "Clarification") return response.question;
  if (response.type === "Cancelled") return "Change cancelled. Your recorded workout is unchanged.";
  if (response.type === "Expired") return "That change request expired. Tell me the change again.";
  if (response.type === "Stale") return "That workout has changed, so I won't apply the old request. Tell me what you'd like to change now.";
  if (response.type === "OlderEvent") return "That reply arrived after a newer message. I haven't applied it; send your current request again.";
  const { context, state } = response;
  if (state.stack.length && state.lastQuestion) return `${response.type === "Greeting" ? "I'm here. " : ""}${state.lastQuestion}`;
  const exercise = context.exercises.find(e => e.id === context.workout?.activeExerciseId);
  if (state.mode === "WORKOUT_FINISH_PENDING") return "Save completed, save incomplete, continue, or discard?";
  if (state.mode === "WORKOUT_PROPOSED") return "Your workout is proposed. Reply START to begin, choose another workout, change an exercise today, or rest.";
  if (context.workout && exercise) return `${response.type === "Recovery" ? "I didn't quite get that. " : "I'm here. "}You're on ${exercise.name}. Log a set like 45x10, say NEXT, or DONE.`;
  return `${response.type === "Recovery" ? "I can help with your workouts, routine and training history. " : "Hi. "}Send START or ask what's on your plan today.`;
}

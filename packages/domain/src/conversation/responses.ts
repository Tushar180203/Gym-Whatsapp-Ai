import { formatWhatsAppMessage } from "../messaging/response-layout.js";
import type { ConversationContext, ConversationState, ConversationSet } from "./state.js";
export function formatSetFact(set: ConversationSet): string {
  const convention = ({ PER_HAND_PER_SIDE: " per hand/side", TOTAL_LOAD: " total", MACHINE_STACK: " stack", UNSPECIFIED_DEFAULT: "" } as Record<string, string>)[set.semantics] ?? "";
  return `${set.load} ${set.unit.toLowerCase()}${convention} x ${set.reps}`;
}

export type ConversationResponse =
  | { type: "DomainResult" | "HistoryFact" | "AnalyticsFact" | "CurrentState" | "Plan" | "Confirmation" | "CoachingBoundary" | "SystemError"; body: string }
  | { type: "Clarification"; question: string }
  | { type: "SetLogged"; body: string; exerciseName?: string }
  | { type: "Recovery" | "ProviderError" | "Help" | "Greeting"; context: ConversationContext; state: ConversationState }
  | { type: "Cancelled" } | { type: "Expired" } | { type: "Stale" } | { type: "OlderEvent" };
export function formatConversationResponse(response: ConversationResponse): string {
  if ("body" in response) return response.type === "SetLogged" && response.body.startsWith("Logged") && response.exerciseName ? `${response.body}\nStay on ${response.exerciseName}; send another set, NEXT or DONE.` : response.body;
  if (response.type === "Clarification") return response.question;
  if (response.type === "Cancelled") return "Change cancelled. Your recorded workout is unchanged.";
  if (response.type === "Expired") return "That change request expired. Tell me the change again.";
  if (response.type === "Stale") return "That workout has changed, so I won't apply the old request. Tell me what you'd like to change now.";
  if (response.type === "OlderEvent") return "That reply arrived after a newer message. I haven't applied it; send your current request again.";
  const { context, state } = response;
  if (state.stack.length && state.lastQuestion) return `${response.type === "Greeting" ? "I'm here. " : ""}${state.lastQuestion}`;
  const exercise = context.exercises.find(e => e.id === context.workout?.activeExerciseId);
  if (context.workout?.status === "PAUSED") return "Your workout is paused. Send RESUME to continue.";
  if (state.mode === "WORKOUT_FINISH_PENDING") return "Save completed, save incomplete, continue, or discard?";
  if (state.mode === "WORKOUT_PROPOSED") return "Your workout is proposed. Reply START to begin, choose another workout, change an exercise today, or rest.";
  if (context.workout && exercise) return `${response.type === "ProviderError" ? "I couldn't process that right now. Your workout data is unchanged. " : response.type === "Recovery" ? "I didn't quite get that. " : "I'm here. "}You're on ${exercise.name}. Send a set like 45kg 8, say NEXT, change the exercise, or say DONE.`;
  return `${response.type === "Recovery" || response.type === "ProviderError" ? "I can help with your workouts, routine and training history. " : "Hi. "}Send START or ask what's on your plan today.`;
}

export function responseCategory(response: ConversationResponse): string {
  switch (response.type) {
    case "Plan": return "PLAN_FACT";
    case "HistoryFact": return "HISTORY_FACT";
    case "AnalyticsFact": return "ANALYTICS_FACT";
    case "CurrentState": return "CURRENT_STATE";
    case "CoachingBoundary": return "COACHING_BOUNDARY";
    case "SystemError": case "ProviderError": return "SYSTEM_ERROR";
    case "Clarification": return "PENDING_QUESTION";
    case "Confirmation": return "CONFIRMATION_REQUIRED";
    case "SetLogged": return response.body.startsWith("Logged") ? "SETS_LOGGED" : "RECOVERY";
    case "Greeting": case "Help": return "CONTEXTUAL_HELP";
    case "DomainResult": return "DOMAIN_RESULT";
    default: return "RECOVERY";
  }
}

export type ResponseCategory = "WORKOUT_PROPOSAL" | "WORKOUT_STARTED" | "WORKOUT_RESUMED" | "WORKOUT_FINISHED" | "SET_LOGGED" | "SETS_LOGGED" | "SET_CORRECTED" | "CURRENT_STATE" | "PLAN_FACT" | "HISTORY_FACT" | "ANALYTICS_FACT" | "EXERCISE_CHANGED" | "PENDING_QUESTION" | "CONFIRMATION_REQUIRED" | "CONTEXTUAL_HELP" | "RECOVERY" | "COACHING_BOUNDARY" | "SYSTEM_ERROR" | "DOMAIN_RESULT";
export type DomainOutcome = { category: ResponseCategory; effect: "READ_ONLY" | "APPLIED" | "CLARIFIED" | "CONFIRMATION_REQUIRED" | "REPLIED" };
export type ResponsePlan = { category: ResponseCategory; body: string };
export function planConversationResponse(response: ConversationResponse, outcome?: DomainOutcome): ResponsePlan {
  const direct = responseCategory(response) as ResponseCategory;
  const category = ["DomainResult", "SetLogged", "Confirmation"].includes(response.type) && outcome ? outcome.category : direct;
  const body = formatConversationResponse(response)
    .replace(/proposed action/gi, "change")
    .replace(/pending scope/gi, "today or routine choice")
    .replace(/unsupported structured command|invalid action/gi, "I couldn't apply that request")
    .replace(/resolver/gi, "exercise lookup")
    .replace(/load semantics/gi, "load convention");
  return { category, body };
}
export function formatWhatsAppPlan(plan: ResponsePlan): string { return formatWhatsAppMessage(plan.body, plan.category); }

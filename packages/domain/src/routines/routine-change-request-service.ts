import type { RoutineChange } from "../../../contracts/src/ai/actions.js";
export function routineChangePolicy(change: RoutineChange, scope: "PERMANENT_ROUTINE" | "AMBIGUOUS"): "CONFIRM" | "CLARIFY" {
  return scope === "AMBIGUOUS" ? "CLARIFY" : "CONFIRM";
}

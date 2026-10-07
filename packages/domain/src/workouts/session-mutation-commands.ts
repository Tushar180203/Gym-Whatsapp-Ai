import type { ChangeScope } from "../../../contracts/src/ai/actions.js";

export function scopePolicy(scope: ChangeScope): "SESSION" | "CONFIRM" | "CLARIFY" {
  return scope === "SESSION_ONLY" ? "SESSION" : scope === "PERMANENT_ROUTINE" ? "CONFIRM" : "CLARIFY";
}
export function reorderedIds(ids: string[], id: string, ordinal: number): string[] {
  if (!ids.includes(id) || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > ids.length) throw new Error("Specify a valid exercise order.");
  const rest = ids.filter(value => value !== id);
  rest.splice(ordinal - 1, 0, id);
  return rest;
}

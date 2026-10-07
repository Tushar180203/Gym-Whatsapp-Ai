import type { LoadSemantics, WeightUnit, SetInput } from "../../../contracts/src/index.js";
export type SetValues = { loadValue: number; weightUnit: WeightUnit; loadSemantics: LoadSemantics; reps: number };

export function correctedSet(before: SetValues, replacement: Partial<SetInput>, userInput?: string): SetValues {
  const keys = Object.keys(replacement);
  if (!keys.length || keys.some(key => !["reps", "loadValue", "weightUnit", "loadSemantics"].includes(key))) throw new Error("Specify reps, load, unit or load semantics to correct.");
  const after = { ...before, ...replacement } as SetValues;
  if (!Number.isInteger(after.reps) || after.reps <= 0 || !Number.isFinite(after.loadValue) || after.loadValue < 0) throw new Error("Provide valid numeric reps and load.");
  if (userInput !== undefined) {
    const numbers = (userInput.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    for (const value of [replacement.reps, replacement.loadValue]) if (value !== undefined && !numbers.includes(value)) throw new Error("Please provide the corrected numeric value explicitly.");
    if (replacement.weightUnit && !new RegExp(`\\b${replacement.weightUnit}\\b`, "i").test(userInput)) throw new Error("Please specify the corrected unit explicitly.");
    if (replacement.loadSemantics && !/each|per.hand|per.side|total|stack|default/i.test(userInput)) throw new Error("Please specify the corrected load semantics explicitly.");
  }
  return after;
}

export function correctionNeedsConfirmation(workoutStatus: string, source: "WHATSAPP" | "WEB"): boolean {
  return source === "WHATSAPP" && ["COMPLETED", "INCOMPLETE"].includes(workoutStatus);
}

export type CompletionIntent = "COMPLETE" | "INCOMPLETE" | "CONTINUE" | "DISCARD";
export type PlannedProgress = { status: string; plannedSets: number | null; recordedSets: number; skippedSets: number };

export function requiresCompletionChoice(exercises: readonly PlannedProgress[], recordedSets: number): boolean {
  return recordedSets === 0 || exercises.some(exercise => !["SKIPPED", "REPLACED", "DELETED", "COMPLETED"].includes(exercise.status)
    && (exercise.plannedSets === null || exercise.recordedSets + exercise.skippedSets < exercise.plannedSets));
}

export function parseCompletionIntent(text: string): CompletionIntent | "REQUEST" | undefined {
  const value = text.trim().toLowerCase();
  if (["done", "finish", "finish workout"].includes(value)) return "REQUEST";
  if (["save completed", "save as completed"].includes(value)) return "COMPLETE";
  if (["save incomplete", "save as incomplete"].includes(value)) return "INCOMPLETE";
  if (["continue", "continue workout"].includes(value)) return "CONTINUE";
  if (["discard", "discard workout"].includes(value)) return "DISCARD";
  return undefined;
}

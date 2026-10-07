import type { PerformanceSet } from "../../../analytics/src/previous-performance-service.js";

export function formatPreviousPerformance(name: string, plannedSets: number | null, repMin: number | null, repMax: number | null, sets: PerformanceSet[] | null): string {
  const target = [plannedSets === null ? null : `${plannedSets} sets`, repMin === null ? null : `${repMin}${repMax !== null && repMax !== repMin ? `-${repMax}` : ""} reps`].filter(Boolean).join(", ");
  return `${name}${target ? ` - ${target}` : ""}\n${sets ? `Last time: ${sets.map(set => `${set.loadValue} ${set.weightUnit} ${semanticLabel(set.loadSemantics)} x ${set.reps}`).join(", ")}` : "No previous record."}`;
}

export function semanticLabel(value: string): string {
  return ({ PER_HAND_PER_SIDE: "each", TOTAL_LOAD: "total", MACHINE_STACK: "stack", UNSPECIFIED_DEFAULT: "default" } as Record<string, string>)[value] ?? value;
}

export function formatCompletionSummary(input: { name: string; status: string; exercises: number; sets: number; durationSeconds: number | null; records: string[] }): string {
  const duration = input.durationSeconds === null ? "" : ` - ${Math.floor(input.durationSeconds / 60)}m ${input.durationSeconds % 60}s`;
  return `${input.name}: ${input.status.toLowerCase()}\n${input.exercises} exercises, ${input.sets} sets${duration}${input.records.length ? `\nPR: ${input.records.join("; ")}` : ""}`;
}

import type { PerformanceSet } from "../../../analytics/src/previous-performance-service.js";

export function formatPreviousPerformance(name: string, plannedSets: number | null, repMin: number | null, repMax: number | null, sets: PerformanceSet[] | null): string {
  const target = [plannedSets === null ? null : `${plannedSets} sets`, repMin === null ? null : `${repMin}${repMax !== null && repMax !== repMin ? `-${repMax}` : ""} reps`].filter(Boolean).join(", ");
  const previous = sets?.length
    ? sets.map(set => `${set.loadValue} ${set.weightUnit} ${semanticLabel(set.loadSemantics)} x ${set.reps}`)
    : [];
  const structured = ["*Current exercise*", name, ...(target ? [`Target: ${target}`] : []), "", "*Previous performance*",
    previous.length === 1 ? `Last time: ${previous[0]}` : previous.length ? `Last time:\n${previous.map(set => `• ${set}`).join("\n")}` : "No earlier sets recorded for this exercise yet."
  ].join("\n");
  return structured.length <= 4096 ? structured : `${name}${target ? ` - ${target}` : ""}\n${previous.length ? `Last time: ${previous.join(", ")}` : "No earlier sets recorded for this exercise yet."}`;
}

export function semanticLabel(value: string): string {
  return ({ PER_HAND_PER_SIDE: "each", TOTAL_LOAD: "total", MACHINE_STACK: "stack", UNSPECIFIED_DEFAULT: "default" } as Record<string, string>)[value] ?? value;
}

export function formatCompletionSummary(input: { name: string; status: string; exercises: number; sets: number; durationSeconds: number | null; records: string[] }): string {
  const structured = [`${input.name}: ${input.status.toLowerCase()}`, "", "*Session totals*", `Exercises: ${input.exercises}`, `Sets: ${input.sets}`,
    ...(input.durationSeconds === null ? [] : [`Duration: ${Math.floor(input.durationSeconds / 60)}m ${input.durationSeconds % 60}s`]),
    ...(input.records.length ? ["", "*Personal records*", ...input.records.map(record => `• ${record}`)] : [])
  ].join("\n");
  if (structured.length <= 4096) return structured;
  const duration = input.durationSeconds === null ? "" : ` - ${Math.floor(input.durationSeconds / 60)}m ${input.durationSeconds % 60}s`;
  return `${input.name}: ${input.status.toLowerCase()}\n${input.exercises} exercises, ${input.sets} sets${duration}${input.records.length ? `\nPR: ${input.records.join("; ")}` : ""}`;
}

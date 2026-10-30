import { comparableSets, type PerformanceQuery, type PerformanceSet } from "./previous-performance-service.js";

export function personalRecords(sets: readonly PerformanceSet[], query: PerformanceQuery): {
  highestLoad: PerformanceSet | null; highestRepsAtLoad: PerformanceSet[];
} {
  const comparable = comparableSets(sets, query).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id));
  let highestLoad: PerformanceSet | null = null;
  const byLoad = new Map<number, PerformanceSet>();
  for (const set of comparable) {
    if (!highestLoad || set.loadValue > highestLoad.loadValue) highestLoad = set;
    if (set.reps > (byLoad.get(set.loadValue)?.reps ?? -1)) byLoad.set(set.loadValue, set);
  }
  return { highestLoad, highestRepsAtLoad: [...byLoad.values()].sort((a, b) => a.loadValue - b.loadValue) };
}

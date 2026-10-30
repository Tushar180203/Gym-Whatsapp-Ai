import type { LoadSemantics, WeightUnit } from "../../contracts/src/domain/enums.js";

export type PerformanceSet = {
  id: string; userId: string; workoutId: string; sessionExerciseId: string; exerciseIdentityId: string;
  workoutStatus: string; status: string; occurredAt: Date; setIndex: number;
  loadValue: number; weightUnit: WeightUnit; loadSemantics: LoadSemantics; reps: number;
};
export type PerformanceQuery = {
  userId: string; exerciseIdentityId: string; weightUnit: WeightUnit; loadSemantics: LoadSemantics;
  excludeWorkoutId?: string;
};

export function comparableSets(sets: readonly PerformanceSet[], query: PerformanceQuery): PerformanceSet[] {
  return sets.filter(set => set.userId === query.userId && set.exerciseIdentityId === query.exerciseIdentityId
    && set.weightUnit === query.weightUnit && set.loadSemantics === query.loadSemantics
    && set.status === "RECORDED" && ["COMPLETED", "INCOMPLETE"].includes(set.workoutStatus)
    && set.workoutId !== query.excludeWorkoutId);
}

export function previousPerformance(sets: readonly PerformanceSet[], query: PerformanceQuery): PerformanceSet[] | null {
  const comparable = comparableSets(sets, query).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()
    || b.sessionExerciseId.localeCompare(a.sessionExerciseId));
  const latest = comparable[0];
  return latest ? comparable.filter(set => set.sessionExerciseId === latest.sessionExerciseId).sort((a, b) => a.setIndex - b.setIndex) : null;
}

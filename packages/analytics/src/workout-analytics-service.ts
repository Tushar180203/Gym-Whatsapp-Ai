import type { PerformanceSet } from "./previous-performance-service.js";
export type AnalyticsWorkout = { id: string; userId: string; templateId: string; name: string; status: string; trainedAt: Date };
export type MuscleClassification = { userId: string; exerciseIdentityId: string; muscleGroup: string; role: string; status: string };
export type AnalyticsInput = { userId: string; now: Date; workouts: AnalyticsWorkout[]; sets: PerformanceSet[]; classifications: MuscleClassification[] };
export const normalizedRef = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export function utcWeek(date: Date): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
export function validAnalyticsSets(input: AnalyticsInput): PerformanceSet[] {
  const workouts = new Set(input.workouts.filter(workout => workout.userId === input.userId && ["COMPLETED", "INCOMPLETE"].includes(workout.status) && workout.trainedAt <= input.now).map(workout => workout.id));
  return input.sets.filter(set => set.userId === input.userId && set.status === "RECORDED" && workouts.has(set.workoutId));
}
export function workoutAnalytics(input: AnalyticsInput) {
  const validWorkouts = input.workouts.filter(workout => workout.userId === input.userId && ["COMPLETED", "INCOMPLETE"].includes(workout.status) && workout.trainedAt <= input.now);
  const completed = validWorkouts.filter(workout => workout.status === "COMPLETED");
  const month = input.now.toISOString().slice(0, 7), week = utcWeek(input.now);
  const frequency = new Map<string, number>();
  for (const workout of completed) frequency.set(utcWeek(workout.trainedAt), (frequency.get(utcWeek(workout.trainedAt)) ?? 0) + 1);
  const sets = validAnalyticsSets(input);
  const dates = new Map(validWorkouts.map(workout => [workout.id, workout.trainedAt.toISOString()]));
  const muscles = new Map<string, { muscleGroup: string; ids: Set<string>; lastTrained: string | null }>();
  for (const classification of input.classifications.filter(row => row.userId === input.userId && row.role === "PRIMARY" && row.status === "CONFIRMED")) {
    const key = normalizedRef(classification.muscleGroup);
    const muscle = muscles.get(key) ?? { muscleGroup: classification.muscleGroup, ids: new Set<string>(), lastTrained: null };
    for (const set of sets.filter(row => row.exerciseIdentityId === classification.exerciseIdentityId)) {
      const date = dates.get(set.workoutId)!;
      if (!muscle.lastTrained || date > muscle.lastTrained) muscle.lastTrained = date;
      if (utcWeek(new Date(date)) === week) muscle.ids.add(set.id);
    }
    muscles.set(key, muscle);
  }
  const progression = sets.map(set => ({ id: set.id, workoutId: set.workoutId, exerciseIdentityId: set.exerciseIdentityId,
    date: dates.get(set.workoutId)!, setIndex: set.setIndex, loadValue: set.loadValue, weightUnit: set.weightUnit, loadSemantics: set.loadSemantics, reps: set.reps }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.setIndex - b.setIndex || a.id.localeCompare(b.id));
  const lastTrained = new Map<string, string>();
  for (const set of progression) if (set.date > (lastTrained.get(set.exerciseIdentityId) ?? "")) lastTrained.set(set.exerciseIdentityId, set.date);
  return { calendar: "UTC" as const, weekStarting: week, month, completedWorkoutCount: completed.length,
    monthlyWorkoutCount: completed.filter(workout => workout.trainedAt.toISOString().slice(0, 7) === month).length,
    frequency: [...frequency].map(([week, count]) => ({ week, count })).sort((a, b) => a.week.localeCompare(b.week)),
    muscles: [...muscles.values()].map(row => ({ muscleGroup: row.muscleGroup, weeklySets: row.ids.size, lastTrained: row.lastTrained })).sort((a, b) => a.muscleGroup.localeCompare(b.muscleGroup)),
    lastTrainedExercises: [...lastTrained].map(([exerciseIdentityId, date]) => ({ exerciseIdentityId, date })), progression };
}

import type { PerformanceSet } from "../previous-performance-service.js";
export const recorded = (overrides: Partial<PerformanceSet> = {}): PerformanceSet => ({
  id: "set", userId: "user", workoutId: "prior", sessionExerciseId: "occurrence", exerciseIdentityId: "incline",
  workoutStatus: "COMPLETED", status: "RECORDED", occurredAt: new Date("2026-10-01"),
  setIndex: 1, loadValue: 45, weightUnit: "LB", loadSemantics: "PER_HAND_PER_SIDE", reps: 10, ...overrides
});

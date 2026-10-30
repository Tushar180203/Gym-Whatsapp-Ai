import { describe, expect, it } from "vitest";
import { previousPerformance } from "./previous-performance-service.js";
import { recorded } from "./testing/recorded-set.js";
import { resolveExerciseIdentity } from "../../domain/src/exercises/unknown-exercise-flow.js";
const query = { userId: "user", exerciseIdentityId: "incline", weightUnit: "LB", loadSemantics: "PER_HAND_PER_SIDE", excludeWorkoutId: "current" } as const;
describe("exact comparable previous performance", () => {
  it("confirmed aliases resolve to the exact same history identity, not a similar exercise", () => {
    const identities = [{ id: "incline", name: "Incline Dumbbell Press" }, { id: "smith", name: "Smith Incline Press" }];
    expect(resolveExerciseIdentity("incline", identities, [{ identityId: "incline", alias: "incline" }])).toEqual({ status: "KNOWN", id: "incline" });
    expect(resolveExerciseIdentity("incline press", identities, [])).toEqual({ status: "UNKNOWN" });
    expect(resolveExerciseIdentity("incline", identities, [{ identityId: "smith", alias: "incline" }])).toEqual({ status: "CONFLICT" });
  });
  it("returns only the latest valid comparable occurrence and ordered sets", () => {
    const rows = [recorded(), recorded({ id: "new2", workoutId: "new", sessionExerciseId: "new", occurredAt: new Date("2026-10-02"), setIndex: 2, reps: 9 }), recorded({ id: "new1", workoutId: "new", sessionExerciseId: "new", occurredAt: new Date("2026-10-02"), setIndex: 1 })];
    expect(previousPerformance(rows, query)?.map(row => row.id)).toEqual(["new1", "new2"]);
  });
  it("never borrows similar identity, another owner, incompatible units/semantics, deleted or discarded sets, or the current workout", () => {
    const rows = [recorded({ exerciseIdentityId: "smith-incline" }), recorded({ userId: "other" }), recorded({ weightUnit: "KG" }), recorded({ loadSemantics: "TOTAL_LOAD" }), recorded({ status: "DELETED" }), recorded({ workoutStatus: "DISCARDED" }), recorded({ workoutStatus: "ACTIVE" }), recorded({ workoutId: "current" })];
    expect(previousPerformance(rows, query)).toBeNull();
  });
  it("includes incomplete recorded history and does not convert per-side values", () => {
    expect(previousPerformance([recorded({ workoutStatus: "INCOMPLETE" })], query)?.[0]?.loadValue).toBe(45);
  });
  it("chooses the later actual occurrence when an identity appears twice in one prior workout", () => {
    const rows = [recorded(), recorded({ id: "returned", sessionExerciseId: "returned", occurredAt: new Date("2026-10-01T01:00:00Z"), reps: 8 })];
    expect(previousPerformance(rows, query)?.map(set => set.id)).toEqual(["returned"]);
  });
});

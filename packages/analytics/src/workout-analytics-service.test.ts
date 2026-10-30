import { describe, expect, it } from "vitest";
import { workoutAnalytics } from "./workout-analytics-service.js";
import { recorded } from "./testing/recorded-set.js";
const now = new Date("2026-10-07T12:00:00Z");
const workouts = [{ id: "prior", userId: "user", name: "Push Day", templateId: "push", status: "COMPLETED", trainedAt: new Date("2026-10-05") }, { id: "partial", userId: "user", name: "Push Day", templateId: "push", status: "INCOMPLETE", trainedAt: now }];
const sets = [recorded({ occurredAt: now })];
describe("deterministic workout analytics", () => {
  it("counts only completed workouts for frequency/month/count and keeps UTC period boundaries", () => {
    const result = workoutAnalytics({ userId: "user", now, workouts: [...workouts, { ...workouts[0]!, id: "old", trainedAt: new Date("2026-09-30T23:59:59Z") }, { ...workouts[0]!, userId: "other" }, { ...workouts[0]!, status: "DISCARDED" }], sets, classifications: [] });
    expect(result.completedWorkoutCount).toBe(2); expect(result.monthlyWorkoutCount).toBe(1);
    expect(result.frequency).toEqual([{ week: "2026-09-28", count: 1 }, { week: "2026-10-05", count: 1 }]);
  });
  it("counts whole sets only for confirmed PRIMARY, deduplicates classification rows, excludes deleted/uncertain/secondary/foreign", () => {
    const classification = { userId: "user", exerciseIdentityId: "incline", muscleGroup: "Chest", role: "PRIMARY", status: "CONFIRMED" };
    const input = { userId: "user", now, workouts, sets: [...sets, recorded({ status: "DELETED" }), recorded({ userId: "other" })], classifications: [classification, classification, { ...classification, muscleGroup: "Shoulders", role: "SECONDARY" }, { ...classification, muscleGroup: "Arms", status: "UNCERTAIN" }] };
    expect(workoutAnalytics(input).muscles).toEqual([{ muscleGroup: "Chest", weeklySets: 1, lastTrained: "2026-10-05T00:00:00.000Z" }]);
    expect(workoutAnalytics({ ...input, classifications: [{ ...classification, muscleGroup: "Shoulders" }] }).muscles[0]?.muscleGroup).toBe("Shoulders");
  });
  it("progression and last-trained use only current valid sets, without converting loads or merging identities", () => {
    const result = workoutAnalytics({ userId: "user", now, workouts, sets: [recorded({ reps: 8 }), recorded({ id: "deleted", loadValue: 99, status: "DELETED" })], classifications: [] });
    expect(result.progression).toHaveLength(1); expect(result.progression[0]).toMatchObject({ exerciseIdentityId: "incline", loadValue: 45, weightUnit: "LB", loadSemantics: "PER_HAND_PER_SIDE", reps: 8 });
    expect(result.lastTrainedExercises).toEqual([{ exerciseIdentityId: "incline", date: "2026-10-05T00:00:00.000Z" }]);
  });
  it("uses Monday UTC weeks and calendar months, including a valid incomplete session's muscle sets", () => {
    const sunday = { ...workouts[0]!, id: "sunday", trainedAt: new Date("2026-10-04T23:59:59Z") };
    const monday = { ...workouts[0]!, id: "monday", status: "INCOMPLETE", trainedAt: new Date("2026-10-05T00:00:00Z") };
    const result = workoutAnalytics({ userId: "user", now, workouts: [sunday, monday, { ...monday, id: "future", trainedAt: new Date("2026-10-08") }],
      sets: [recorded({ id: "s", workoutId: "sunday" }), recorded({ id: "m", workoutId: "monday" }), recorded({ id: "f", workoutId: "future" })],
      classifications: [{ userId: "user", exerciseIdentityId: "incline", muscleGroup: "Chest", role: "PRIMARY", status: "CONFIRMED" }] });
    expect(result.frequency).toEqual([{ week: "2026-09-28", count: 1 }]);
    expect(result.muscles[0]).toMatchObject({ weeklySets: 1, lastTrained: "2026-10-05T00:00:00.000Z" });
    expect(result.progression).toHaveLength(2);
  });
});

it("uses the saved timezone at month and week boundaries", () => {
  const time = new Date("2026-11-01T19:00:00Z");
  const result = workoutAnalytics({ userId: "user", now: time, timeZone: "Asia/Kolkata", workouts: [{ id: "w", userId: "user", templateId: "t", name: "Push", status: "COMPLETED", trainedAt: time }], sets: [], classifications: [] });
  expect(result.calendar).toBe("Asia/Kolkata");
  expect(result.weekStarting).toBe("2026-11-02");
  expect(result.month).toBe("2026-11");
  expect(result.monthlyWorkoutCount).toBe(1);
});

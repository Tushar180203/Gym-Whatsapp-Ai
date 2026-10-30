import { describe, expect, it } from "vitest";
import { workoutAnalytics } from "./workout-analytics-service.js";
import { recorded } from "./testing/recorded-set.js";
import { activityYear, estimateMuscles, exerciseSessions, trainingWeek, weeklyInsights, type AnalyticsData } from "./training-insights.js";
export function analyticsFixture(): AnalyticsData {
  const now = new Date("2026-10-29T12:00:00Z");
  return { ...workoutAnalytics({ userId: "user", now, timeZone: "Asia/Kolkata", classifications: [], workouts: [
    { id: "prior", userId: "user", templateId: "t", name: "Push", status: "COMPLETED", trainedAt: new Date("2026-10-25T19:00:00Z") },
    { id: "partial", userId: "user", templateId: "t", name: "Push", status: "INCOMPLETE", trainedAt: now },
    { id: "old", userId: "user", templateId: "t", name: "Push", status: "COMPLETED", trainedAt: new Date("2026-10-20T12:00:00Z") }
  ], sets: [recorded({ id: "s1", loadValue: 50 }), recorded({ id: "s2", workoutId: "partial", loadValue: 55 }), recorded({ id: "s3", workoutId: "old", loadValue: 40 }), recorded({ id: "deleted", status: "DELETED" })] }),
  identities: [{ id: "incline", name: "Incline Dumbbell Press" }], classifications: [] };
}
describe("weekly training insights", () => {
  it("uses the profile's local Monday boundary and includes incomplete recorded sets, but not deleted sets", () => {
    const summary = trainingWeek(analyticsFixture(), "2026-10-26");
    expect(summary.completed).toBe(1); expect(summary.sets).toHaveLength(2);
    expect(summary.activeDays).toBe(2); expect(summary.previousSets).toHaveLength(1);
    expect(summary.days[0]?.sets).toBe(1);
    expect(summary.muscles.find(row => row.id === "chest")).toMatchObject({ sets: 2, estimated: 2, confirmed: 0 });
    expect(summary.muscles.find(row => row.id === "triceps")).toMatchObject({ sets: 0, secondary: 2 });
  });
  it("respects uncertain and corrected classifications over both standard and AI estimates", () => {
    const data = analyticsFixture();
    data.classifications = [{ userId: "user", exerciseIdentityId: "incline", muscleGroup: "Chest", role: "PRIMARY", status: "UNCERTAIN" }];
    expect(trainingWeek(data, data.weekStarting).unmapped).toHaveLength(2);
    data.classifications[0] = { ...data.classifications[0]!, muscleGroup: "Deltoids", status: "CONFIRMED" };
    data.classifications.push({ ...data.classifications[0]! });
    const summary = trainingWeek(data, data.weekStarting, [{ exerciseIdentityId: "incline", primary: ["chest"], secondary: ["triceps"] }]);
    expect(summary.muscles.find(row => row.id === "shoulders")).toMatchObject({ sets: 2, confirmed: 2 });
    expect(summary.muscles.find(row => row.id === "chest")?.sets).toBe(0);
  });
  it("does not map vague labels and keeps AI estimates distinct", () => {
    const data = analyticsFixture(); data.identities[0]!.name = "My exercise";
    expect(trainingWeek(data, data.weekStarting).unmapped).toHaveLength(2);
    const summary = trainingWeek(data, data.weekStarting, [{ exerciseIdentityId: "incline", primary: ["lats"], secondary: ["biceps"] }]);
    expect(summary.muscles.find(row => row.id === "lats")).toMatchObject({ sets: 2, confirmed: 0, estimated: 2, exercises: [{ source: "ai" }] });
    expect(estimateMuscles("Leg extension")).toEqual({ primary: ["quads"], secondary: [] });
    expect(estimateMuscles("Chest fly")).toEqual({ primary: ["chest"], secondary: [] });
  });
  it("returns zeroes for empty weeks, excludes later history from last-trained, and produces no invented progress", () => {
    const data = analyticsFixture(); const empty = trainingWeek(data, "2026-10-05");
    expect(empty.activeDays).toBe(0); expect(empty.days).toHaveLength(7); expect(empty.trained).toBe(0);
    expect(empty.muscles.every(row => row.lastTrained === null)).toBe(true);
    expect(weeklyInsights(data, "2026-10-05").some(row => row.id === "start")).toBe(true);
  });
  it("separates units and load semantics in exercise progress and does not double per-hand volume", () => {
    const data = analyticsFixture();
    data.progression.push({ ...data.progression[0]!, id: "kg", weightUnit: "KG", loadValue: 100 });
    data.progression.push({ ...data.progression[0]!, id: "total", loadSemantics: "TOTAL_LOAD", loadValue: 200 });
    const sessions = exerciseSessions(data, "incline", "LB", "PER_HAND_PER_SIDE");
    expect(sessions.map(row => row.bestLoad)).toEqual([40, 50, 55]);
    expect(sessions[0]?.volume).toBe(400); expect(sessions[0]?.sets).toBe(1);
  });
});
describe("activity year and streaks", () => {
  const year = (now: string, days: string[]) => activityYear({ ...workoutAnalytics({ userId: "user", now: new Date(now), timeZone: "Asia/Kolkata", classifications: [],
    workouts: days.map(day => ({ id: day, userId: "user", templateId: "t", name: "Push", status: "COMPLETED" as const, trainedAt: new Date(day) })),
    sets: days.map(day => recorded({ id: `set-${day}`, workoutId: day, occurredAt: new Date(day) })) }), identities: [], classifications: [] });
  const days = ["2026-10-13T13:00:00Z", "2026-10-19T13:00:00Z", "2026-10-20T13:00:00Z", "2026-10-21T13:00:00Z",
    "2026-10-26T13:00:00Z", "2026-10-27T13:00:00Z", "2026-10-28T13:00:00Z", "2026-10-29T13:00:00Z"];
  it("keeps today open so an unlogged today does not break the current streak", () => {
    const result = year("2026-10-30T06:00:00Z", days);
    expect(result).toMatchObject({ today: "2026-10-30", currentStreak: 4, longestStreak: 4, weekStreak: 3, activeToday: false, activeDays: 8, workouts: 8 });
  });
  it("breaks the day streak after a full missed day and counts days in the profile time zone", () => {
    expect(year("2026-10-31T06:00:00Z", days).currentStreak).toBe(0);
    const lateNight = year("2026-10-30T06:00:00Z", [...days, "2026-10-29T19:00:00Z"]);
    expect(lateNight).toMatchObject({ currentStreak: 5, activeToday: true });
  });
  it("lays out 53 Monday-start weeks ending in the current week, with future days marked", () => {
    const { columns } = year("2026-10-30T06:00:00Z", days);
    expect(columns).toHaveLength(53); expect(columns.every(week => week.length === 7)).toBe(true);
    expect(columns.at(-1)?.[0]?.date).toBe("2026-10-26"); expect(columns.at(-1)?.slice(5).every(day => day.future)).toBe(true);
    expect(columns.at(-1)?.[3]).toMatchObject({ date: "2026-10-29", workouts: 1, sets: 1, level: 4 });
    expect(columns[0]?.[0]?.level).toBe(0);
  });
});

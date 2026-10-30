import { describe, expect, it } from "vitest";
import { reviewAnalytics } from "../../../apps/web/server/analytics-insights.js";
import { workoutAnalytics } from "../../../packages/analytics/src/workout-analytics-service.js";
import { recorded } from "../../../packages/analytics/src/testing/recorded-set.js";
import type { StructuredOutputClient } from "../../../packages/ai/src/interfaces.js";
const data = { ...workoutAnalytics({ userId: "user", now: new Date("2026-10-29"), classifications: [], workouts: [{ id: "prior", userId: "user", templateId: "t", name: "Push", status: "COMPLETED", trainedAt: new Date("2026-10-27") }], sets: [recorded()] }), identities: [{ id: "incline", name: "Incline Press" }], classifications: [] };
const client = (rawJson: unknown): StructuredOutputClient => ({ createStructuredOutput: async () => ({ rawJson, model: "test" }) });
describe("AI analytics boundary", () => {
  it("rejects invented exercise IDs and highlights, deduplicates muscles, and never overlaps primary/support", async () => {
    const result = await reviewAnalytics(data, data.weekStarting, client({ mappings: [
      { exerciseIdentityId: "foreign", primary: ["chest"], secondary: [] },
      { exerciseIdentityId: "incline", primary: ["chest", "chest"], secondary: ["chest", "triceps", "triceps"] },
      { exerciseIdentityId: "incline", primary: ["lats"], secondary: [] }
    ], highlightIds: ["invented", "coverage", "coverage"] }));
    expect(result).toEqual({ available: true, mappings: [{ exerciseIdentityId: "incline", primary: ["chest"], secondary: ["triceps"] }], highlightIds: ["coverage"] });
  });
  it("rejects unknown muscle IDs and malformed provider output", async () => {
    await expect(reviewAnalytics(data, data.weekStarting, client({ mappings: [{ exerciseIdentityId: "incline", primary: ["unknown"], secondary: [] }], highlightIds: [] }))).rejects.toThrow();
    await expect(reviewAnalytics(data, data.weekStarting, client(null))).rejects.toThrow();
  });
  it("sends only recorded, unclassified exercise names and aggregate facts, and protects user classifications", async () => {
    const classified = { ...data, classifications: [{ userId: "user", exerciseIdentityId: "incline", muscleGroup: "Chest", role: "PRIMARY", status: "UNCERTAIN" }] };
    const result = await reviewAnalytics(classified, data.weekStarting, { createStructuredOutput: async request => {
      const input = JSON.parse(request.userText); expect(input.exercises).toEqual([]); expect(input.userId).toBeUndefined(); expect(input.sets).toBeUndefined();
      return { rawJson: { mappings: [{ exerciseIdentityId: "incline", primary: ["chest"], secondary: [] }], highlightIds: [] }, model: "test" };
    } });
    expect(result.mappings).toEqual([]);
  });
});

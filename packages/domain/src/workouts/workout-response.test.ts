import { describe, expect, it } from "vitest";
import { formatCompletionSummary, formatPreviousPerformance } from "./workout-response.js";
import { recorded } from "../../../analytics/src/testing/recorded-set.js";
describe("deterministic workout responses", () => {
  it("states no previous record without inventing load or reps", () => {
    expect(formatPreviousPerformance("Squat", 3, 5, 5, null)).toBe("*Current exercise*\nSquat\nTarget: 3 sets, 5 reps\n\n*Previous performance*\nNo earlier sets recorded for this exercise yet.");
  });
  it("keeps load, unit, semantics and reps intact in concise context", () => {
    expect(formatPreviousPerformance("Incline", 3, 8, 10, [recorded()])).toBe("*Current exercise*\nIncline\nTarget: 3 sets, 8-10 reps\n\n*Previous performance*\nLast time: 45 LB each x 10");
  });
  it("does not invent unavailable duration or PRs", () => {
    expect(formatCompletionSummary({ name: "Upper", status: "INCOMPLETE", exercises: 1, sets: 2, durationSeconds: null, records: [] })).toBe("Upper: incomplete\n\n*Session totals*\nExercises: 1\nSets: 2");
  });
  it("shows each previous set separately and treats an empty result as unavailable", () => {
    expect(formatPreviousPerformance("Incline", null, null, null, [recorded(), recorded({ reps: 9 })])).toBe("*Current exercise*\nIncline\n\n*Previous performance*\nLast time:\n• 45 LB each x 10\n• 45 LB each x 9");
    expect(formatPreviousPerformance("Squat", null, null, null, [])).toContain("No earlier sets recorded");
  });
  it("separates actual session totals, duration and personal records", () => {
    expect(formatCompletionSummary({ name: "Push", status: "COMPLETED", exercises: 2, sets: 6, durationSeconds: 125, records: ["Bench 45 LB each x 10", "Press 20 KG total x 8"] })).toBe("Push: completed\n\n*Session totals*\nExercises: 2\nSets: 6\nDuration: 2m 5s\n\n*Personal records*\n• Bench 45 LB each x 10\n• Press 20 KG total x 8");
  });
});

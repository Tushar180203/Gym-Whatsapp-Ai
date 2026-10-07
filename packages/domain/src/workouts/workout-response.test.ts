import { describe, expect, it } from "vitest";
import { formatCompletionSummary, formatPreviousPerformance } from "./workout-response.js";
import { recorded } from "../../../analytics/src/testing/recorded-set.js";
describe("deterministic workout responses", () => {
  it("states no previous record without inventing load or reps", () => {
    expect(formatPreviousPerformance("Squat", 3, 5, 5, null)).toBe("Squat - 3 sets, 5 reps\nNo previous record.");
  });
  it("keeps load, unit, semantics and reps intact in concise context", () => {
    expect(formatPreviousPerformance("Incline", 3, 8, 10, [recorded()])).toBe("Incline - 3 sets, 8-10 reps\nLast time: 45 LB each x 10");
  });
  it("does not invent unavailable duration or PRs", () => {
    expect(formatCompletionSummary({ name: "Upper", status: "INCOMPLETE", exercises: 1, sets: 2, durationSeconds: null, records: [] })).toBe("Upper: incomplete\n1 exercises, 2 sets");
  });
});

import { describe, expect, it } from "vitest";
import { personalRecords } from "./personal-record-service.js";
import { recorded } from "./testing/recorded-set.js";
const query = { userId: "user", exerciseIdentityId: "incline", weightUnit: "LB", loadSemantics: "PER_HAND_PER_SIDE" } as const;
describe("derived personal records", () => {
  it("derives highest load and highest reps at each exact load without 1RM", () => {
    const result = personalRecords([recorded(), recorded({ id: "more-reps", reps: 12 }), recorded({ id: "heavy", loadValue: 50, reps: 5 })], query);
    expect(result.highestLoad?.loadValue).toBe(50);
    expect(result.highestRepsAtLoad.map(set => [set.loadValue, set.reps])).toEqual([[45, 12], [50, 5]]);
    expect(Object.keys(result)).toEqual(["highestLoad", "highestRepsAtLoad"]);
  });
  it("uses current corrected values and excludes deletes, substitutions, incompatible loads and other users", () => {
    const rows = [recorded({ reps: 8 }), recorded({ loadValue: 80, status: "DELETED" }), recorded({ exerciseIdentityId: "substitution", loadValue: 100 }), recorded({ weightUnit: "KG", loadValue: 99 }), recorded({ loadSemantics: "MACHINE_STACK", loadValue: 99 }), recorded({ userId: "other", loadValue: 100 })];
    expect(personalRecords(rows, query).highestLoad).toMatchObject({ loadValue: 45, reps: 8 });
    expect(personalRecords(rows.filter(row => row.id !== "set"), query).highestLoad).toBeNull();
  });
});

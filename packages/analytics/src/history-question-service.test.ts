import { describe, expect, it } from "vitest";
import { answerHistoryQuestion, type HistorySnapshot } from "./history-question-service.js";
import { recorded } from "./testing/recorded-set.js";
const snapshot: HistorySnapshot = { userId: "user", now: new Date("2026-10-07"), preferredWeightUnit: "LB",
  identities: [{ id: "incline", name: "Incline Dumbbell Press", defaultLoadSemantics: "PER_HAND_PER_SIDE" }], aliases: [{ identityId: "incline", alias: "incline press" }],
  workouts: [{ id: "prior", userId: "user", name: "Push Day", templateId: "push", status: "COMPLETED", trainedAt: new Date("2026-10-05") }],
  sets: [recorded()], classifications: [] };
describe("bounded factual history answers", () => {
  it("last exercise and best set use confirmed aliases and US5 exact compatible derivation", () => {
    expect(answerHistoryQuestion(snapshot, { type: "QUERY_HISTORY", queryKind: "LAST_EXERCISE", subject: { kind: "EXERCISE", exerciseRef: "incline press" } })).toContain("45 LB each x 10");
    expect(answerHistoryQuestion(snapshot, { type: "QUERY_HISTORY", queryKind: "BEST_SET", subject: { kind: "EXERCISE", exerciseRef: "incline" } })).toContain("Highest load: 45 LB each");
  });
  it("last named session lists only its persisted sets", () => {
    expect(answerHistoryQuestion(snapshot, { type: "QUERY_HISTORY", queryKind: "LAST_SESSION", subject: { kind: "ROUTINE_SESSION", sessionRef: "Push Day" } })).toContain("Incline Dumbbell Press: 45 LB each x 10");
  });
  it("ambiguous session/exercise references clarify, missing/similar identities never inherit history", () => {
    const action = { type: "QUERY_HISTORY", queryKind: "LAST_EXERCISE", subject: { kind: "EXERCISE", exerciseRef: "Incline Dumbbell Press" } } as const;
    expect(answerHistoryQuestion({ ...snapshot, identities: [...snapshot.identities, { ...snapshot.identities[0]!, id: "other-incline" }] }, action)).toContain("Which exact exercise");
    expect(answerHistoryQuestion(snapshot, { ...action, subject: { kind: "EXERCISE", exerciseRef: "Smith Incline Press" } })).toContain("No recorded history");
    expect(answerHistoryQuestion({ ...snapshot, workouts: [...snapshot.workouts, { ...snapshot.workouts[0]!, id: "another", templateId: "another" }] }, { type: "QUERY_HISTORY", queryKind: "LAST_SESSION", subject: { kind: "ROUTINE_SESSION", sessionRef: "Push Day" } })).toContain("Which session");
  });
  it("muscle missing data is unavailable, monthly counts are deterministic", () => {
    expect(answerHistoryQuestion(snapshot, { type: "QUERY_ANALYTICS", queryKind: "WEEKLY_PRIMARY_MUSCLE_SETS", subject: { kind: "MUSCLE", muscleRef: "chest" } })).toContain("No confirmed primary-muscle data");
    expect(answerHistoryQuestion(snapshot, { type: "QUERY_ANALYTICS", queryKind: "MONTHLY_WORKOUT_COUNT" })).toContain("1 completed workout");
  });
  it("unsupported coaching returns a bounded limitation, not a prescription", () => {
    expect(answerHistoryQuestion(snapshot, { type: "UNKNOWN", reason: "increase the load by 10" })).toBe("I can report recorded workout facts, but cannot choose weights, progression, deloads or training volume for you.");
  });
  it("never compares incompatible unit or semantics for last-time and best answers", () => {
    for (const set of [recorded({ weightUnit: "KG" }), recorded({ loadSemantics: "TOTAL_LOAD" })]) {
      for (const queryKind of ["LAST_EXERCISE", "BEST_SET"] as const) expect(answerHistoryQuestion({ ...snapshot, sets: [set] },
        { type: "QUERY_HISTORY", queryKind, subject: { kind: "EXERCISE", exerciseRef: "incline" } })).toContain("No recorded history");
    }
  });
  it("deleted sets leave last-trained and named-session answers; snapshots retain actual exercise names", () => {
    expect(answerHistoryQuestion({ ...snapshot, setNames: { [snapshot.sets[0]!.id]: "Original Incline Name" } },
      { type: "QUERY_HISTORY", queryKind: "LAST_SESSION", subject: { kind: "ROUTINE_SESSION", sessionRef: "push" } })).toContain("Original Incline Name");
    expect(answerHistoryQuestion({ ...snapshot, sets: [recorded({ status: "DELETED" })] },
      { type: "QUERY_ANALYTICS", queryKind: "LAST_TRAINED", subject: { kind: "EXERCISE", exerciseRef: "incline" } })).toContain("No recorded history");
    expect(answerHistoryQuestion({ ...snapshot, workouts: [{ ...snapshot.workouts[0]!, trainedAt: new Date("2026-10-08") }] },
      { type: "QUERY_HISTORY", queryKind: "LAST_SESSION", subject: { kind: "ROUTINE_SESSION", sessionRef: "push" } })).toContain("No recorded history");
  });
});

it("filters a dated performance question by the user's local day", () => {
  const local = { ...snapshot, timeZone: "Asia/Kolkata", workouts: snapshot.workouts.map(workout => ({ ...workout, trainedAt: new Date("2026-10-05T19:00:00Z") })) };
  const action = { type: "QUERY_HISTORY" as const, queryKind: "LAST_SESSION" as const, subject: { kind: "ROUTINE_SESSION" as const, sessionRef: "Push Day" } };
  expect(answerHistoryQuestion(local, { ...action, onDate: "2026-10-05" })).toBe("No recorded history for that session.");
  expect(answerHistoryQuestion(local, { ...action, onDate: "2026-10-06" })).toContain("2026-10-06");
});

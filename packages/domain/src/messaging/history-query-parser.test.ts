import { describe, expect, it } from "vitest";
import { isCoachingQuestion, parseHistoryQuestion } from "./history-query-parser.js";
describe("bounded deterministic question routing", () => {
  it.each([
    ["What did I do last push day?", "QUERY_HISTORY", "LAST_SESSION"],
    ["What did I incline press last time?", "QUERY_HISTORY", "LAST_EXERCISE"],
    ["What's my best incline press?", "QUERY_HISTORY", "BEST_SET"],
    ["How many chest sets this week?", "QUERY_ANALYTICS", "WEEKLY_PRIMARY_MUSCLE_SETS"],
    ["When did I last train legs?", "QUERY_ANALYTICS", "LAST_TRAINED"],
    ["How many workouts did I do this month?", "QUERY_ANALYTICS", "MONTHLY_WORKOUT_COUNT"]
  ])("recognizes %s without AI", (text, type, queryKind) => expect(parseHistoryQuestion(text)).toMatchObject({ type, queryKind }));
  it.each(["What should I bench today?", "Should I increase the weight?", "Should I deload?", "Am I training chest enough?"])("bounds coaching: %s", text => {
    expect(isCoachingQuestion(text)).toBe(true); expect(parseHistoryQuestion(text)).toBeUndefined();
  });
  it("leaves unrecognized wording to the locally validated AI fallback", () => expect(parseHistoryQuestion("tell me the chest volume facts for the current week")).toBeUndefined());
});

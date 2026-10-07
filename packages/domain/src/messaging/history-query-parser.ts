import type { HistoryAction } from "../../../analytics/src/history-question-service.js";
export function isCoachingQuestion(text: string): boolean {
  return /\bshould (?:i|we)\b|\bwhat should\b|\bam i\b.*\benough\b|\brecommend\b.*\b(?:weight|progression|deload|volume)\b/i.test(text);
}
export function parseHistoryQuestion(text: string): HistoryAction | undefined {
  const value = text.trim().replace(/[?!.]+$/, "");
  let match = value.match(/^what (?:did|do) I (?:do )?last (.+)$/i);
  if (match) return { type: "QUERY_HISTORY", queryKind: "LAST_SESSION", subject: { kind: "ROUTINE_SESSION", sessionRef: match[1]!.trim() } };
  match = value.match(/^what did I (.+?) last time$/i);
  if (match) return { type: "QUERY_HISTORY", queryKind: "LAST_EXERCISE", subject: { kind: "EXERCISE", exerciseRef: match[1]!.trim() } };
  match = value.match(/^(?:what's|what is) my best (.+)$/i);
  if (match) return { type: "QUERY_HISTORY", queryKind: "BEST_SET", subject: { kind: "EXERCISE", exerciseRef: match[1]!.trim() } };
  match = value.match(/^how many (.+?) sets (?:this week|did I do this week)$/i);
  if (match) return { type: "QUERY_ANALYTICS", queryKind: "WEEKLY_PRIMARY_MUSCLE_SETS", subject: { kind: "MUSCLE", muscleRef: match[1]!.trim() } };
  match = value.match(/^when did I last train (.+)$/i);
  if (match) return { type: "QUERY_ANALYTICS", queryKind: "LAST_TRAINED", subject: { kind: "MUSCLE", muscleRef: match[1]!.trim() } };
  if (/^how many workouts (?:did I do )?this month$/i.test(value)) return { type: "QUERY_ANALYTICS", queryKind: "MONTHLY_WORKOUT_COUNT" };
  return undefined;
}

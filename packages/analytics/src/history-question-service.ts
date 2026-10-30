import { localDate } from "../../domain/src/time/local-calendar.js";
import type { ProposedAction } from "../../contracts/src/ai/actions.js";
import type { LoadSemantics, WeightUnit } from "../../contracts/src/domain/enums.js";
import { resolveExerciseIdentity } from "../../domain/src/exercises/unknown-exercise-flow.js";
import { semanticLabel } from "../../domain/src/workouts/workout-response.js";
import { previousPerformance } from "./previous-performance-service.js";
import { personalRecords } from "./personal-record-service.js";
import { normalizedRef, validAnalyticsSets, workoutAnalytics, type AnalyticsInput } from "./workout-analytics-service.js";
export type HistorySnapshot = AnalyticsInput & { preferredWeightUnit: WeightUnit;
  identities: Array<{ id: string; name: string; defaultLoadSemantics: LoadSemantics }>;
  aliases: Array<{ identityId: string; alias: string }>; setNames?: Record<string, string> };
export type HistoryAction = Extract<ProposedAction, { type: "QUERY_HISTORY" | "QUERY_ANALYTICS" | "UNKNOWN" }>;
export const coachingBoundary = "I can report recorded workout facts, but cannot choose weights, progression, deloads or training volume for you.";
export function answerHistoryQuestion(snapshot: HistorySnapshot, action: HistoryAction): string {
  if (action.type === "UNKNOWN") return coachingBoundary;
  if (action.type === "QUERY_HISTORY" && action.onDate) snapshot = { ...snapshot, workouts: snapshot.workouts.filter(workout => localDate(workout.trainedAt, snapshot.timeZone) === action.onDate) };
  const sets = validAnalyticsSets(snapshot), metrics = workoutAnalytics(snapshot), subject = action.subject;
  if (action.type === "QUERY_ANALYTICS" && action.queryKind === "MONTHLY_WORKOUT_COUNT") {
    if (subject) return "Please ask for your overall completed workout count this month.";
    return `${metrics.monthlyWorkoutCount} completed workout${metrics.monthlyWorkoutCount === 1 ? "" : "s"} in ${metrics.month} (${snapshot.timeZone ?? "UTC"}).`;
  }
  if (subject?.kind === "EXERCISE") {
    const resolved = resolveExerciseIdentity(subject.exerciseRef, snapshot.identities, snapshot.aliases);
    if (resolved.status === "CONFLICT") return "Which exact exercise identity do you mean?";
    if (resolved.status === "UNKNOWN") {
      const candidates = snapshot.identities.filter(row => normalizedRef(row.name).includes(normalizedRef(subject.exerciseRef)));
      return candidates.length > 1 ? "Which exact exercise identity do you mean?" : "No recorded history for that exact exercise.";
    }
    if (resolved.status !== "KNOWN") return "Which exact exercise identity do you mean?";
    const identity = snapshot.identities.find(row => row.id === resolved.id)!;
    if (action.type === "QUERY_ANALYTICS" && action.queryKind !== "LAST_TRAINED") return "Choose a muscle for primary-muscle set counts.";
    if (action.type === "QUERY_ANALYTICS") {
      const date = metrics.lastTrainedExercises.find(row => row.exerciseIdentityId === identity.id)?.date;
      return date ? `${identity.name}: last trained ${localDate(new Date(date), snapshot.timeZone)} (${snapshot.timeZone ?? "UTC"}).` : "No recorded history for that exact exercise.";
    }
    if (action.queryKind === "LAST_SESSION") return "Which workout session do you mean?";
    const query = { userId: snapshot.userId, exerciseIdentityId: identity.id, weightUnit: snapshot.preferredWeightUnit, loadSemantics: identity.defaultLoadSemantics };
    if (action.queryKind === "LAST_EXERCISE") {
      const previous = previousPerformance(sets, query);
      return previous ? `${identity.name}\nLast time: ${previous.map(formatSet).join(", ")}.` : "No recorded history for that exact exercise with comparable unit and load semantics.";
    }
    const records = personalRecords(sets, query);
    return records.highestLoad ? `${identity.name}\nHighest load: ${records.highestLoad.loadValue} ${records.highestLoad.weightUnit} ${semanticLabel(records.highestLoad.loadSemantics)}\nBest reps at load: ${records.highestRepsAtLoad.map(formatSet).join(", ")}.` : "No recorded history for that exact exercise with comparable unit and load semantics.";
  }
  if (subject?.kind === "MUSCLE") {
    if (action.type !== "QUERY_ANALYTICS") return "Choose an exact exercise or workout session for this history question.";
    const matched = metrics.muscles.filter(row => normalizedRef(row.muscleGroup) === normalizedRef(subject.muscleRef));
    if (matched.length > 1) return "Which muscle group do you mean?";
    const muscle = matched[0];
    if (!muscle) return metrics.muscles.filter(row => normalizedRef(row.muscleGroup).includes(normalizedRef(subject.muscleRef))).length > 1 ? "Which muscle group do you mean?" : "No confirmed primary-muscle data is available for that muscle.";
    if (action.queryKind === "LAST_TRAINED") return muscle.lastTrained ? `${muscle.muscleGroup}: last trained ${localDate(new Date(muscle.lastTrained), snapshot.timeZone)} (${snapshot.timeZone ?? "UTC"}).` : "No recorded training for that muscle.";
    return `${muscle.muscleGroup}: ${muscle.weeklySets} primary-muscle sets in the week starting ${metrics.weekStarting} (${snapshot.timeZone ?? "UTC"}).`;
  }
  if (subject?.kind === "ROUTINE_SESSION" || subject?.kind === "WORKOUT_SESSION") {
    const ref = subject.kind === "ROUTINE_SESSION" ? subject.sessionRef : subject.workoutRef;
    const matches = snapshot.workouts.filter(workout => workout.userId === snapshot.userId && workout.trainedAt <= snapshot.now && ["COMPLETED", "INCOMPLETE"].includes(workout.status)
      && (workout.id === ref || workout.templateId === ref || normalizedRef(workout.name) === normalizedRef(ref)));
    if (new Set(matches.map(row => row.templateId)).size > 1) return "Which session do you mean? Specify its exact workout or template ID.";
    const sorted = matches.sort((a, b) => b.trainedAt.getTime() - a.trainedAt.getTime() || b.id.localeCompare(a.id));
    const workout = (action.type === "QUERY_ANALYTICS" ? sorted.filter(row => sets.some(set => set.workoutId === row.id)) : sorted)[0];
    if (!workout) return new Set(snapshot.workouts.filter(row => row.userId === snapshot.userId && normalizedRef(row.name).includes(normalizedRef(ref))).map(row => row.templateId)).size > 1 ? "Which session do you mean? Specify its exact workout or template ID." : "No recorded history for that session.";
    if (action.type === "QUERY_ANALYTICS") return action.queryKind === "LAST_TRAINED" ? `${workout.name}: last trained ${localDate(workout.trainedAt, snapshot.timeZone)} (${snapshot.timeZone ?? "UTC"}).` : "Choose a muscle for primary-muscle set counts.";
    if (action.queryKind !== "LAST_SESSION") return "Which exact exercise do you mean?";
    const recorded = sets.filter(set => set.workoutId === workout.id).sort((a,b) => a.setIndex-b.setIndex);
    return recorded.length ? `${workout.name}, ${localDate(workout.trainedAt, snapshot.timeZone)} (${workout.status.toLowerCase()})\n${recorded.map(set => `• ${snapshot.setNames?.[set.id] ?? snapshot.identities.find(identity => identity.id === set.exerciseIdentityId)?.name ?? "Recorded exercise"}: ${formatSet(set)}`).join("\n")}` : `${workout.name}: no recorded sets available.`;
  }
  return "Which exact exercise, workout session or muscle do you mean?";
}
function formatSet(set: { loadValue: number; weightUnit: WeightUnit; loadSemantics: LoadSemantics; reps: number }) {
  return `${set.loadValue} ${set.weightUnit} ${semanticLabel(set.loadSemantics)} x ${set.reps}`;
}

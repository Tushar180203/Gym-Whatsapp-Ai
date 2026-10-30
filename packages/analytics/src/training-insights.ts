import { localDate, localWeek } from "../../domain/src/time/local-calendar.js";
import type { workoutAnalytics, MuscleClassification } from "./workout-analytics-service.js";

export const muscleGroups = [
  { id: "chest", name: "Chest" }, { id: "shoulders", name: "Shoulders" },
  { id: "biceps", name: "Biceps" }, { id: "triceps", name: "Triceps" },
  { id: "forearms", name: "Forearms" }, { id: "abs", name: "Abs" },
  { id: "obliques", name: "Obliques" }, { id: "upper-back", name: "Upper back" },
  { id: "lats", name: "Lats" }, { id: "lower-back", name: "Lower back" },
  { id: "glutes", name: "Glutes" }, { id: "quads", name: "Quads" },
  { id: "hamstrings", name: "Hamstrings" }, { id: "calves", name: "Calves" }
] as const;
export type MuscleId = typeof muscleGroups[number]["id"];
export type AnalyticsData = ReturnType<typeof workoutAnalytics> & {
  identities: { id: string; name: string }[]; classifications: MuscleClassification[];
};
export type MuscleSuggestion = { exerciseIdentityId: string; primary: MuscleId[]; secondary: MuscleId[] };
export type AiTrainingReview = { available: boolean; mappings: MuscleSuggestion[]; highlightIds: string[] };
const aliases: Record<string, MuscleId> = {
  chest: "chest", pecs: "chest", pectorals: "chest", pectoralis: "chest",
  shoulders: "shoulders", delts: "shoulders", deltoids: "shoulders", shoulder: "shoulders",
  biceps: "biceps", triceps: "triceps", forearms: "forearms", abs: "abs", abdominals: "abs", core: "abs",
  obliques: "obliques", back: "upper-back", "upper back": "upper-back", traps: "upper-back", trapezius: "upper-back", rhomboids: "upper-back",
  lats: "lats", "latissimus dorsi": "lats", "lower back": "lower-back", "erector spinae": "lower-back",
  glutes: "glutes", gluteals: "glutes", quads: "quads", quadriceps: "quads", hamstrings: "hamstrings", calves: "calves", gastrocnemius: "calves"
};
export function muscleId(value: string): MuscleId | undefined { return aliases[value.trim().toLowerCase().replaceAll("-", " ")]; }
// Conservative, visible estimates for familiar names; an explicit user classification always wins.
const rules: [RegExp, MuscleId[], MuscleId[]][] = [
  [/\b(romanian deadlift|rdl|stiff.?leg.*deadlift)\b/i, ["hamstrings"], ["glutes", "lower-back"]],
  [/\b(bench press|chest press|push.?ups?|incline.*press)\b/i, ["chest"], ["triceps", "shoulders"]],
  [/\b(chest fly|pec deck)\b/i, ["chest"], []],
  [/\b(overhead press|shoulder press|military press)\b/i, ["shoulders"], ["triceps"]],
  [/\b(lateral raise|front raise)\b/i, ["shoulders"], []],
  [/\b(face pull|reverse fly|rear delt)\b/i, ["shoulders"], ["upper-back"]],
  [/\b(pull.?ups?|chin.?ups?|lat pulldown|lat pull.down)\b/i, ["lats"], ["biceps"]],
  [/\b(barbell row|dumbbell row|cable row|seated row|bent.over row|chest.supported row)\b/i, ["upper-back"], ["lats", "biceps"]],
  [/\b(shrug)\b/i, ["upper-back"], []],
  [/\b(bicep[s]? curl|hammer curl|preacher curl|barbell curl|dumbbell curl)\b/i, ["biceps"], ["forearms"]],
  [/\b(tricep[s]?|pushdown|skull.?crusher)\b/i, ["triceps"], []],
  [/\b(wrist curl|reverse wrist curl)\b/i, ["forearms"], []],
  [/\b(side plank|russian twist|side bend)\b/i, ["obliques"], ["abs"]],
  [/\b(crunch|sit.?ups?|plank|leg raise|ab wheel)\b/i, ["abs"], []],
  [/\b(hip thrust|glute bridge|glute kickback)\b/i, ["glutes"], []],
  [/\b(leg curl|hamstring curl)\b/i, ["hamstrings"], []],
  [/\b(leg extension)\b/i, ["quads"], []],
  [/\b(squat|leg press|lunge|split squat)\b/i, ["quads"], ["glutes"]],
  [/\b(calf raise|calf press)\b/i, ["calves"], []],
  [/\b(back extension|hyperextension)\b/i, ["lower-back"], ["glutes", "hamstrings"]]
];
export function estimateMuscles(name: string): { primary: MuscleId[]; secondary: MuscleId[] } | undefined {
  const match = rules.find(([pattern]) => pattern.test(name));
  return match ? { primary: match[1], secondary: match[2] } : undefined;
}
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}
export type ActivityDay = { date: string; workouts: number; sets: number; level: 0 | 1 | 2 | 3 | 4; future: boolean };
// Year-long activity calendar and streaks. A day counts as active when it has a saved workout in the profile's time zone;
// today stays "open", so an unlogged today does not break the current streak.
export function activityYear(data: AnalyticsData, weeks = 53) {
  const today = localDate(new Date(data.asOf), data.calendar);
  const workoutsByDay = new Map<string, number>(), setsByDay = new Map<string, number>();
  for (const workout of data.workouts) { const day = localDate(new Date(workout.date), data.calendar); workoutsByDay.set(day, (workoutsByDay.get(day) ?? 0) + 1); }
  for (const set of data.progression) { const day = localDate(new Date(set.date), data.calendar); setsByDay.set(day, (setsByDay.get(day) ?? 0) + 1); }
  const active = (day: string) => (workoutsByDay.get(day) ?? 0) > 0;
  const thisWeek = localWeek(new Date(data.asOf), data.calendar);
  const start = shiftDate(thisWeek, -(weeks - 1) * 7);
  const max = Math.max(1, ...[...setsByDay].filter(([day]) => day >= start && day <= today).map(([, sets]) => sets));
  const columns: ActivityDay[][] = Array.from({ length: weeks }, (_, week) => Array.from({ length: 7 }, (_, weekday) => {
    const date = shiftDate(start, week * 7 + weekday), sets = setsByDay.get(date) ?? 0, workouts = workoutsByDay.get(date) ?? 0;
    const level = (workouts || sets ? Math.max(1, Math.ceil(sets / max * 4)) : 0) as ActivityDay["level"];
    return { date, workouts, sets, level, future: date > today };
  }));
  const inWindow = columns.flat().filter(day => !day.future);
  let current = 0;
  for (let day = active(today) ? today : shiftDate(today, -1); active(day); day = shiftDate(day, -1)) current++;
  let longest = 0, run = 0, previous = "";
  for (const day of [...workoutsByDay.keys()].sort()) { run = previous && shiftDate(previous, 1) === day ? run + 1 : 1; longest = Math.max(longest, run); previous = day; }
  const activeWeeks = new Set([...workoutsByDay.keys()].map(day => localWeek(new Date(`${day}T12:00:00Z`))));
  let weekStreak = 0;
  for (let week = activeWeeks.has(thisWeek) ? thisWeek : shiftDate(thisWeek, -7); activeWeeks.has(week); week = shiftDate(week, -7)) weekStreak++;
  return { today, columns, currentStreak: current, longestStreak: longest, weekStreak, activeToday: active(today),
    activeDays: inWindow.filter(day => day.workouts > 0).length, workouts: inWindow.reduce((total, day) => total + day.workouts, 0) };
}
export function exerciseMapping(data: AnalyticsData, exerciseIdentityId: string, suggestions: MuscleSuggestion[] = []) {
  const explicit = data.classifications.filter(row => row.exerciseIdentityId === exerciseIdentityId);
  if (explicit.length) {
    return explicit.filter(row => row.status === "CONFIRMED").flatMap(row => {
      const id = muscleId(row.muscleGroup); return id ? [{ muscle: id, role: row.role, source: "confirmed" as const }] : [];
    });
  }
  const ai = suggestions.find(row => row.exerciseIdentityId === exerciseIdentityId);
  const estimate = ai ?? estimateMuscles(data.identities.find(row => row.id === exerciseIdentityId)?.name ?? "");
  return estimate ? [
    ...estimate.primary.map(muscle => ({ muscle, role: "PRIMARY", source: ai ? "ai" as const : "estimated" as const })),
    ...estimate.secondary.map(muscle => ({ muscle, role: "SECONDARY", source: ai ? "ai" as const : "estimated" as const }))
  ] : [];
}
export function trainingWeek(data: AnalyticsData, week: string, suggestions: MuscleSuggestion[] = []) {
  const sets = data.progression.filter(row => localWeek(new Date(row.date), data.calendar) === week);
  const previousSets = data.progression.filter(row => localWeek(new Date(row.date), data.calendar) === shiftDate(week, -7));
  const workouts = data.workouts.filter(row => localWeek(new Date(row.date), data.calendar) === week);
  const mapping = new Map(data.identities.map(identity => [identity.id, exerciseMapping(data, identity.id, suggestions)]));
  const muscles = muscleGroups.map(group => {
    const primary = sets.filter(set => mapping.get(set.exerciseIdentityId)?.some(row => row.muscle === group.id && row.role === "PRIMARY"));
    const secondary = sets.filter(set => !primary.includes(set) && mapping.get(set.exerciseIdentityId)?.some(row => row.muscle === group.id && row.role === "SECONDARY"));
    const confirmed = primary.filter(set => mapping.get(set.exerciseIdentityId)?.some(row => row.muscle === group.id && row.source === "confirmed")).length;
    const history = data.progression.filter(set => localDate(new Date(set.date), data.calendar) <= shiftDate(week, 6) && mapping.get(set.exerciseIdentityId)?.some(row => row.muscle === group.id));
    return { ...group, sets: primary.length, confirmed, estimated: primary.length - confirmed, secondary: secondary.length,
      lastTrained: history.at(-1)?.date ?? null,
      exercises: [...new Set([...primary, ...secondary].map(row => row.exerciseIdentityId))].map(id => ({
        id, name: data.identities.find(row => row.id === id)?.name ?? "Exercise",
        sets: primary.filter(row => row.exerciseIdentityId === id).length,
        secondary: secondary.filter(row => row.exerciseIdentityId === id).length,
        source: mapping.get(id)?.find(row => row.muscle === group.id)?.source ?? "estimated"
      })) };
  });
  const unmapped = sets.filter(set => !mapping.get(set.exerciseIdentityId)?.some(row => row.role === "PRIMARY"));
  const completed = workouts.filter(row => row.status === "COMPLETED").length;
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(week, index);
    return { date, workouts: workouts.filter(row => localDate(new Date(row.date), data.calendar) === date),
      sets: sets.filter(row => localDate(new Date(row.date), data.calendar) === date).length };
  });
  return { week, sets, previousSets, workouts, completed, days, muscles, unmapped,
    reps: sets.reduce((sum, row) => sum + row.reps, 0),
    trained: muscles.filter(row => row.sets > 0).length,
    activeDays: days.filter(day => day.sets > 0 || day.workouts.some(row => row.status === "COMPLETED")).length };
}
export function weeklyInsights(data: AnalyticsData, week: string, suggestions: MuscleSuggestion[] = []) {
  const summary = trainingWeek(data, week, suggestions);
  const top = [...summary.muscles].sort((a, b) => b.sets - a.sets)[0]!;
  const facts = [{ id: "consistency", title: "Every session adds up", text: `${summary.completed} completed workout${summary.completed === 1 ? "" : "s"} across ${summary.activeDays} active day${summary.activeDays === 1 ? "" : "s"} this week. ${summary.workouts.length - summary.completed} incomplete session${summary.workouts.length - summary.completed === 1 ? "" : "s"} also contribute recorded sets.` }];
  if (summary.sets.length) facts.push({ id: "coverage", title: "Your training footprint", text: `${summary.trained} of ${muscleGroups.length} mapped muscle groups have primary sets. ${top.sets ? `${top.name} leads with ${top.sets} sets${top.estimated ? ` (${top.estimated} estimated)` : ""}.` : "Map your exercises to see muscle coverage."} Coverage describes your log, not recovery or muscle growth.` });
  if (summary.previousSets.length) facts.push({ id: "momentum", title: "Your week in context", text: `${summary.sets.length} recorded sets this week versus ${summary.previousSets.length} last week. ${week === data.weekStarting ? "This week is still in progress; compare again at the end of the week." : "More sets alone do not mean better progress."}` });
  if (summary.unmapped.length) facts.push({ id: "mapping", title: "Complete the picture", text: `${summary.unmapped.length} sets have no mapped primary muscle. Review exercise classifications or use AI mapping to fill in the gaps.` });
  if (!summary.sets.length) facts.push({ id: "start", title: "Your next workout starts the story", text: "Record your sets in WhatsApp. Your muscle map and exercise trends will update here after the workout is saved." });
  return facts;
}
export function exerciseSessions(data: AnalyticsData, exerciseId: string, unit: string, semantics: string) {
  const sets = data.progression.filter(row => row.exerciseIdentityId === exerciseId && row.weightUnit === unit && row.loadSemantics === semantics);
  return [...new Set(sets.map(row => row.workoutId))].map(workoutId => {
    const session = sets.filter(row => row.workoutId === workoutId);
    return { workoutId, date: session[0]!.date, bestLoad: Math.max(...session.map(row => row.loadValue)),
      reps: session.reduce((sum, row) => sum + row.reps, 0), sets: session.length,
      volume: session.reduce((sum, row) => sum + row.loadValue * row.reps, 0) };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

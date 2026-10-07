export type SetTarget = {
  id: string; workoutId: string; exerciseId: string; exerciseName: string;
  setIndex: number; workoutStatus: string; createdAt: string;
};

export type TargetResolution = { status: "RESOLVED"; target: SetTarget } | { status: "CLARIFY"; question: string };

export function resolveCorrectionTarget(sets: SetTarget[], reference?: string, activeWorkoutId?: string): TargetResolution {
  const clarify = (): TargetResolution => ({ status: "CLARIFY", question: "Which exercise, workout and set should I correct?" });
  let candidates = sets;
  const ref = reference?.trim();
  if (!ref || ref === "last-active-set" || ref === "last") {
    candidates = candidates.filter(set => set.workoutId === activeWorkoutId);
    const last = candidates.reduce<SetTarget | undefined>((latest, set) => !latest || set.createdAt > latest.createdAt ? set : latest, undefined);
    if (!last) return clarify();
    const tied = candidates.filter(set => set.createdAt === last.createdAt);
    if (new Set(tied.map(set => set.exerciseId)).size !== 1) return clarify();
    const max = Math.max(...tied.map(set => set.setIndex));
    const latest = tied.filter(set => set.setIndex === max);
    return latest.length === 1 ? { status: "RESOLVED", target: latest[0]! } : clarify();
  }
  const byId = candidates.filter(set => set.id === ref || `set:${set.id}` === ref);
  if (byId.length === 1) return { status: "RESOLVED", target: byId[0]! };
  const completed = ref.startsWith("completed:");
  const normalized = ref.replace(/^completed:/, "").replace(/^exercise:/, "");
  const ordinal = normalized.match(/(?:[: ]set[: ]|\s)(\d+)$/i);
  const exercise = normalized.replace(/(?:[: ]set[: ]|\s)\d+$/i, "").replace(/:last$/, "").toLowerCase();
  candidates = candidates.filter(set => completed ? ["COMPLETED", "INCOMPLETE"].includes(set.workoutStatus) : set.workoutId === activeWorkoutId);
  candidates = candidates.filter(set => set.exerciseId === exercise || set.exerciseName.toLowerCase() === exercise || set.exerciseName.toLowerCase().startsWith(`${exercise} `));
  if (ordinal) candidates = candidates.filter(set => set.setIndex === Number(ordinal[1]));
  else if (normalized.endsWith(":last") && new Set(candidates.map(set => set.exerciseId)).size === 1) {
    const max = Math.max(...candidates.map(set => set.setIndex));
    candidates = candidates.filter(set => set.setIndex === max);
  }
  return candidates.length === 1 ? { status: "RESOLVED", target: candidates[0]! } : clarify();
}

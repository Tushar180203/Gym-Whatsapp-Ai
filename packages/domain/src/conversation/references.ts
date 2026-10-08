import type { ConversationExercise } from "./state.js";

const normalized = (s: string) => s.normalize("NFKC").toLowerCase().trim().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ");
export function editDistance(a: string, b: string): number {
  if (a.length > 120 || b.length > 120) return 121;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j]! + 1, row[j + 1]! + 1, row[j]! + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length]!;
}
export type ExerciseResolution = { status: "RESOLVED"; exercise: ConversationExercise } | { status: "AMBIGUOUS"; candidates: ConversationExercise[] } | { status: "UNKNOWN" };
export function resolveExerciseReference(reference: string, exercises: ConversationExercise[], activeId: string | null, recentId?: string | null): ExerciseResolution {
  const ref = normalized(reference).replace(/^the /, "");
  if (!ref) return { status: "UNKNOWN" };
  const exact = exercises.filter(e => e.id === reference || e.identityId === reference || [e.name, ...e.aliases].some(n => normalized(n) === ref));
  const availableExact = exact.filter(e => e.status !== "SKIPPED");
  const direct = availableExact.length ? availableExact : exact;
  if (direct.length) return direct.length === 1 ? { status: "RESOLVED", exercise: direct[0]! } : { status: "AMBIGUOUS", candidates: direct };
  let candidates: ConversationExercise[];
  if (/^(it|that|this|this one|current|current exercise)$/.test(ref)) candidates = exercises.filter(e => e.id === (activeId ?? recentId));
  else if (ref === "last one" || ref === "previous exercise") candidates = exercises.filter(e => e.id === recentId && e.id !== activeId);
  else if (/^(next|next exercise)$/.test(ref)) {
    const index = exercises.findIndex(e => e.id === activeId);
    const next = index >= 0 ? exercises.slice(index + 1).find(e => e.status !== "SKIPPED") : undefined;
    candidates = next ? [next] : [];
  } else {
    const ordinal = ref.match(/^(first|second|third|fourth|\d+)(?: exercise| one)?$/);
    if (ordinal) {
      const n = ({ first: 1, second: 2, third: 3, fourth: 4 } as Record<string, number>)[ordinal[1]!] ?? Number(ordinal[1]);
      candidates = exercises[n - 1] ? [exercises[n - 1]!] : [];
    } else {
      const names = (e: ConversationExercise) => [e.name, ...e.aliases].map(normalized);
      candidates = exercises.filter(e => e.id === reference || e.identityId === reference || names(e).includes(ref));
      if (!candidates.length && ref.length >= 3) candidates = exercises.filter(e => names(e).some(n => n.startsWith(`${ref} `) || n.split(" ").includes(ref)));
      if (!candidates.length && ref.length >= 5) {
        const scored = exercises.map(e => ({ e, score: Math.min(...names(e).map(n => editDistance(ref, n))) })).sort((a, b) => a.score - b.score);
        const best = scored[0];
        if (best && best.score <= Math.min(2, Math.floor(ref.length / 4))) candidates = scored.filter(s => s.score < best.score + 2).map(s => s.e);
      }
    }
  }
  const available = candidates.filter(e => e.status !== "SKIPPED");
  if (available.length) candidates = available;
  return candidates.length === 1 ? { status: "RESOLVED", exercise: candidates[0]! } : candidates.length > 1 ? { status: "AMBIGUOUS", candidates } : { status: "UNKNOWN" };
}

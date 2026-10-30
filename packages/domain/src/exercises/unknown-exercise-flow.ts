export function normalizeExerciseName(value: string): string { return value.trim().toLowerCase().replace(/\s+/g, " "); }
export function resolveExerciseIdentity(name: string, identities: Array<{ id: string; name: string }>, aliases: Array<{ identityId: string; alias: string }>): { status: "KNOWN"; id: string } | { status: "UNKNOWN" | "CONFLICT" } {
  const normalized = normalizeExerciseName(name);
  const matches = new Set([
    ...identities.filter(item => item.id === name || normalizeExerciseName(item.name) === normalized).map(item => item.id),
    ...aliases.filter(item => normalizeExerciseName(item.alias) === normalized).map(item => item.identityId)
  ]);
  return matches.size === 1 ? { status: "KNOWN", id: [...matches][0]! } : { status: matches.size ? "CONFLICT" : "UNKNOWN" };
}

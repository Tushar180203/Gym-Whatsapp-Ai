import { ConversationOrchestrator } from "../../domain/src/conversation/orchestrator.js";
import { emptyConversation, type ConversationContext } from "../../domain/src/conversation/state.js";
import { closureContext, type ClosureCase } from "./closure-corpus.js";

// Exercise the real routing boundary without domain effects. This prevents exact
// commands from inflating the common-action model-quality acceptance denominator.
export async function requiresSemanticInterpretation(c: ClosureCase): Promise<boolean> {
  const safe = closureContext(c);
  const exercises = (safe.knownExerciseRefs ?? []).map((name, i) => ({ id: `exercise-${i}`, identityId: `identity-${i}`, name, aliases: (safe.confirmedAliases ?? []).filter(a => a.exerciseRef === name).map(a => a.alias), order: i + 1, status: "PENDING", loadSemantics: "TOTAL_LOAD" }));
  const context: ConversationContext = { workout: { id: "workout", version: 1, status: "ACTIVE", name: "Push", activeExerciseId: exercises.find(e => e.name === safe.activeExercise)?.id ?? null, finishPending: false }, exercises, identities: exercises.map(e => ({ id: e.identityId, name: e.name, aliases: e.aliases })), sets: [], confirmation: null, choices: [{ id: "push", name: "Push" }], preferredWeightUnit: "KG" };
  const state = emptyConversation(); state.workoutId = "workout"; state.workoutVersion = 1;
  if (c.pending) state.stack.push({ kind: "REPLACE", source: "Barbell Bench Press", replacement: "Cable Fly", scope: "AMBIGUOUS", slot: "SCOPE" });
  if (c.aliasSlot) state.stack.push({ kind: "ALIAS", alias: c.aliasSlot === "TARGET" ? "fly machine" : "Barbell Bench Press", exerciseRef: c.aliasSlot === "TARGET" ? null : "Cable Fly", slot: c.aliasSlot });
  let invoked = false;
  await new ConversationOrchestrator({ userId: "fixture", key: c.id, now: () => 1, load: async () => ({ state, context }), refresh: async () => context, save: async () => {}, cancel: async () => {}, confirm: async () => ({ body: "Confirmation required", applied: false }), execute: async () => "Fixture result", log: async () => "Fixture result", plan: async () => "Fixture plan", deterministic: async () => undefined, interpreter: { interpret: async () => { invoked = true; return { schemaVersion: "workout-action.v1", action: { type: "UNKNOWN", reason: "routing probe" }, confidence: "low", requiresClarification: true, rationaleCodes: [], forbiddenDirectMutation: true }; } } }).process(c.message);
  return invoked;
}

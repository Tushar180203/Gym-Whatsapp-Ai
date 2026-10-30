import { z } from "zod";
import { ProposedActionSchema, SetInputSchema } from "../../../contracts/src/ai/actions.js";

const scope = z.enum(["SESSION_ONLY", "PERMANENT_ROUTINE", "AMBIGUOUS"]);
const frame = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ALIAS"), alias: z.string().min(1).max(120), exerciseRef: z.string().nullable(), slot: z.enum(["TARGET", "NAME"]) }).strict(),
  z.object({ kind: z.literal("SET_DRAFT"), load: z.number().finite().nonnegative(), unit: z.enum(["KG", "LB"]).optional(), count: z.number().int().min(1).max(20), exerciseId: z.string() }).strict(),
  z.object({ kind: z.literal("REPLACE"), source: z.string().nullable(), replacement: z.string().nullable(), scope, slot: z.enum(["SOURCE", "REPLACEMENT", "SCOPE"]) }).strict(),
  z.object({ kind: z.literal("CUSTOM"), name: z.string().max(120), confirmationId: z.string() }).strict(),
  z.object({ kind: z.literal("TARGET"), action: ProposedActionSchema, candidates: z.array(z.string()).max(50) }).strict(),
  z.object({ kind: z.literal("CORRECTION"), replacement: SetInputSchema, candidates: z.array(z.string()).max(50) }).strict(),
  z.object({ kind: z.literal("LOAD"), reps: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("SAME_REPS"), referenceSetId: z.string() }).strict(),
  z.object({ kind: z.literal("REPAIR_VALUE"), targetRef: z.string(), value: z.number().finite().nonnegative() }).strict(),
  z.object({ kind: z.literal("REPAIR_EXERCISE"), exerciseRef: z.string().max(120), recentSetId: z.string().nullable() }).strict(),
  z.object({ kind: z.literal("SCOPE"), action: ProposedActionSchema }).strict(),
  z.object({ kind: z.literal("START"), candidates: z.array(z.object({ id: z.string(), name: z.string() }).strict()).max(50) }).strict(),
  z.object({ kind: z.literal("ACTIVE_CHOICE") }).strict(),
  z.object({ kind: z.literal("QUERY"), action: ProposedActionSchema }).strict(),
  z.object({ kind: z.literal("WORKOUT_REPLACE"), candidates: z.array(z.object({ id: z.string(), name: z.string() }).strict()).max(50) }).strict()
]);
export const ConversationStateSchema = z.object({
  schemaVersion: z.literal("conversation.v1"),
  mode: z.enum(["IDLE", "WORKOUT_PROPOSED", "WORKOUT_ACTIVE", "WORKOUT_FINISH_PENDING"]),
  version: z.number().int().nonnegative(),
  workoutId: z.string().nullable(),
  workoutVersion: z.number().int().nullable(),
  expiresAt: z.number().finite().nullable(),
  stack: z.array(frame).max(3),
  recentExerciseId: z.string().nullable(),
  recentSetId: z.string().nullable(),
  lastQuestion: z.string().max(512).nullable(),
  lastEventAt: z.number().finite().nullable(),
  recentChange: z.object({ action: ProposedActionSchema, expiresAt: z.number().finite(), workoutId: z.string(), workoutVersion: z.number().int() }).strict().nullable().default(null)
}).strict();
export type ConversationState = z.infer<typeof ConversationStateSchema>;
export type PendingFrame = ConversationState["stack"][number];
export function emptyConversation(): ConversationState {
  return { schemaVersion: "conversation.v1", mode: "IDLE", version: 0, workoutId: null, workoutVersion: null, expiresAt: null, stack: [], recentExerciseId: null, recentSetId: null, lastQuestion: null, lastEventAt: null, recentChange: null };
}
export type ConversationExercise = { id: string; identityId: string; name: string; aliases: string[]; order: number; status: string; plannedSets?: number | null; repsMin?: number | null; repsMax?: number | null; recordedSets?: number; loadSemantics?: string };
export type ConversationSet = { id: string; exerciseId: string; index: number; load: number; unit: "KG" | "LB"; semantics: string; reps: number };
export type ConversationContext = {
  timeZone?: string;
  recentConversation?: import("./memory.js").ConversationTurn[];
  preferredWeightUnit?: "KG" | "LB";
  workout: { id: string; version: number; status: string; name: string; activeExerciseId: string | null; finishPending: boolean; templateId?: string } | null;
  exercises: ConversationExercise[];
  identities: Array<{ id: string; name: string; aliases: string[] }>;
  sets: ConversationSet[];
  confirmation: { id: string; actionType: string } | null;
  choices: Array<{ id: string; name: string }>;
};
export function conversationMode(context: ConversationContext): ConversationState["mode"] {
  return !context.workout ? "IDLE" : context.workout.finishPending ? "WORKOUT_FINISH_PENDING" : context.workout.status === "PROPOSED" ? "WORKOUT_PROPOSED" : "WORKOUT_ACTIVE";
}

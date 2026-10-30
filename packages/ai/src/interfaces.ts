import type { ProposedActionEnvelope } from "../../contracts/src/index.js";

export type AiInterpretationContext = {
  userId: string;
  clock?: { now: string; timeZone: string; localDate: string; localTime: string };
  recentConversation?: import("../../domain/src/conversation/memory.js").ConversationTurn[];
  locale?: string;
  activeWorkout?: boolean;
  activeExercise?: string;
  preferredWeightUnit?: "KG" | "LB";
  previousSet?: {
    loadValue: number;
    weightUnit: "KG" | "LB";
    loadSemantics: string;
    reps?: number;
  };
  completedSetsForActiveExercise?: Array<{
    ordinal: number;
    loadValue: number;
    weightUnit: "KG" | "LB";
    reps: number;
  }>;
  activeExerciseContext?: {
    name: string;
    plannedSets?: number | null;
    repsMin?: number | null;
    repsMax?: number | null;
    loadSemantics?: string;
  };
  knownExerciseRefs?: string[];
  confirmedAliases?: Array<{ alias: string; exerciseRef: string }>;
  conversationMode?: "IDLE" | "WORKOUT_PROPOSED" | "WORKOUT_ACTIVE" | "WORKOUT_FINISH_PENDING";
  pendingAction?: string | null;
  pendingOperation?: { type: "REPLACE_EXERCISE"; sourceExercise: string | null; replacementExercise: string | null; scope: string; awaiting: string };
  pendingQuestion?: string | null;
  pendingProposal?: import("../../contracts/src/ai/actions.js").ProposedAction;
  workoutContext?: { name: string; status: string; exercises: Array<{ name: string; plannedSets?: number | null; repsMin?: number | null; repsMax?: number | null; loadSemantics?: string }> };
  partialSetDraft?: { loadValue: number; weightUnit?: "KG" | "LB"; count: number };
  recentReferencedExercise?: string;
  recentReferencedSet?: { exercise: string; index: number; loadValue: number; reps: number };
  activeLoadSemantics?: string;
  allowedActionTypes?: string[];
};

export type IntentInterpretRequest = {
  userInput: string;
  context: AiInterpretationContext;
  idempotencyKey: string;
};

export type StructuredOutputRequest = {
  model: string;
  schemaName: string;
  schemaVersion: string;
  systemPrompt: string;
  userText: string;
  responseSchema: Record<string, unknown>;
  timeoutMs?: number;
};

export type StructuredOutputResponse = {
  rawJson: unknown;
  providerRequestId?: string;
  model: string;
};

export interface StructuredOutputClient {
  createStructuredOutput(request: StructuredOutputRequest): Promise<StructuredOutputResponse>;
}

export interface IntentInterpreter {
  readonly promptVersion?: string;
  interpret(request: IntentInterpretRequest): Promise<ProposedActionEnvelope>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly code = "AI_PROVIDER_ERROR",
    readonly retryable = true,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export class AiSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSchemaError";
  }
}

export class AiRateLimitError extends AiProviderError {
  constructor(message = "AI provider rate limited request") {
    super(message, "AI_RATE_LIMIT", true);
    this.name = "AiRateLimitError";
  }
}

export interface PromptRegistry {
  getPrompt(name: "intent-interpreter", schemaVersion: string): {
    name: string;
    promptVersion: string;
    schemaVersion: string;
    systemPrompt: string;
    responseSchema: Record<string, unknown>;
    model: string;
  };
}

export type InterpretationSource = "DETERMINISTIC" | "AI";

export type AiFallbackResult =
  | { source: "DETERMINISTIC"; aiCalled: false; deterministicResult: unknown }
  | { source: "AI"; aiCalled: true; envelope: ProposedActionEnvelope };

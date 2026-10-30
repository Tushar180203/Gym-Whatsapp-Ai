import {
  parseProposedActionEnvelope,
  workoutActionSchemaVersion,
  type ProposedActionEnvelope
} from "../../contracts/src/index.js";
import { DomainError } from "../../persistence/src/index.js";
import { AiSchemaError, type AiFallbackResult, type IntentInterpretRequest, type IntentInterpreter, type PromptRegistry, type StructuredOutputClient } from "./interfaces.js";

export class StructuredIntentInterpreter implements IntentInterpreter {
  constructor(
    private readonly client: StructuredOutputClient,
    private readonly prompts: PromptRegistry
  ) {}

  get promptVersion(): string {
    return this.prompts.getPrompt("intent-interpreter", workoutActionSchemaVersion).promptVersion;
  }

  async interpret(request: IntentInterpretRequest): Promise<ProposedActionEnvelope> {
    // Explicit allowlist: callers may contain owner IDs or additional runtime fields.
    const { clock, recentConversation, locale, activeWorkout, activeExercise, activeExerciseContext, completedSetsForActiveExercise, preferredWeightUnit, previousSet, knownExerciseRefs, confirmedAliases, conversationMode, pendingAction, pendingOperation, pendingQuestion, pendingProposal, workoutContext, partialSetDraft, recentReferencedExercise, recentReferencedSet, activeLoadSemantics, allowedActionTypes } = request.context;
    const safeContext = { clock, recentConversation: recentConversation?.slice(-24).map(({ role, content, occurredAt }) => ({ role, content: content.slice(0, 1000), occurredAt })), locale, activeWorkout, activeExercise, activeExerciseContext, completedSetsForActiveExercise, preferredWeightUnit, previousSet, knownExerciseRefs, confirmedAliases, conversationMode, pendingAction, pendingOperation, pendingQuestion, pendingProposal, workoutContext, partialSetDraft, recentReferencedExercise, recentReferencedSet, activeLoadSemantics, allowedActionTypes };
    const prompt = this.prompts.getPrompt("intent-interpreter", workoutActionSchemaVersion);
    const response = await this.client.createStructuredOutput({
      model: prompt.model,
      schemaName: "ProposedActionEnvelope",
      schemaVersion: prompt.schemaVersion,
      systemPrompt: prompt.systemPrompt,
      userText: JSON.stringify({
        userText: request.userInput,
        context: safeContext
      }),
      responseSchema: prompt.responseSchema
    });

    try {
      return parseProposedActionEnvelope(response.rawJson);
    } catch (error) {
      throw new AiSchemaError(error instanceof Error ? error.message : "AI structured output failed schema validation");
    }
  }
}

export async function interpretWithDeterministicFirst(
  deterministic: () => Promise<unknown> | unknown,
  ai: () => Promise<ProposedActionEnvelope>
): Promise<AiFallbackResult> {
  try {
    return { source: "DETERMINISTIC", aiCalled: false, deterministicResult: await deterministic() };
  } catch (error) {
    if (error instanceof DomainError && error.code === "NO_SET_NOTATION") {
      return { source: "AI", aiCalled: true, envelope: await ai() };
    }
    throw error;
  }
}

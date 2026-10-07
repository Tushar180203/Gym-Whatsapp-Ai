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

  async interpret(request: IntentInterpretRequest): Promise<ProposedActionEnvelope> {
    const prompt = this.prompts.getPrompt("intent-interpreter", workoutActionSchemaVersion);
    const response = await this.client.createStructuredOutput({
      model: prompt.model,
      schemaName: "ProposedActionEnvelope",
      schemaVersion: prompt.schemaVersion,
      systemPrompt: prompt.systemPrompt,
      userText: JSON.stringify({
        userText: request.userInput,
        context: request.context
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

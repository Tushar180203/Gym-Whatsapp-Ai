import { AiProviderError, type StructuredOutputClient } from "../interfaces.js";
import { GeminiStructuredOutputClient, type GeminiStructuredOutputClientConfig } from "./gemini-structured-output-client.js";

export function createStructuredOutputClient(
  provider = process.env.AI_PROVIDER ?? "gemini",
  config: GeminiStructuredOutputClientConfig = {}
): StructuredOutputClient {
  if (provider !== "gemini") {
    throw new AiProviderError("Unsupported AI_PROVIDER configuration", "AI_PROVIDER_NOT_CONFIGURED", false);
  }
  return new GeminiStructuredOutputClient(config);
}

import {
  AiProviderError,
  AiRateLimitError,
  type StructuredOutputClient,
  type StructuredOutputRequest,
  type StructuredOutputResponse
} from "../interfaces.js";

export type OpenAIStructuredOutputClientConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export class OpenAIStructuredOutputClient implements StructuredOutputClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OpenAIStructuredOutputClientConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async createStructuredOutput(request: StructuredOutputRequest): Promise<StructuredOutputResponse> {
    if (!this.apiKey) throw new AiProviderError("OPENAI_API_KEY is required", "AI_PROVIDER_NOT_CONFIGURED", false);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 15000);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          store: false,
          input: [
            { role: "system", content: [{ type: "input_text", text: request.systemPrompt }] },
            { role: "user", content: [{ type: "input_text", text: request.userText }] }
          ],
          text: {
            format: {
              type: "json_schema",
              name: request.schemaName,
              schema: request.responseSchema,
              strict: true
            }
          }
        })
      });

      if (response.status === 429) throw new AiRateLimitError();
      if (!response.ok) {
        throw new AiProviderError(`AI provider returned HTTP ${response.status}`, "AI_PROVIDER_HTTP_ERROR", response.status >= 500);
      }

      const body = (await response.json()) as OpenAIResponsesBody;
      if (body.output?.some((item) => item.content?.some((content) => content.type === "refusal"))) {
        throw new AiProviderError("AI provider refused the request", "AI_PROVIDER_REFUSAL", false);
      }
      if (body.status === "incomplete") {
        throw new AiProviderError("AI provider output was incomplete", "AI_PROVIDER_INCOMPLETE", true);
      }
      return {
        rawJson: omitProviderNulls(extractJson(body)),
        ...(body.id ? { providerRequestId: body.id } : {}),
        model: body.model ?? request.model
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AiProviderError("AI provider request timed out", "AI_PROVIDER_TIMEOUT", true);
      }
      throw new AiProviderError(error instanceof Error ? error.message : "AI provider request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

type OpenAIResponsesBody = {
  status?: string;
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function extractJson(body: OpenAIResponsesBody): unknown {
  const text =
    body.output_text ??
    body.output?.flatMap((item) => item.content ?? []).find((content) => content.type === "output_text")?.text;
  if (!text) throw new AiProviderError("AI provider response did not include structured output text", "AI_PROVIDER_EMPTY_OUTPUT", true);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiProviderError("AI provider returned malformed JSON", "AI_PROVIDER_MALFORMED_JSON", true);
  }
}

function omitProviderNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitProviderNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => child !== null)
    .map(([key, child]) => [key, omitProviderNulls(child)]));
}

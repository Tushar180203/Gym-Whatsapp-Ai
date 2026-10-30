import { AiProviderError, AiRateLimitError, AiSchemaError, type StructuredOutputClient, type StructuredOutputRequest, type StructuredOutputResponse } from "../interfaces.js";
import { z } from "zod";

export type GeminiStructuredOutputClientConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

const responseSchema = z.object({
  responseId: z.string().optional(),
  modelVersion: z.string().optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({
    finishReason: z.string().optional(),
    content: z.object({ parts: z.array(z.object({
      text: z.string().optional(), thought: z.boolean().optional()
    })) }).optional()
  })).optional()
});

const refusalReasons = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"]);

export class GeminiStructuredOutputClient implements StructuredOutputClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GeminiStructuredOutputClientConfig = {}) {
    this.apiKey = config.apiKey ?? process.env.GEMINI_API_KEY ?? "";
    this.baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async createStructuredOutput(request: StructuredOutputRequest): Promise<StructuredOutputResponse> {
    if (!this.apiKey) throw new AiProviderError("GEMINI_API_KEY is required", "AI_PROVIDER_NOT_CONFIGURED", false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 15000);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`, {
        method: "POST", signal: controller.signal,
        headers: { "x-goog-api-key": this.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: request.userText }] }],
          generationConfig: {
            candidateCount: 1,
            responseMimeType: "application/json",
            responseSchema: geminiJsonSchema(request.responseSchema)
          }
        })
      });
      if (response.status === 429) throw new AiRateLimitError();
      if (response.status === 408 || response.status === 504) {
        throw new AiProviderError("AI provider request timed out", "AI_PROVIDER_TIMEOUT", true);
      }
      if (!response.ok) {
        throw new AiProviderError(`AI provider returned HTTP ${response.status}`, "AI_PROVIDER_HTTP_ERROR", response.status >= 500, response.status);
      }
      let raw: unknown;
      try { raw = await response.json(); }
      catch { throw new AiSchemaError("AI provider returned malformed response JSON"); }
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) throw new AiSchemaError("AI provider returned an invalid response shape");
      const body = parsed.data;
      const blockReason = body.promptFeedback?.blockReason;
      const candidate = body.candidates?.[0];
      if ((blockReason && blockReason !== "BLOCK_REASON_UNSPECIFIED") || refusalReasons.has(candidate?.finishReason ?? "")) {
        throw new AiProviderError("AI provider refused the request", "AI_PROVIDER_REFUSAL", false);
      }
      if (candidate?.finishReason === "MAX_TOKENS") {
        throw new AiProviderError("AI provider output was incomplete", "AI_PROVIDER_INCOMPLETE", true);
      }
      if (candidate?.finishReason && candidate.finishReason !== "STOP") {
        throw new AiProviderError("AI provider could not complete the request", "AI_PROVIDER_ERROR", true);
      }
      const text = candidate?.content?.parts.filter((part) => !part.thought).map((part) => part.text ?? "").join("");
      if (!text) throw new AiSchemaError("AI provider response did not include structured output");
      let output: unknown;
      try { output = JSON.parse(text); }
      catch { throw new AiSchemaError("AI provider returned malformed structured JSON"); }
      return {
        rawJson: omitNulls(output),
        model: body.modelVersion ?? request.model,
        ...(body.responseId ? { providerRequestId: body.responseId } : {})
      };
    } catch (error) {
      if (controller.signal.aborted) throw new AiProviderError("AI provider request timed out", "AI_PROVIDER_TIMEOUT", true);
      if (error instanceof AiProviderError || error instanceof AiSchemaError) throw error;
      throw new AiProviderError("AI provider request failed", "AI_PROVIDER_ERROR", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Live diagnostics show bounded array constraints cause HTTP 400 for the expanded contract.
// Gemini supports a schema subset; all omitted constraints remain enforced by Zod.
export function geminiJsonSchema(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const schema = value as Record<string, unknown>;
  const supported = new Set(["type", "format", "title", "description", "enum", "required", "minimum", "maximum", "$ref"]);
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(schema)) {
    if (key === "properties" || key === "$defs") {
      result[key] = Object.fromEntries(Object.entries(child as Record<string, unknown>).map(([name, item]) => [name, geminiJsonSchema(item)]));
    } else if (key === "anyOf" || key === "oneOf") {
      result.anyOf = (child as unknown[]).map(geminiJsonSchema);
    } else if (key === "items") {
      result.items = geminiJsonSchema(child);
    } else if (key === "const") {
      if (typeof child === "string" || typeof child === "number") result.enum = [child];
      if (typeof child === "boolean") result.description = `Must always equal ${child}. This constraint is validated locally.`;
    } else if (supported.has(key)) {
      result[key] = child;
    }
  }
  return result;
}

function omitNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitNulls);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== null).map(([key, child]) => [key, omitNulls(child)]));
}

import { describe, expect, it } from "vitest";
import { AiProviderError, AiRateLimitError, OpenAIStructuredOutputClient, StaticPromptRegistry, StructuredIntentInterpreter } from "../index.js";
import { proposedActionJsonSchema } from "../prompt-registry.js";

const request = {
  model: "mock-model",
  schemaName: "ProposedActionEnvelope",
  schemaVersion: "workout-action.v1",
  systemPrompt: "system",
  userText: "user",
  responseSchema: {}
};

describe("OpenAIStructuredOutputClient", () => {
  it("maps successful structured output without leaking provider types", async () => {
    const client = new OpenAIStructuredOutputClient({
      apiKey: "test-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            id: "resp_123",
            model: "mock-model",
            output_text: JSON.stringify({ ok: true })
          }),
          { status: 200 }
        )
    });
    await expect(client.createStructuredOutput(request)).resolves.toEqual({
      rawJson: { ok: true },
      providerRequestId: "resp_123",
      model: "mock-model"
    });
  });

  it("normalizes provider rate limits, errors, and malformed output", async () => {
    await expect(
      new OpenAIStructuredOutputClient({
        apiKey: "test-key",
        fetchImpl: async () => new Response("{}", { status: 429 })
      }).createStructuredOutput(request)
    ).rejects.toBeInstanceOf(AiRateLimitError);

    await expect(
      new OpenAIStructuredOutputClient({
        apiKey: "test-key",
        fetchImpl: async () => new Response("{}", { status: 500 })
      }).createStructuredOutput(request)
    ).rejects.toMatchObject({ code: "AI_PROVIDER_HTTP_ERROR", retryable: true });

    await expect(
      new OpenAIStructuredOutputClient({
        apiKey: "test-key",
        fetchImpl: async () => new Response(JSON.stringify({ output_text: "not-json" }), { status: 200 })
      }).createStructuredOutput(request)
    ).rejects.toBeInstanceOf(AiProviderError);
  });

  it("generates closed strict schemas with required nullable optional fields", () => {
    function inspect(value: unknown): void {
      if (Array.isArray(value)) { value.forEach(inspect); return; }
      if (!value || typeof value !== "object") return;
      const schema = value as Record<string, unknown>;
      if (schema.type === "object") {
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required).toEqual(Object.keys(schema.properties as object));
      }
      Object.values(schema).forEach(inspect);
    }
    inspect(proposedActionJsonSchema);
    expect(JSON.stringify(proposedActionJsonSchema)).toContain("LOG_MULTIPLE_SETS");
  });

  it("accepts nullable provider fields and validates the normalized local action", async () => {
    const client = new OpenAIStructuredOutputClient({
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init!.body as string);
        expect(body.store).toBe(false);
        expect(body.text.format.strict).toBe(true);
        return new Response(JSON.stringify({ output: [{ content: [{
          type: "output_text", text: JSON.stringify({
            schemaVersion: "workout-action.v1", action: { type: "START_WORKOUT", sessionRef: null, routineRef: null },
            confidence: "medium", requiresClarification: false, clarificationQuestion: null,
            rationaleCodes: [], forbiddenDirectMutation: true
          })
        }] }] }));
      }
    });
    const interpreter = new StructuredIntentInterpreter(client, new StaticPromptRegistry("mock"));
    await expect(interpreter.interpret({
      userInput: "let's train", context: { userId: "test" }, idempotencyKey: "test"
    })).resolves.toMatchObject({ action: { type: "START_WORKOUT" } });
  });

  it("normalizes timeout, refusal, and incomplete output", async () => {
    const timeoutClient = new OpenAIStructuredOutputClient({
      apiKey: "test-key",
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
    });
    await expect(timeoutClient.createStructuredOutput({ ...request, timeoutMs: 1 }))
      .rejects.toMatchObject({ code: "AI_PROVIDER_TIMEOUT", retryable: true });
    for (const [body, code, retryable] of [
      [{ output: [{ content: [{ type: "refusal" }] }] }, "AI_PROVIDER_REFUSAL", false],
      [{ status: "incomplete" }, "AI_PROVIDER_INCOMPLETE", true]
    ] as const) {
      await expect(new OpenAIStructuredOutputClient({
        apiKey: "test-key", fetchImpl: async () => new Response(JSON.stringify(body))
      }).createStructuredOutput(request)).rejects.toMatchObject({ code, retryable });
    }
  });
});

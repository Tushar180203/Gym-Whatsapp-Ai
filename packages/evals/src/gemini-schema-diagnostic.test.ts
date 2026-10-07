import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { proposedActionJsonSchema } from "../../ai/src/prompt-registry.js";
import { geminiJsonSchema } from "../../ai/src/providers/gemini-structured-output-client.js";

export function schemaSummary(schema: unknown) {
  const counts: Record<string, number> = {};
  let maxDepth = 0;
  function walk(value: unknown, depth: number): void {
    maxDepth = Math.max(maxDepth, depth);
    if (Array.isArray(value)) { value.forEach((child) => walk(child, depth + 1)); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      counts[key] = (counts[key] ?? 0) + 1;
      walk(child, depth + 1);
    }
  }
  walk(schema, 0);
  return { bytes: Buffer.byteLength(JSON.stringify(schema)), maxJsonDepth: maxDepth,
    anyOf: counts.anyOf ?? 0, oneOf: counts.oneOf ?? 0, refs: counts.$ref ?? 0,
    defs: counts.$defs ?? 0, nullTypes: JSON.stringify(schema).match(/"type":"null"/g)?.length ?? 0,
    keywordCounts: counts };
}

export function sanitizedError(body: unknown, key: string): unknown {
  if (!body || typeof body !== "object") return { message: "Non-JSON error response" };
  const error = (body as { error?: { code?: number; status?: string; message?: string } }).error;
  return {
    code: error?.code, status: error?.status,
    message: error?.message?.split(key).join("[REDACTED_KEY]")
  };
}

function withoutAdditionalProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAdditionalProperties);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== "additionalProperties")
    .map(([name, child]) => [name, withoutAdditionalProperties(child)]));
}

describe("Gemini schema diagnostics", () => {
  it("captures the current provider schema without credentials or conversation data", () => {
    if (process.env.CAPTURE_GEMINI_SCHEMA !== "1") return;
    const schema = geminiJsonSchema(proposedActionJsonSchema);
    mkdirSync("packages/evals/diagnostics", { recursive: true });
    writeFileSync("packages/evals/diagnostics/gemini-current-schema.json", JSON.stringify(schema, null, 2) + "\n");
    console.log(JSON.stringify({ generationConfigField: "responseSchema", summary: schemaSummary(schema) }));
    expect(schema).toBeDefined();
  });

  it("redacts credentials from diagnostic errors and excludes arbitrary provider fields", () => {
    expect(sanitizedError({ error: { code: 400, status: "INVALID_ARGUMENT", message: "schema rejected test-secret", extra: "not reported" } }, "test-secret"))
      .toEqual({ code: 400, status: "INVALID_ARGUMENT", message: "schema rejected [REDACTED_KEY]" });
  });

  it.skipIf(process.env.RUN_GEMINI_SCHEMA_DIAGNOSTIC !== "1")("probes full and progressively reduced schemas with synthetic input", async () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is required for live schema diagnostics");
    const model = process.env.AI_MODEL ?? "gemini-3.5-flash-lite";
    const original = JSON.parse(readFileSync("packages/evals/diagnostics/gemini-original-schema.json", "utf8")) as Record<string, unknown>;
    const properties = original.properties as Record<string, unknown>;
    const action = properties.action as { anyOf: Array<{ properties: { type: { enum: string[] } } }> };
    const report: unknown[] = [];
    async function probe(name: string, schema: unknown, format = false) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", headers: { "x-goog-api-key": key!, "content-type": "application/json" },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Return UNKNOWN with a short reason." }] }],
          generationConfig: format ? { responseFormat: { text: { mimeType: "application/json", schema } } }
            : { responseMimeType: "application/json", responseSchema: schema }
        })
      });
      const body: unknown = await response.json();
      const entry = { name, status: response.status, summary: schemaSummary(schema),
        ...(response.ok ? {} : { error: sanitizedError(body, key!) }) };
      report.push(entry);
      console.log(JSON.stringify(entry));
      if (response.status === 429) throw new Error("Schema diagnostics stopped at provider rate limit");
    }
    try {
      if (process.env.GEMINI_SCHEMA_REDUCED_ONLY !== "1") {
        await probe("original-runtime-format-full", original, true);
        await probe("original-full-responseSchema", original);
      }
      for (const [name, types] of [
        ["A-UNKNOWN", ["UNKNOWN"]],
        ["B-add-LOG_SET", ["UNKNOWN", "LOG_SET"]],
        ["C-add-LOG_MULTIPLE_SETS", ["UNKNOWN", "LOG_SET", "LOG_MULTIPLE_SETS"]],
        ["D-corrections-session", ["UNKNOWN", "LOG_SET", "LOG_MULTIPLE_SETS", "CORRECT_SET", "DELETE_SET", "CHANGE_SESSION", "UPDATE_ROUTINE_REQUEST"]],
        ["E-all-variants", action.anyOf.map((variant) => variant.properties.type.enum[0]!)]
      ] as const) {
        const reduced = { ...original, properties: { ...properties, action: {
          anyOf: action.anyOf.filter((variant) => (types as readonly string[]).includes(variant.properties.type.enum[0]!))
        } } };
        await probe(name, process.env.GEMINI_SCHEMA_REDUCED_ONLY === "1" ? withoutAdditionalProperties(reduced) : reduced);
      }
      if (process.env.GEMINI_SCHEMA_REDUCED_ONLY === "1") return;
      const minimal = { type: "OBJECT", properties: {
        schemaVersion: { type: "STRING", enum: ["workout-action.v1"] },
        confidence: { type: "STRING", enum: ["low", "medium", "high"] },
        requiresClarification: { type: "BOOLEAN" },
        rationaleCodes: { type: "ARRAY", items: { type: "STRING" } },
        forbiddenDirectMutation: { type: "BOOLEAN" },
        action: { type: "OBJECT", properties: {
          type: { type: "STRING", enum: ["UNKNOWN"] }, reason: { type: "STRING" }
        }, required: ["type", "reason"] }
      }, required: ["schemaVersion", "confidence", "requiresClarification", "rationaleCodes", "forbiddenDirectMutation", "action"] };
      await probe("native-UNKNOWN-baseline", minimal);
      await probe("native-plus-additionalProperties", { ...minimal, additionalProperties: false });
      await probe("native-plus-null-anyOf", { ...minimal, properties: {
        ...minimal.properties, clarificationQuestion: { anyOf: [{ type: "STRING" }, { type: "null" }] }
      } });
    } finally {
      mkdirSync("packages/evals/diagnostics", { recursive: true });
      writeFileSync(`packages/evals/diagnostics/gemini-schema-${process.env.GEMINI_SCHEMA_REDUCED_ONLY === "1" ? "reduced" : "diagnostic"}-results.json`, JSON.stringify(report, null, 2) + "\n");
    }
  }, 240000);
});

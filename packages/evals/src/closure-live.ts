import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { closureCorpus, closureCorpusVersion, closureContext, type ClosureCase } from "./closure-corpus.js";
import { historicalSemanticCorpus, historicalSemanticCorpusV3 } from "./historical-semantic-corpus.js";
import { runMetadata, writeResultArtifact } from "./result-artifacts.js";
import { StructuredIntentInterpreter } from "../../ai/src/structured-intent-interpreter.js";
import { GeminiStructuredOutputClient } from "../../ai/src/providers/gemini-structured-output-client.js";
import { StaticPromptRegistry, defaultIntentModel } from "../../ai/src/prompt-registry.js";
import { AiProviderError } from "../../ai/src/interfaces.js";
import { scoreClosure, closureScoringVersion } from "./closure-scoring.js";
export { scoreClosure } from "./closure-scoring.js";
import { pathToFileURL } from "node:url";
export async function runClosureLive() {
  if (process.env.RUN_LIVE_CONVERSATION_EVAL !== "1") throw new Error("Live evaluation requires explicit opt-in");
  let local: Record<string, string | undefined> = {}; try { local = parseEnv(readFileSync(".env", "utf8")); } catch { /* env-only */ }
  const env = { ...local, ...process.env }; if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY required");
  const model = env.AI_MODEL ?? defaultIntentModel;
  const corpus = env.CLOSURE_CORPUS === "historical-v3" ? historicalSemanticCorpusV3 : env.CLOSURE_CORPUS === "historical" ? historicalSemanticCorpus : closureCorpus;
  const corpusVersion = env.CLOSURE_CORPUS === "historical-v3" ? "historical-semantic.v3" : env.CLOSURE_CORPUS === "historical" ? "historical-semantic.v2" : closureCorpusVersion;
  const root = "specs/001-whatsapp-workout-companion/evaluation-runs";
  const versions = (env.CLOSURE_PROMPTS ?? "v12").split(",") as Array<"v6" | "v7" | "v8" | "v9" | "v10" | "v11" | "v12">;
  for (const version of versions) {
    const registry = new StaticPromptRegistry(model, version); const prompt = registry.getPrompt("intent-interpreter", "workout-action.v1");
    const metadata = runMetadata({ promptVersion: prompt.promptVersion, model, corpusVersion, resultType: "LIVE_GEMINI" });
    const interpreter = new StructuredIntentInterpreter(new GeminiStructuredOutputClient({ apiKey: env.GEMINI_API_KEY }), registry);
    const corpusHash = createHash("sha256").update(JSON.stringify(corpus)).digest("hex");
    const results: any[] = []; let lastCall = 0; let stopReason: string | null = null;
    for (const c of corpus.filter(c => !env.CLOSURE_IDS || env.CLOSURE_IDS.split(",").includes(c.id))) {
      await delay(Math.max(0, lastCall + Number(env.LIVE_CONVERSATION_INTERVAL_MS ?? 13000) - Date.now())); lastCall = Date.now();
      try {
        const proposal = await interpreter.interpret({ userInput: c.message, context: closureContext(c), idempotencyKey: c.id });
        const score = scoreClosure(c, proposal); results.push({ ...c, proposal, score, failureCategory: score.correct ? null : !score.intent ? c.category : !score.entity ? "AI_ENTITY" : !score.scope ? "AI_SCOPE" : !score.clarification ? "REFERENCE_RESOLUTION" : "AI_INTENT" });
      } catch (error) {
        results.push({ ...c, score: { intent: false, entity: false, scope: false, clarification: false, security: false, correct: false }, failureCategory: error instanceof AiProviderError ? "PROVIDER" : "AI_ENTITY", error: error instanceof AiProviderError ? error.code : "SCHEMA_REJECTED" });
        if (error instanceof AiProviderError && (error.httpStatus === 429 || error.code === "AI_RATE_LIMIT")) stopReason = "PROVIDER_RATE_LIMIT";
      }
      console.log(JSON.stringify({ prompt: version, id: c.id, correct: results.at(-1).score.correct, failure: results.at(-1).failureCategory }));
      writeResultArtifact(root, metadata, { results, corpusHash, scoringVersion: closureScoringVersion, promptHash: createHash("sha256").update(prompt.systemPrompt).digest("hex"), schemaHash: createHash("sha256").update(JSON.stringify(prompt.responseSchema)).digest("hex") }, `case-${results.length}`);
      if (stopReason) break;
    }
    const pct = (rows: any[], key: string) => rows.length ? 100 * rows.filter(r => r.score[key]).length / rows.length : null;
    const supported = results.filter(r => r.group === "supported" || r.group === "typo"), entities = supported.filter(r => r.fields || r.aliasSlot || r.pending || r.scope), scopes = supported.filter(r => r.scope), ambiguity = results.filter(r => r.group === "ambiguity"), security = results.filter(r => r.group === "security");
    const summary = { cases: results.length, expectedCases: corpus.filter(c => !env.CLOSURE_IDS || env.CLOSURE_IDS.split(",").includes(c.id)).length, complete: !stopReason && results.length === corpus.filter(c => !env.CLOSURE_IDS || env.CLOSURE_IDS.split(",").includes(c.id)).length, stopReason, supportedIntentAccuracy: pct(supported, "intent"), supportedCompleteAccuracy: pct(supported, "correct"), entityAccuracy: pct(entities, "entity"), scopeAccuracy: pct(scopes, "scope"), ambiguityClarification: pct(ambiguity, "clarification"), securityAccuracy: pct(security, "security"), unsafeProposals: results.filter(r => r.score.unsafeProposal).length, failures: Object.fromEntries([...new Set(results.filter(r => r.failureCategory).map(r => r.failureCategory))].map(k => [k, results.filter(r => r.failureCategory === k).length])) };
    console.log(JSON.stringify({ artifact: writeResultArtifact(root, metadata, { summary, corpusHash, scoringVersion: closureScoringVersion, promptHash: createHash("sha256").update(prompt.systemPrompt).digest("hex"), schemaHash: createHash("sha256").update(JSON.stringify(prompt.responseSchema)).digest("hex"), results }), summary }));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runClosureLive().catch(error => { console.error(error.name); process.exitCode = 1; });

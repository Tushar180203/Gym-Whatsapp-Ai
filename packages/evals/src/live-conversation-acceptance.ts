import { runMetadata, writeResultArtifact } from "./result-artifacts.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv, isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../persistence/src/postgres.js";
import { WhatsAppInboundAdapter } from "../../messaging/src/index.js";
import { hashChallenge } from "../../messaging/src/whatsapp/link-challenge.js";
import { GeminiStructuredOutputClient } from "../../ai/src/providers/gemini-structured-output-client.js";
import { StructuredIntentInterpreter } from "../../ai/src/structured-intent-interpreter.js";
import { StaticPromptRegistry, intentPromptVersion, defaultIntentModel } from "../../ai/src/prompt-registry.js";
import { AiProviderError, AiSchemaError, type StructuredOutputClient, type IntentInterpreter, type IntentInterpretRequest, type StructuredOutputRequest } from "../../ai/src/interfaces.js";
import { liveConversationCorpus, type LiveCase } from "./live-conversation-corpus.js";
import { scoreLiveProposal } from "./live-conversation-scoring.js";

type Capture = { context: unknown; proposal?: unknown; validated?: boolean; error?: string; httpStatus?: number };
type Snapshot = { workouts: Record<string, any>[]; sets: Record<string, any>[]; exercises: Record<string, any>[]; planned: Record<string, any>[]; corrections: Record<string, any>[]; cursor: Record<string, any>[] };
type Result = { id: string; group: string; message: string; expected: string; mode: string; pending: unknown; aiInvoked: boolean; capture: Capture[]; localValidation: string; response: string; route: unknown; clarification: boolean; confirmation: boolean; classification: string; violations: string[]; mutation: boolean; outcomeCorrect: boolean; applicationError?: string };

function at(value: any, path: string): unknown { return path.split(".").reduce((v, k) => v?.[k], value); }
function actionMatches(c: LiveCase, capture: Capture): boolean {
  const envelope = capture.proposal as any;
  return capture.validated === true && c.actions.includes(envelope?.action?.type)
    && Object.entries(c.field ?? {}).every(([k, v]) => isDeepStrictEqual(at(envelope.action, k), v));
}

export async function runLiveConversationAcceptance() {
  if (process.env.RUN_LIVE_CONVERSATION_EVAL !== "1") throw new Error("Opt in with RUN_LIVE_CONVERSATION_EVAL=1; this command sends synthetic inputs to Gemini.");
  let local: Record<string, string | undefined> = {};
  try { local = parseEnv(readFileSync(".env", "utf8")); } catch { /* Shell-only configuration is supported. */ }
  const env = { ...local, ...process.env };
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY required");
  if (!env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL required; application DATABASE_URL is never used");
  const model = env.AI_MODEL ?? defaultIntentModel;
  const schema = `live_conversation_${Date.now()}`;
  const admin = new Pool({ connectionString: env.TEST_DATABASE_URL });
  await admin.query(`create schema ${schema}`);
  const url = new URL(env.TEST_DATABASE_URL); url.searchParams.set("options", `-c search_path=${schema}`);
  const connectionString = url.toString();
  const captures: Capture[] = [], events: unknown[] = [];
  let activeCapture: Capture | undefined, lastCall = 0;
  const interval = Number(env.LIVE_CONVERSATION_INTERVAL_MS ?? 13000);
  const live = new GeminiStructuredOutputClient({ apiKey: env.GEMINI_API_KEY });
  let client: StructuredOutputClient = live;
  const recorded: StructuredOutputClient = { async createStructuredOutput(request) {
    if (client === live) {
      await delay(Math.max(0, lastCall + interval - Date.now())); lastCall = Date.now();
    }
    try {
      const result = await client.createStructuredOutput(request);
      if (activeCapture) activeCapture.proposal = result.rawJson;
      return result;
    } catch (error) {
      if (activeCapture) activeCapture.error = error instanceof AiSchemaError ? "AI_SCHEMA_INVALID" : error instanceof AiProviderError ? error.code : "AI_ERROR";
      if (activeCapture && error instanceof AiProviderError && error.httpStatus) activeCapture.httpStatus = error.httpStatus;
      throw error;
    }
  } };
  const registry = new StaticPromptRegistry(model);
  const prompt = registry.getPrompt("intent-interpreter", "workout-action.v1");
  const promptHash = createHash("sha256").update(prompt.systemPrompt).digest("hex");
  const schemaHash = createHash("sha256").update(JSON.stringify(prompt.responseSchema)).digest("hex");
  const interpreted = new StructuredIntentInterpreter(recorded, registry);
  const interpreter: IntentInterpreter = { async interpret(request: IntentInterpretRequest) {
    activeCapture = { context: structuredClone(request.context) }; captures.push(activeCapture);
    try { const envelope = await interpreted.interpret(request); activeCapture.validated = true; return envelope; }
    catch (error) { activeCapture.validated = false; activeCapture.error ??= error instanceof AiSchemaError ? "AI_SCHEMA_INVALID" : "AI_ERROR"; throw error; }
  } };
  const app = new PostgresVerticalSliceApp({ connectionString, interpreter, observe: event => { events.push(event); } });
  const adapter = new WhatsAppInboundAdapter("synthetic-eval-signature-secret");
  let messageIndex = 0, caseIndex = 0;
  const results: Result[] = [], failureResults: Result[] = [];
  const metadata = runMetadata({ promptVersion: intentPromptVersion, model, corpusVersion: "live-conversation.v2", resultType: "LIVE_GEMINI" });
  const artifactRoot = "specs/001-whatsapp-workout-companion/evaluation-runs";
  async function send(text: string, sender: string) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "synthetic-business", changes: [{ value: { metadata: { phone_number_id: "synthetic-provider-account" }, messages: [{ id: `live-eval-${messageIndex++}`, from: sender, text: { body: text } }] } }] }] });
    return app.processInbound(adapter.normalize(raw, adapter.sign(raw))[0]!);
  }
  async function snapshot(userId: string): Promise<Snapshot> {
    const q = async (sql: string) => (await app.pool.query(sql, [userId])).rows;
    return { workouts: await q("select * from workout_sessions where user_id=$1 order by created_at,id"), sets: await q("select * from workout_sets where user_id=$1 order by created_at,set_index,id"),
      exercises: await q("select se.* from session_exercises se join workout_sessions w on w.id=se.workout_session_id where w.user_id=$1 order by se.id"), planned: await q("select p.* from planned_exercises p join workout_session_templates t on t.id=p.session_template_id join routines r on r.id=t.routine_id where r.user_id=$1 order by p.id"),
      corrections: await q("select * from corrections where user_id=$1 order by id"), cursor: await q("select * from routine_sequence_cursors where user_id=$1 order by id") };
  }
  async function evaluate(c: LiveCase): Promise<Result> {
    const n = caseIndex++, sender = `1555000${String(n).padStart(4, "0")}`;
    const user = await app.signUp(`synthetic-live-${n}@example.invalid`, "synthetic test account password");
    await app.configure(user.sessionToken, config => config.profile({ preferredWeightUnit: "KG" }));
    const definitions = [
      { name: c.mode === "AMBIGUOUS" ? "Flat Barbell Bench Press" : "Barbell Bench Press", aliases: ["bench"], defaultLoadSemantics: "TOTAL_LOAD" as const },
      { name: "Cable Fly", aliases: ["flys", "fly", "cable"], defaultLoadSemantics: "MACHINE_STACK" as const },
      { name: "Shoulder Press", aliases: ["shoulders"], defaultLoadSemantics: "MACHINE_STACK" as const },
      { name: "Lateral Raise", aliases: ["lateral raises"], defaultLoadSemantics: "PER_HAND_PER_SIDE" as const },
      { name: "Incline Press", aliases: ["incline press"], defaultLoadSemantics: "TOTAL_LOAD" as const }
    ];
    if (c.mode === "AMBIGUOUS") definitions.push({ name: "Incline Barbell Bench Press", aliases: ["bench"], defaultLoadSemantics: "TOTAL_LOAD" });
    const identities: string[] = [];
    for (const definition of definitions) {
      const existing = (await app.configure(user.sessionToken, config => config.exercises())).find(e => e.displayName === definition.name);
      const saved = existing ?? await app.configure(user.sessionToken, config => config.customExercise({ name: definition.name, defaultLoadSemantics: definition.defaultLoadSemantics, confirm: true }));
      if (!("id" in saved)) throw new Error("Synthetic identity fixture could not be confirmed"); identities.push(saved.id);
      for (const alias of definition.aliases) {
        if (c.mode === "AMBIGUOUS" && alias === "bench") continue;
        await app.configure(user.sessionToken, config => config.alias(saved.id, { alias, confirm: true }));
      }
    }
    await app.configure(user.sessionToken, config => config.saveRoutine({ name: "Recorded rotation", sessions: [{ name: "Push", exercises: identities.map(id => ({ exerciseIdentityId: id, plannedSetCount: 3, repTargetMin: 8, repTargetMax: 10 })) }] }));
    await send(`LINK ${await app.createLinkToken(user.userId, hashChallenge(sender))}`, sender);
    if (c.mode !== "IDLE") {
      await send("start", sender); await send("start", sender);
      if (c.mode !== "EMPTY") { await send("50x10", sender); await send("50x10", sender); }
    }
    if (c.mode === "PENDING") await send("replace bench with cable fly", sender);
    const before = await snapshot(user.userId);
    const stateBefore = (await app.pool.query("select state from conversation_states where user_id=$1", [user.userId])).rows[0]?.state;
    captures.length = 0; events.length = 0;
    let response = "", applicationError: string | undefined;
    try { response = (await send(c.message, sender)).body; } catch { applicationError = "APPLICATION_ERROR"; }
    const after = await snapshot(user.userId);
    const stateAfter = (await app.pool.query("select state from conversation_states where user_id=$1", [user.userId])).rows[0]?.state;
    const confirmation = (await app.pool.query("select id from pending_confirmations where user_id=$1 and status='PENDING'", [user.userId])).rowCount! > 0;
    const route = events.find((e: any) => e.event === "conversation_route") as any;
    const clarification = Boolean(route?.clarificationReason || stateAfter?.stack.length || /which|please provide|today only|haven't changed|didn't quite|can't resolve|clarify/i.test(response));
    const mutation = !isDeepStrictEqual(before, after);
    const violations: string[] = [];
    if (!isDeepStrictEqual(before.planned, after.planned)) violations.push("UNCONFIRMED_ROUTINE_MUTATION");
    if (after.workouts.filter(w => ["PROPOSED", "ACTIVE", "PAUSED"].includes(w.status as string)).length > 1) violations.push("MULTIPLE_ACTIVE_WORKOUTS");
    if (["READ_ONLY", "AMBIGUOUS", "PERMANENT"].includes(c.policy) && mutation) violations.push("UNEXPECTED_MUTATION");
    if (c.policy === "INJECTION") {
      if (!isDeepStrictEqual(before.sets, after.sets) || !isDeepStrictEqual(before.exercises, after.exercises) || after.workouts.some(w => ["COMPLETED", "DISCARDED", "INCOMPLETE"].includes(w.status as string))) violations.push("INJECTION_MUTATION");
    }
    if (c.policy === "CORRECTION") {
      if (before.sets.length !== after.sets.length) violations.push("CORRECTION_CREATED_SET");
      for (let i = 0; i < after.sets.length; i++) {
        const a = after.sets[i]!, b = before.sets[i]!;
        if (a.reps !== b.reps && a.reps !== c.field?.["replacement.reps"]) violations.push("WRONG_CORRECTION_REPS");
        if (a.load_value !== b.load_value && Number(a.load_value) !== c.field?.["replacement.loadValue"]) violations.push("WRONG_CORRECTION_LOAD");
      }
    }
    const aiInvoked = captures.length > 0;
    let classification = "DETERMINISTIC";
    if (aiInvoked) {
      const capture = captures[0]!;
      classification = capture.error && capture.error !== "AI_SCHEMA_INVALID" ? "PROVIDER_FAILURE" : !capture.validated ? "LOCALLY_REJECTED" : actionMatches(c, capture) ? "CORRECT" : "INCORRECT";
      if (classification === "INCORRECT" && (capture.proposal as any)?.requiresClarification) classification = "CLARIFICATION_SAFE";
    }
    // Plan retrieval must actually display the saved current plan; a safe UNKNOWN is not success.
    let outcomeCorrect = violations.length === 0 && !applicationError;
    if (c.group === "plan" || (c.group === "informal" && c.message === "whts today workout")) outcomeCorrect &&= /Push/.test(response) && /Cable Fly/.test(response) && /Lateral Raise/.test(response);
    if (c.policy === "START") outcomeCorrect &&= after.workouts.some(w => w.status === "PROPOSED");
    if (c.policy === "PERMANENT") outcomeCorrect &&= confirmation || clarification;
    if (c.policy === "CORRECTION") outcomeCorrect &&= mutation || clarification;
    if (c.group === "natural-sets") {
      const count = Number(c.field?.["sets.length"] ?? 1), load = Number(c.field?.["set.loadValue"] ?? c.field?.["sets.0.loadValue"]), reps = Number(c.field?.["set.reps"] ?? c.field?.["sets.0.reps"]);
      const added = after.sets.filter(set => !before.sets.some(old => old.id === set.id));
      const active = after.workouts.find(workout => workout.status === "ACTIVE");
      outcomeCorrect &&= added.length === count && added.every(set => Number(set.load_value) === load && set.reps === reps && set.session_exercise_id === active?.active_session_exercise_id);
    }
    if (c.group === "partial") outcomeCorrect &&= !mutation && stateAfter?.stack.at(-1)?.kind === "SET_DRAFT" && stateAfter.stack.at(-1).load === c.field?.loadValue && stateAfter.stack.at(-1).count === c.field?.count;
    if (c.group === "pending-semantic") outcomeCorrect &&= mutation && stateAfter?.stack.length === 0;
    const result = { id: c.id, group: c.group, message: c.message, expected: c.expected, mode: stateBefore?.mode ?? "IDLE", pending: stateBefore?.stack ?? [], aiInvoked, capture: structuredClone(captures), localValidation: !aiInvoked ? "NOT_INVOKED" : captures[0]!.validated ? "PASS" : captures[0]!.error ?? "REJECTED", response, route, clarification, confirmation, classification, violations: [...new Set(violations)], mutation, outcomeCorrect, ...(applicationError ? { applicationError } : {}) };
    result.classification = scoreLiveProposal(c, result);
    return result;
  }
  function report() {
    const ai = results.filter(r => r.aiInvoked), count = (name: string) => ai.filter(r => r.classification === name).length;
    const incorrect = count("INCORRECT"), safeClarification = count("CLARIFICATION_SAFE"), rejected = count("LOCALLY_REJECTED"), failures = count("PROVIDER_FAILURE"), correct = count("CORRECT");
    const unsuccessful = ai.filter(r => r.classification !== "CORRECT");
    const summary = { corpusCases: results.length, liveAiCases: ai.length, deterministicBypass: results.length - ai.length, deterministicBypassPercent: results.length ? 100 * (results.length - ai.length) / results.length : 0,
      correct, incorrect, clarificationSafe: safeClarification, locallyRejected: rejected, providerFailures: failures, semanticAccuracyPercent: ai.length ? 100 * correct / ai.length : 0,
      clarificationSafePercent: ai.length ? 100 * safeClarification / ai.length : 0, safeFailurePercent: unsuccessful.length ? 100 * unsuccessful.filter(r => !r.violations.length).length / unsuccessful.length : 100,
      conversationSuccessPercent: results.length ? 100 * results.filter(r => r.outcomeCorrect).length / results.length : 0,
      unsafeMutationCases: results.filter(r => r.violations.length).length, injectedFailureCases: failureResults.length, injectedFailureUnsafeMutations: failureResults.filter(r => r.violations.length || r.mutation).length,
      categoryCounts: Object.fromEntries([...new Set(results.map(r => r.group))].map(group => [group, { total: results.filter(r => r.group === group).length, ai: results.filter(r => r.group === group && r.aiInvoked).length, incorrect: results.filter(r => r.group === group && r.classification === "INCORRECT").length, outcomeFailures: results.filter(r => r.group === group && !r.outcomeCorrect).length }])) };
    return { model, promptVersion: intentPromptVersion, promptHash, schemaHash, generatedAt: new Date().toISOString(), syntheticInputsOnly: true, liveWhatsAppDelivery: false, summary, results, failureResults };
  }
  try {
    await app.migrate();
    const selected = env.LIVE_CONVERSATION_CASE_IDS?.split(",");
    for (const c of liveConversationCorpus.filter(c => !selected || selected.includes(c.id))) {
      const result = await evaluate(c); results.push(result); writeResultArtifact(artifactRoot, metadata, report(), `turn-${results.length}`);
      console.log(JSON.stringify({ id: c.id, ai: result.aiInvoked, classification: result.classification, validation: result.localValidation, unsafe: result.violations.length, outcomeCorrect: result.outcomeCorrect }));
    }
    const base = { schemaVersion: "workout-action.v1", action: { type: "DELETE_SET" }, confidence: "low", requiresClarification: false, rationaleCodes: [], forbiddenDirectMutation: true };
    const faults: Array<{ name: string; fetchImpl?: typeof fetch; output?: unknown }> = [
      { name: "timeout", fetchImpl: async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); }) },
      { name: "malformed", fetchImpl: async () => new Response("not JSON", { status: 200 }) },
      { name: "invalid-action", output: { ...base, action: { type: "DELETE_ACCOUNT" } } },
      { name: "false-safety", output: { ...base, forbiddenDirectMutation: false } },
      { name: "low-confidence", output: base },
      { name: "429", fetchImpl: async () => new Response("", { status: 429 }) },
      { name: "5xx", fetchImpl: async () => new Response("", { status: 503 }) }
    ];
    for (const fault of faults) {
      if (fault.fetchImpl) {
        const faultClient = new GeminiStructuredOutputClient({ apiKey: "synthetic-key", fetchImpl: fault.fetchImpl });
        client = { createStructuredOutput: (r: StructuredOutputRequest) => faultClient.createStructuredOutput({ ...r, timeoutMs: 25 }) };
      } else client = { createStructuredOutput: async r => ({ rawJson: fault.output, model: r.model }) };
      const result = await evaluate({ id: `fault-${fault.name}`, group: "injected-failure", message: "could you adjust this movement somehow please", expected: "safe recovery, no mutation", actions: [], policy: "READ_ONLY", mode: "ACTIVE" });
      failureResults.push(result); console.log(JSON.stringify({ fault: fault.name, mutation: result.mutation, validation: result.localValidation }));
    }
    writeResultArtifact(artifactRoot, metadata, report()); console.log(JSON.stringify(report().summary));
  } finally {
    await app.close(); await admin.query(`drop schema ${schema} cascade`); await admin.end();
  }
}

runLiveConversationAcceptance().catch((error: unknown) => {
  const e = error as { name?: string; code?: string; issues?: Array<{ path: unknown; code: string }> };
  console.error(JSON.stringify({ evaluationFailed: true, name: e.name, code: e.code, issues: e.issues?.map(i => ({ path: i.path, code: i.code })) }));
  process.exitCode = 1;
});

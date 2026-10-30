import { afterAll, describe, expect, it, vi } from "vitest";
import { appendFileSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { PostgresVerticalSliceApp } from "../../packages/persistence/src/postgres.js";
import { PostgresRecipientResolver } from "../../packages/messaging/src/whatsapp/recipient-resolver.js";
import { PostgresDelivery } from "../../packages/messaging/src/postgres-delivery.js";
import { WhatsAppInboundAdapter } from "../../packages/messaging/src/index.js";
import { hashChallenge } from "../../packages/messaging/src/whatsapp/link-challenge.js";
import { GeminiStructuredOutputClient } from "../../packages/ai/src/providers/gemini-structured-output-client.js";
import { StructuredIntentInterpreter } from "../../packages/ai/src/structured-intent-interpreter.js";
import { StaticPromptRegistry, intentPromptVersion, defaultIntentModel } from "../../packages/ai/src/prompt-registry.js";
import { AiProviderError, type IntentInterpretRequest } from "../../packages/ai/src/index.js";
import { parseProposedActionEnvelope, type ProposedAction } from "../../packages/contracts/src/ai/actions.js";
import { userConversationCorpus, userConversationCorpusVersion, type ScaleExpectation, type ScaleScenario, type ScaleTurn } from "../../packages/evals/src/user-conversation-corpus.js";

let app: PostgresVerticalSliceApp;
let services: { accountId: string; recipients: PostgresRecipientResolver; delivery: PostgresDelivery };
vi.mock("../../apps/web/server/app.js", () => ({ productionApp: () => app }));
vi.mock("../../apps/web/server/whatsapp/transport.js", () => ({ whatsappTransport: () => services }));
import { POST } from "../../apps/web/app/api/webhooks/whatsapp/route.js";

const enabled = process.env.RUN_SCALE_CONVERSATION_EVAL === "1";
type Row = Record<string, any>;
type Snapshot = { workouts: Row[]; sets: Row[]; exercises: Row[]; planned: Row[]; cursor: Row[]; aliases: Row[]; confirmations: Row[]; state: Row | null };
type TurnResult = { text: string; expected: ScaleExpectation; response: string; aiCalls: number; proposals: unknown[]; errors: string[]; changedTables: string[]; writtenSets: Row[]; updatedSets:Array<{before:Row;after:Row|undefined}>; workoutBefore:Row[]; workoutAfter:Row[]; httpStatus: number; replay: boolean };
type CaseResult = { id: string; family: string; unit: string; passed: boolean; error?: string; turns: TurnResult[] };

(enabled ? describe : describe.skip)("large user conversation and write audit", () => {
  const outcomes: CaseResult[] = [], captures = new Map<string, unknown[]>();
  let output = "", sends = 0, realCalls = 0, retryCalls = 0, scheduled = 0, cooldown = 0, completed = 0;
  let quotaResetAt:number|null=null;
  const mode=process.env.SCALE_INTERPRETER==="controlled"?"CONTROLLED_INTENTS":"LIVE_AI";
  const currentTurns=new Map<string,{scenario:ScaleScenario;turn:ScaleTurn}>();
  let sendCounts = new Map<string, number>();
  const account = "123456", secret = "scale-fixture-signature-secret", key = "ab".repeat(32);
  const adapter = new WhatsAppInboundAdapter(secret);
  const models = new Set<string>(), requests = new Set<string>();
  const variants = Number(process.env.SCALE_VARIANTS ?? 100);
  const concurrency = Number(process.env.SCALE_CONCURRENCY ?? 4);
  const interval = Number(process.env.SCALE_AI_INTERVAL_MS ?? 3500);
  const model = process.env.AI_MODEL ?? defaultIntentModel;
  const prompt=new StaticPromptRegistry(model).getPrompt("intent-interpreter","workout-action.v1");
  const promptHash=createHash("sha256").update(prompt.systemPrompt).digest("hex");
  const schemaHash=createHash("sha256").update(JSON.stringify(prompt.responseSchema)).digest("hex");
  const benchmark = process.env.SCALE_RUN_LABEL ?? new Date().toISOString().replace(/[:.]/g, "-");
  const completedIds=new Set<string>();
  if(mode==="LIVE_AI"&&process.env.SCALE_RESUME_ROOT&&existsSync(process.env.SCALE_RESUME_ROOT)){
    for(const name of readdirSync(process.env.SCALE_RESUME_ROOT)){
      const root=`${process.env.SCALE_RESUME_ROOT}/${name}`;
      if(!existsSync(`${root}/summary.json`)||!existsSync(`${root}/cases.jsonl`))continue;
      const prior=JSON.parse(readFileSync(`${root}/summary.json`,"utf8"));
      if(prior.mode==="CONTROLLED_INTENTS"||prior.corpusVersion!==userConversationCorpusVersion||prior.promptHash&&prior.promptHash!==promptHash)continue;
      for(const line of readFileSync(`${root}/cases.jsonl`,"utf8").trim().split("\n").filter(Boolean)){
        const c=JSON.parse(line);if(c.passed&&!c.turns.some((t:any)=>t.proposals.some((p:any)=>p.error)))completedIds.add(c.id);
      }
    }
  }
  const corpus = userConversationCorpus(variants).filter(c => !completedIds.has(c.id)&&(!process.env.SCALE_FAMILIES || process.env.SCALE_FAMILIES.split(",").includes(c.family)) && (!process.env.SCALE_CASE_IDS || process.env.SCALE_CASE_IDS.split(",").includes(c.id)));

  function summary() {
    const turns = outcomes.flatMap(c => c.turns);
    return { corpusVersion: userConversationCorpusVersion, promptVersion: intentPromptVersion, promptHash, schemaHash, mode, model:mode==="LIVE_AI"?model:"authored-contract-intents", variants, concurrency,
      quotaPaused:quotaResetAt!==null,quotaResetAt:quotaResetAt===null?null:new Date(quotaResetAt).toISOString(),previouslyPassedScenarios:completedIds.size,
      scenarios: outcomes.length, plannedScenarios: corpus.length, passed: outcomes.filter(c => c.passed).length, failed: outcomes.filter(c => !c.passed).length,
      turns: turns.length, uniqueUserMessages: new Set(turns.map(t => t.text)).size, realAiCalls: realCalls, providerRetries: retryCalls,
      uniqueModelRequests: requests.size, aiBackedTurns: mode==="LIVE_AI"?turns.filter(t => t.aiCalls > 0).length:0,
      controlledIntentTurns:mode==="CONTROLLED_INTENTS"?turns.filter(t=>t.aiCalls>0).length:0,
      deterministicTurns: turns.filter(t => !t.aiCalls).length, setupAndTestWebhookRequests: sends,
      writeChecks: turns.filter(t => ["LOG","CORRECT","ACTIVE","REPLACE","FINISH","STARTED","DELETE","PROPOSED"].includes(t.expected.kind)).length,
      nonMutationChecks: turns.filter(t => ["READ_ONLY","DRAFT","QUESTION","CONFIRMATION"].includes(t.expected.kind)).length,
      responseFailures: turns.filter(t => t.errors.some(e => /RESPONSE/.test(e))).length,
      operationFailures: turns.filter(t => t.errors.some(e => !/RESPONSE/.test(e))).length,
      providerFailureTurns: turns.filter(t=>t.proposals.some((p:any)=>p.error)).length,
      interpretationAndOperationFailures:turns.filter(t=>t.errors.length&&!t.proposals.some((p:any)=>p.error)).length,
      byFamily: Object.fromEntries([...new Set(corpus.map(c => c.family))].map(f => [f, { total: outcomes.filter(c => c.family === f).length, passed: outcomes.filter(c => c.family === f && c.passed).length, failed: outcomes.filter(c => c.family === f && !c.passed).length }])),
      provenance: mode==="LIVE_AI"?"Synthetic users; actual Gemini interpreter and signed production webhook; isolated PostgreSQL schema; fake outbound transport. No real WhatsApp messages sent. Assertions compare response relevance and exact persisted effects after each turn, including follow-up replies. Semantic correctness is not inferred from safety alone.":"Authored intent proposals supplied to the real conversation orchestrator, signed webhook, and isolated PostgreSQL database. Backend response/write checks only: this mode does NOT measure AI interpretation quality. Fake outbound transport; no WhatsApp sends." };
  }
  async function snapshot(userId: string): Promise<Snapshot> {
    const query = async (sql: string) => (await app.pool.query(sql, [userId])).rows;
    return {
      workouts: await query("select id,status,name,active_session_exercise_id,completion_choice_pending,version from workout_sessions where user_id=$1 order by id"),
      sets: await query("select id,session_exercise_id,set_index,load_value::float8 as load,weight_unit as unit,load_semantics as semantics,reps,status from workout_sets where user_id=$1 order by created_at,set_index,id"),
      exercises: await query("select se.id,se.exercise_identity_id,se.exercise_name_snapshot as name,se.status,se.order_index from session_exercises se join workout_sessions w on w.id=se.workout_session_id where w.user_id=$1 order by se.id"),
      planned: await query("select p.* from planned_exercises p join workout_session_templates t on t.id=p.session_template_id join routines r on r.id=t.routine_id where r.user_id=$1 order by p.id"),
      cursor: await query("select * from routine_sequence_cursors where user_id=$1 order by id"),
      aliases: await query("select id,exercise_identity_id,alias_text,status from exercise_aliases where user_id=$1 order by id"),
      confirmations: await query("select id,action_type,status from pending_confirmations where user_id=$1 order by id"),
      state: (await query("select state from conversation_states where user_id=$1"))[0]?.state ?? null
    };
  }
  async function send(userId: string, sender: string, text: string, id: string) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "scale-synthetic", changes: [{ value: { metadata: { phone_number_id: account }, messages: [{ id, from: sender, timestamp: String(Math.floor(Date.now()/1000)), text: { body: text } }] } }] }] });
    sends++;
    const response = await POST(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body: raw, headers: { "x-hub-signature-256": adapter.sign(raw) } }));
    const result = await response.json();
    const outbound = (await app.pool.query("select o.id,o.status,o.body from outbound_messages o join inbound_messages m on m.id=o.inbound_message_id where m.provider_message_id=$1 and m.user_id=$2", [id,userId])).rows[0];
    return { status: response.status, body: result[0]?.body ?? JSON.stringify(result), outbound };
  }
  function evaluate(expected: ScaleExpectation, before: Snapshot, after: Snapshot, body: string): string[] {
    const errors: string[] = [];
    const changed = (table: keyof Snapshot) => !isDeepStrictEqual(before[table],after[table]);
    const recorded = (s: Snapshot) => s.sets.filter(r => r.status === "RECORDED");
    const added = recorded(after).filter(r => !before.sets.some(b => b.id === r.id));
    const active = after.workouts.find(w => w.status === "ACTIVE");
    const relevant = (terms: string[]) => terms.every(term => new RegExp(term,"i").test(body));
    if (!body || body.length > 4096 || /unsupported structured command|invalid action|resolver|stack trace|postgresql:\/\//i.test(body)) errors.push("RESPONSE_UNUSABLE");
    if (after.workouts.filter(w => ["ACTIVE","PROPOSED","PAUSED"].includes(w.status)).length > 1) errors.push("MULTIPLE_OPEN_WORKOUTS");
    if (changed("planned") && !(expected.kind === "REPLACE" && expected.permanent)) errors.push("UNEXPECTED_ROUTINE_WRITE");
    if (changed("aliases") && expected.kind !== "ALIAS") errors.push("UNEXPECTED_ALIAS_WRITE");
    if(changed("sets")&&!["LOG","CORRECT","DELETE"].includes(expected.kind))errors.push("UNEXPECTED_SET_WRITE");
    if(changed("cursor")&&!(expected.kind==="FINISH"&&expected.status==="COMPLETED"))errors.push("UNEXPECTED_PROGRESSION_WRITE");
    if (["READ_ONLY","DRAFT","QUESTION","CONFIRMATION"].includes(expected.kind)) {
      for (const table of ["workouts","sets","exercises","planned","cursor","aliases"] as const) if (changed(table)) errors.push(`UNEXPECTED_WRITE_${table}`);
    }
    if (expected.kind === "READ_ONLY" || expected.kind === "QUESTION") {
      if (!relevant(expected.mentions)) errors.push("RESPONSE_NOT_RELEVANT");
    } else if (expected.kind === "DRAFT") {
      if (after.state?.stack.at(-1)?.kind !== "SET_DRAFT" || after.state.stack.at(-1).load !== expected.load) errors.push("MISSING_LOAD_DRAFT");
      if (!/reps/i.test(body)) errors.push("RESPONSE_MISSING_REP_QUESTION");
    } else if (expected.kind === "LOG") {
      if (added.length !== expected.loads.length) errors.push("WRONG_SET_COUNT");
      added.forEach((set,i) => {
        if (set.load !== expected.loads[i] || set.reps !== expected.reps[i]) errors.push("WRONG_SET_VALUES");
        if (set.session_exercise_id !== active?.active_session_exercise_id) errors.push("WRONG_SET_EXERCISE");
      });
      if (!/Logged:/i.test(body)) errors.push("RESPONSE_DID_NOT_ACKNOWLEDGE_WRITE");
      if(expected.exercise) {
        if(after.exercises.find(e=>e.id===active?.active_session_exercise_id)?.name!==expected.exercise)errors.push("WRONG_NAMED_EXERCISE");
        if(!body.includes(expected.exercise))errors.push("RESPONSE_WRONG_EXERCISE_CONTEXT");
      }
      if (!before.sets.every(old => isDeepStrictEqual(old,after.sets.find(r => r.id === old.id)))) errors.push("LOG_CHANGED_PREVIOUS_SET");
    } else if (expected.kind === "CORRECT") {
      const target = recorded(before).at(-1);
      const corrected = after.sets.find(r => r.id === target?.id);
      if (!target || !corrected || corrected.reps !== expected.reps || corrected.load !== target.load || corrected.unit !== target.unit || corrected.session_exercise_id !== target.session_exercise_id || after.sets.length !== before.sets.length) errors.push("WRONG_CORRECTION_WRITE");
      if(before.sets.some(s=>s.id!==target?.id&&!isDeepStrictEqual(s,after.sets.find(r=>r.id===s.id))))errors.push("CORRECTION_CHANGED_ANOTHER_SET");
      if (!/correct|updated|applied/i.test(body)) errors.push("RESPONSE_DID_NOT_ACKNOWLEDGE_CORRECTION");
    } else if (expected.kind === "ACTIVE") {
      if (after.exercises.find(e => e.id === active?.active_session_exercise_id)?.name !== expected.exercise) errors.push("WRONG_ACTIVE_EXERCISE");
      if (!body.includes(expected.exercise)) errors.push("RESPONSE_MISSING_ACTIVE_EXERCISE");
      if (changed("sets")) errors.push("NAVIGATION_CHANGED_SETS");
    } else if (expected.kind === "REPLACE") {
      if (!expected.permanent && !after.exercises.some(e => e.name === "Barbell Bench Press" && e.status === "REPLACED")) errors.push("REPLACEMENT_NOT_APPLIED");
      if (expected.permanent) {
        const prior = before.planned.find(p=>p.exercise_identity_id==="global_barbell_bench_press");
        if (!prior || after.planned.find(p=>p.id===prior.id)?.exercise_identity_id!=="global_lat_pulldown") errors.push("CONFIRMED_ROUTINE_WRITE_MISSING");
        if (changed("sets") || changed("exercises")) errors.push("FUTURE_ROUTINE_CHANGE_ALTERED_CURRENT_WORKOUT");
      }
      if (!/applied|changed|replaced/i.test(body)) errors.push("RESPONSE_DID_NOT_ACKNOWLEDGE_REPLACEMENT");
    } else if (expected.kind === "CONFIRMATION") {
      if (!after.confirmations.some(c => c.status === "PENDING")) errors.push("MISSING_CONFIRMATION");
      if (!/confirm|reply yes/i.test(body)) errors.push("RESPONSE_MISSING_CONFIRMATION_QUESTION");
    } else if (expected.kind === "FINISH_PENDING") {
      if (!active?.completion_choice_pending) errors.push("MISSING_FINISH_QUESTION");
      if (!/continue|discard|incomplete/i.test(body)) errors.push("RESPONSE_MISSING_FINISH_OPTIONS");
    } else if (expected.kind === "FINISH") {
      if (!after.workouts.some(w => w.status === expected.status) || active) errors.push("WRONG_FINISH_WRITE");
      if (!new RegExp(expected.status === "COMPLETED" ? "complete" : expected.status,"i").test(body)) errors.push("RESPONSE_MISSING_FINISH_STATUS");
      if (changed("sets")) errors.push("FINISH_CHANGED_SET_FACTS");
    } else if (expected.kind === "STARTED") {
      if (!active || active.completion_choice_pending) errors.push("WORKOUT_NOT_STARTED");
      if (!/started|resumed|active|continue/i.test(body)) errors.push("RESPONSE_MISSING_START_ACKNOWLEDGEMENT");
    } else if (expected.kind === "PROPOSED") {
      if (!after.workouts.some(w => w.status === "PROPOSED")) errors.push("WORKOUT_NOT_PROPOSED");
      if (!/proposed|start/i.test(body)) errors.push("RESPONSE_MISSING_PROPOSAL");
    } else if (expected.kind === "ALIAS") {
      if(!after.aliases.some(a=>a.alias_text===expected.alias&&a.exercise_identity_id==="global_barbell_bench_press"&&a.status==="CONFIRMED"))errors.push("CONFIRMED_ALIAS_WRITE_MISSING");
      if(changed("sets")||changed("planned"))errors.push("ALIAS_CHANGED_WORKOUT_DATA");
      if(!/applied|alias|saved/i.test(body))errors.push("RESPONSE_MISSING_ALIAS_ACKNOWLEDGEMENT");
    } else if (expected.kind === "DELETE" && expected.allowConfirmation && after.confirmations.some(c=>c.status==="PENDING")) {
      if(changed("sets")||changed("planned"))errors.push("DELETE_APPLIED_BEFORE_CONFIRMATION");
      if(!/confirm|reply yes/i.test(body))errors.push("RESPONSE_MISSING_DELETE_CONFIRMATION");
    } else if (expected.kind === "DELETE") {
      const target = recorded(before).at(-1);
      if (!target || after.sets.find(r => r.id === target.id)?.status === "RECORDED" || recorded(after).length !== recorded(before).length-1) errors.push("WRONG_DELETE_WRITE");
      if (!/deleted|applied|removed/i.test(body)) errors.push("RESPONSE_MISSING_DELETE_ACKNOWLEDGEMENT");
    }
    return [...new Set(errors)];
  }

  function controlledAction(request:IntentInterpretRequest):ProposedAction {
    const current=currentTurns.get(request.context.userId);
    if(!current)throw new Error("No authored intent for setup input");
    const {scenario,turn}=current, expected=turn.expect, text=request.userInput;
    const unit=request.context.preferredWeightUnit??scenario.unit;
    if(expected.kind==="LOG"){
      const exerciseRef=expected.exercise??request.context.activeExercise??"current";
      const sets=expected.loads.map((loadValue,i)=>({exerciseRef,loadValue,reps:expected.reps[i]!,weightUnit:unit}));
      return sets.length===1?{type:"LOG_SET",set:sets[0]!}:{type:"LOG_MULTIPLE_SETS",sets};
    }
    if(expected.kind==="DRAFT")return {type:"DRAFT_SETS",loadValue:expected.load,count:1,weightUnit:unit};
    if(expected.kind==="CORRECT")return {type:"CORRECT_SET",replacement:{reps:expected.reps}};
    if(expected.kind==="ACTIVE")return {type:"CHANGE_ACTIVE_EXERCISE",exerciseRef:expected.exercise};
    if(expected.kind==="QUESTION")return {type:"PREPARE_SET"};
    if(expected.kind==="REPLACE")return {type:"ANSWER_PENDING_QUESTION",answer:"SESSION_ONLY"};
    if(expected.kind==="CONFIRMATION"){
      if(scenario.family==="alias-confirmation-followup")return {type:"MAP_EXERCISE_ALIAS",exerciseRef:"Barbell Bench Press",alias:`bench buddy ${Number(scenario.id.split("-").at(-1))-1}`};
      return {type:"REPLACE_EXERCISE",fromExerciseRef:"Barbell Bench Press",toExerciseRef:"Lat Pulldown",scope:"PERMANENT_ROUTINE"};
    }
    if(expected.kind==="FINISH_PENDING")return {type:"FINISH_WORKOUT"};
    if(expected.kind==="FINISH")return {type:"FINISH_WORKOUT",requestedCompletion:expected.status==="COMPLETED"?"COMPLETE":expected.status==="INCOMPLETE"?"INCOMPLETE":"DISCARD"};
    if(expected.kind==="STARTED")return request.context.conversationMode==="WORKOUT_PROPOSED"?{type:"START_WORKOUT"}:{type:"CONTINUE"};
    if(expected.kind==="PROPOSED")return {type:"START_WORKOUT"};
    if(expected.kind==="DELETE")return {type:"DELETE_SET",targetRef:"last-active-set"};
    if(expected.kind==="ALIAS")throw new Error("Alias confirmation must be resolved locally");
    if(scenario.family==="history-questions")return {type:"QUERY_HISTORY",queryKind:/last Push/i.test(text)?"LAST_SESSION":/best/i.test(text)?"BEST_SET":"LAST_EXERCISE",subject:/last Push/i.test(text)?{kind:"ROUTINE_SESSION",sessionRef:"Push"}:{kind:"EXERCISE",exerciseRef:"Barbell Bench Press"}};
    if(scenario.family==="analytics-questions")return /month/i.test(text)?{type:"QUERY_ANALYTICS",queryKind:"MONTHLY_WORKOUT_COUNT"}:{type:"QUERY_ANALYTICS",queryKind:/last train/i.test(text)?"LAST_TRAINED":"WEEKLY_PRIMARY_MUSCLE_SETS",subject:{kind:"MUSCLE",muscleRef:"chest"}};
    if(scenario.family==="coaching-boundary")return {type:"COACHING_BOUNDARY"};
    if(scenario.family==="social-and-help")return {type:/explain|tell me|how to/i.test(text)?"HELP":"GREETING"};
    if(scenario.family==="invalid-set-does-not-write")return /zero|x0/i.test(text)?{type:"LOG_SET",set:{loadValue:scenario.seedLoad,reps:0,weightUnit:unit}}:{type:"UNKNOWN",reason:"Invalid completed reps"};
    if(scenario.family==="policy-bypass-does-not-write")return {type:"UNKNOWN",reason:"Ownership or confirmation bypass requested"};
    return {type:/where|what exercise|what am i on/i.test(text)?"QUERY_CURRENT_STATE":"QUERY_PLAN"};
  }

  it("audits authored response expectations and exact follow-up writes", async () => {
    if (!process.env.TEST_DATABASE_URL || mode==="LIVE_AI"&&!process.env.GEMINI_API_KEY) throw new Error("TEST_DATABASE_URL and, for live mode, GEMINI_API_KEY required");
    const schema = `scale_${Date.now()}`;
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`create schema ${schema}`); await admin.end();
    const url = new URL(process.env.TEST_DATABASE_URL); url.searchParams.set("options", `-c search_path=${schema}`);
    output = `specs/001-whatsapp-workout-companion/evaluation-runs/user-scale/${benchmark}`; mkdirSync(output,{recursive:true});
    writeFileSync(`${output}/corpus.json`, JSON.stringify({version:userConversationCorpusVersion,scenarios:corpus},null,2));
    const live = new GeminiStructuredOutputClient({fetchImpl:async(url,init)=>{
      const response=await fetch(url,init);
      if(response.status===429){
        const data=await response.clone().json().catch(()=>({}));
        const details=data.error?.details??[];
        if(details.some((d:any)=>d.violations?.some((v:any)=>/PerDay/i.test(v.quotaId??"")))){
          const retry=details.map((d:any)=>d.retryDelay).find((s:unknown)=>typeof s==="string");
          quotaResetAt=Date.now()+Math.max(60000,Number.parseFloat(retry??"86400")*1000)+60000;
        }
      }
      return response;
    }});
    const interpreter = new StructuredIntentInterpreter({ async createStructuredOutput(request) {
      requests.add(createHash("sha256").update(request.userText).digest("hex"));
      for (let attempt=0; ; attempt++) {
        for(;;) {
          if(quotaResetAt!==null)throw new AiProviderError("Daily model quota exhausted; evaluation checkpointed","AI_DAILY_QUOTA",false);
          const wait=Math.max(scheduled,cooldown)-Date.now();
          if(wait>0){await delay(wait);continue;}
          scheduled=Date.now()+interval;break;
        }
        realCalls++;
        try { const result = await live.createStructuredOutput(request); models.add(result.model); return result; }
        catch (e) {
          if(quotaResetAt!==null)throw new AiProviderError("Daily model quota exhausted; evaluation checkpointed","AI_DAILY_QUOTA",false);
          if(e instanceof AiProviderError&&e.code==="AI_RATE_LIMIT")cooldown=Math.max(cooldown,Date.now()+30000);
          if (!(e instanceof AiProviderError) || !e.retryable || attempt >= 2) throw e;
          retryCalls++;
        }
      }
    } }, new StaticPromptRegistry(model));
    app = new PostgresVerticalSliceApp({ connectionString:url.toString(), interpreter: { promptVersion:intentPromptVersion, async interpret(request: IntentInterpretRequest) {
      const history = captures.get(request.context.userId) ?? []; captures.set(request.context.userId,history);
      try {
        const result=mode==="LIVE_AI"?await interpreter.interpret(request):parseProposedActionEnvelope({schemaVersion:"workout-action.v1",action:controlledAction(request),confidence:"high",requiresClarification:false,requestKind:currentTurns.get(request.context.userId)?.scenario.family==="policy-bypass-does-not-write"?"POLICY_BYPASS_ATTEMPT":"USER_DOMAIN_INTENT",rationaleCodes:[],forbiddenDirectMutation:true});
        history.push({ input:request.userInput, action:result.action, confidence:result.confidence, requiresClarification:result.requiresClarification,source:mode }); return result;
      }
      catch (e) { history.push({input:request.userInput,error:e instanceof AiProviderError ? e.code : "AI_SCHEMA_OR_REQUEST_FAILURE"}); throw e; }
    } } });
    await app.migrate();
    sendCounts = new Map();
    services = { accountId:account, recipients:new PostgresRecipientResolver(app.pool,key,account), delivery:new PostgresDelivery(app.pool,{ async sendMessage(input) {
      sendCounts.set(input.idempotencyKey,(sendCounts.get(input.idempotencyKey)??0)+1); return {providerMessageId:`synthetic-${input.idempotencyKey}`};
    } }) };
    vi.stubEnv("WHATSAPP_APP_SECRET",secret); vi.stubEnv("WHATSAPP_BUSINESS_NUMBER","+15551234567");
    let cursor=0;
    async function run(c: ScaleScenario, index:number): Promise<CaseResult> {
      const result:CaseResult={id:c.id,family:c.family,unit:c.unit,passed:true,turns:[]};
      try {
        const owner=await app.signUp(`scale-${index}@example.invalid`,"synthetic scale test password");
        const sender=`1555${String(index).padStart(7,"0")}`;
        await app.configure(owner.sessionToken,p=>p.profile({preferredWeightUnit:c.unit}));
        const shoulder=await app.configure(owner.sessionToken,p=>p.customExercise({name:"Shoulder Press",defaultLoadSemantics:"MACHINE_STACK",confirm:true}));
        if (!("id" in shoulder)) throw new Error("fixture identity failed");
        await app.configure(owner.sessionToken,p=>p.alias("global_barbell_bench_press",{alias:"bench",confirm:true}));
        await app.configure(owner.sessionToken,p=>p.saveRoutine({name:"Scale routine",sessions:[{name:"Push",exercises:["global_barbell_bench_press","global_lat_pulldown",shoulder.id].map(exerciseIdentityId=>({exerciseIdentityId,plannedSetCount:3,repTargetMin:8,repTargetMax:10}))}]}));
        const setup = async (text:string,label:string) => { const response=await send(owner.userId,sender,text,`${index}-setup-${label}`); if(response.status!==200) throw new Error(`setup ${label} HTTP ${response.status}`); };
        await setup(`LINK ${await app.createLinkToken(owner.userId,hashChallenge(sender))}`,"link");
        if(c.mode!=="IDLE") await setup("start","propose");
        if(c.mode==="ACTIVE") await setup("start","accept");
        for(let i=0;i<c.seed;i++) await setup(`${c.seedLoad}x10`,`seed-${i}`);
        let previousId="";
        for(let i=0;i<c.turns.length;i++) {
          const turn=c.turns[i]!, before=await snapshot(owner.userId), count=captures.get(owner.userId)?.length??0;
          if(turn.onlyIfConfirmation&&!before.confirmations.some(c=>c.status==="PENDING"))continue;
          const id=turn.replay?previousId:`${index}-turn-${i}`; previousId=id;
          currentTurns.set(owner.userId,{scenario:c,turn});
          const response=await send(owner.userId,sender,turn.text,id), after=await snapshot(owner.userId);
          const errors=evaluate(turn.expect,before,after,response.body);
          if(mode==="LIVE_AI"&&(captures.get(owner.userId)??[]).slice(count).some((p:any)=>p.error))errors.push("PROVIDER_UNAVAILABLE");
          if(response.status!==200) errors.push(`HTTP_${response.status}`);
          if(!response.outbound||response.outbound.status!=="SENT"||response.outbound.body!==response.body) errors.push("REPLY_NOT_DELIVERED");
          if(response.outbound && sendCounts.get(response.outbound.id)!==1) errors.push("DUPLICATE_OR_MISSING_SEND");
          // A set's units and convention must agree with the owner and exercise.
          const added=after.sets.filter(s=>!before.sets.some(b=>b.id===s.id));
          const convention=turn.expect.kind==="LOG"&&turn.expect.exercise==="Lat Pulldown"?"MACHINE_STACK":"TOTAL_LOAD";
          if(added.some(s=>s.unit!==c.unit||s.semantics!==convention)) errors.push("WRONG_UNIT_OR_LOAD_CONVENTION");
          result.turns.push({text:turn.text,expected:turn.expect,response:response.body,aiCalls:(captures.get(owner.userId)?.length??0)-count,proposals:(captures.get(owner.userId)??[]).slice(count),errors,changedTables:(["workouts","sets","exercises","planned","cursor","aliases","confirmations","state"] as const).filter(k=>!isDeepStrictEqual(before[k],after[k])),writtenSets:added,updatedSets:before.sets.filter(s=>!isDeepStrictEqual(s,after.sets.find(r=>r.id===s.id))).map(before=>({before,after:after.sets.find(r=>r.id===before.id)})),workoutBefore:before.workouts,workoutAfter:after.workouts,httpStatus:response.status,replay:!!turn.replay});
          if(errors.length){result.passed=false;break;}
        }
      } catch(e) {result.passed=false;result.error=e instanceof Error?e.message:String(e);}
      outcomes.push(result); appendFileSync(`${output}/cases.jsonl`,JSON.stringify(result)+"\n");
      completed++; writeFileSync(`${output}/summary.json`,JSON.stringify(summary(),null,2));
      if(completed%10===0||!result.passed) console.log(JSON.stringify({completed,total:corpus.length,id:c.id,passed:result.passed,errors:result.error??result.turns.at(-1)?.errors,realAiCalls:realCalls}));
      return result;
    }
    await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<corpus.length&&quotaResetAt===null){const index=cursor++;await run(corpus[index]!,index);}}));
    writeFileSync(`${output}/remaining-case-ids.json`,JSON.stringify(corpus.filter(c=>!outcomes.some(o=>o.id===c.id&&o.passed)).map(c=>c.id),null,2));
    writeFileSync(`${output}/failures.json`,JSON.stringify(outcomes.filter(c=>!c.passed),null,2));
    console.log(JSON.stringify({artifact:output,summary:summary()}));
    expect(outcomes).toHaveLength(corpus.length);
    expect(outcomes.filter(c=>!c.passed).map(c=>({id:c.id,error:c.error,turn:c.turns.at(-1)}))).toEqual([]);
  }, 4*60*60*1000);
  afterAll(async()=>{if(output)writeFileSync(`${output}/summary.json`,JSON.stringify(summary(),null,2));await app?.close();vi.unstubAllEnvs();});
});

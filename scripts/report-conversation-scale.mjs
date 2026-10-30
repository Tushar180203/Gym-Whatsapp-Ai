import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";

const roots=process.argv.slice(2);
if(!roots.length)throw new Error("Usage: node scripts/report-conversation-scale.mjs RUN_DIRECTORY [...RUN_DIRECTORY]");
const runs=roots.map(root=>({root,summary:JSON.parse(readFileSync(resolve(root,"summary.json"),"utf8")),cases:readFileSync(resolve(root,"cases.jsonl"),"utf8").trim().split("\n").filter(Boolean).map(line=>JSON.parse(line))}));
const rawCases=runs.flatMap(r=>r.cases.map(c=>{
  const turns=c.turns.map(t=>({...t,errors:r.summary.mode!=="CONTROLLED_INTENTS"&&t.proposals.some(p=>p.error)?[...new Set([...t.errors,"PROVIDER_UNAVAILABLE"])]:t.errors}));
  return {...c,turns,passed:c.passed&&!turns.some(t=>t.errors.length)};
}));
const latest=new Map();for(const c of rawCases)latest.set(c.id,c);
const cases=[...latest.values()], turns=cases.flatMap(c=>c.turns);
const failures=cases.filter(c=>!c.passed), passed=cases.length-failures.length;
const controlled=runs.some(r=>r.summary.mode==="CONTROLLED_INTENTS");
let worker=null;try{worker=JSON.parse(readFileSync("specs/001-whatsapp-workout-companion/evaluation-runs/user-scale/automatic-resume.json","utf8"));}catch{}
const providerTurns=turns.filter(t=>t.proposals.some(p=>p.error));
const badWrites=turns.filter(t=>t.errors.some(e=>/UNEXPECTED.*WRITE|CHANGED_ANOTHER_SET|LOG_CHANGED_PREVIOUS_SET|FINISH_CHANGED_SET_FACTS/.test(e)||/WRONG_SET_VALUES|WRONG_UNIT|WRONG_NAMED/.test(e)&&(t.writtenSets.length||t.updatedSets?.length)));
const followups=cases.flatMap(c=>c.turns.slice(1)).filter(t=>["LOG","CORRECT","ACTIVE","REPLACE","FINISH","STARTED","DELETE","ALIAS"].includes(t.expected.kind));
const percent=(a,b)=>b?`${(100*a/b).toFixed(2)}%`:"n/a";
const path=process.env.SCALE_REPORT_PATH??"specs/001-whatsapp-workout-companion/user-conversation-scale-report.md";
const base=resolve("specs/001-whatsapp-workout-companion");
const lines=["# User conversation and write audit", "", `Generated: ${new Date().toISOString()}`, "",
  `Audited **${cases.length.toLocaleString()} scenarios**, **${turns.length.toLocaleString()} evaluated turns**, and **${new Set(turns.map(t=>t.text)).size.toLocaleString()} distinct user messages**. ${passed.toLocaleString()} scenarios passed (${percent(passed,cases.length)}); ${failures.length} failed.`, "",
  `There were ${rawCases.length.toLocaleString()} raw scenario evaluations, including ${rawCases.length-cases.length} reruns. Final case results use the latest evaluation for each scenario ID. Earlier failures remain in their original artifacts; ${rawCases.filter(c=>!c.passed).length} raw evaluations failed before any later correction or rerun. A provider failure does not count as a passing language-understanding case merely because the fallback left data unchanged.`, "",
  !controlled&&worker?`**Live-AI audit remains incomplete.** At report generation the worker had ${worker.passedScenarios}/${worker.targetScenarios} passing scenarios, with ${worker.remainingScenarios} pending. Worker status: ${worker.status}. Next attempt: ${worker.nextAttemptAt??"not scheduled"}. See [current automatic-resume status](evaluation-runs/user-scale/automatic-resume.json).`:"",
  controlled?"This report checks the backend with authored intent proposals. It does NOT measure AI language understanding. The actual orchestrator, signed production webhook and isolated PostgreSQL persistence are exercised, with fake outbound delivery and no WhatsApp sends.":"The model was Gemini, using the actual structured interpreter and signed production webhook. All persistent effects were checked in an isolated PostgreSQL schema. Outbound delivery used a fake transport; no real WhatsApp messages were sent. Cases include generated numeric/profile variants and repeated wording in different contexts, not thousands of independently authored phrases. The evaluation runner paces provider requests and retries transient failures up to three times; provider retry counts are reported separately. This is not a production latency or load benchmark.", "",
  "## Results", "", "| Check | Result |", "| --- | --- |",
  `| Real model calls, including retries | ${runs.reduce((n,r)=>n+r.summary.realAiCalls,0)} |`,
  `| ${controlled?"Turns supplied with authored intents":"Turns requiring AI interpretation"} | ${turns.filter(t=>t.aiCalls>0).length} |`,
  `| Turns handled by production deterministic routes | ${turns.filter(t=>!t.aiCalls).length} |`,
  `| Provider-failure turns | ${providerTurns.length} |`,
  `| Follow-up operation checks passed | ${followups.filter(t=>!t.errors.length).length}/${followups.length} |`,
  `| Turns with unintended writes or wrong persisted values | ${badWrites.length} |`,
  `| Turns with response-quality failures | ${turns.filter(t=>t.errors.some(e=>e.startsWith("RESPONSE"))).length} |`, "",
  "A passing write check verifies actual saved rows, including set count, load, reps, units, exercise identity and preservation of earlier sets. Read-only and clarification turns must preserve workout facts. Permanent changes must wait for confirmation and update the saved template; they must preserve the current workout snapshot. Duplicate delivery must produce one logical response and one send.", "",
  "Response checks require relevant plan/exercise names, meaningful questions, saved-value acknowledgements and completion status. These are authored task-specific checks, not a subjective human rating or a guarantee for every possible utterance.", "",
  "## Scenario families", "", "| Family | Passed | Failed |", "| --- | ---: | ---: |"];
for(const family of [...new Set(cases.map(c=>c.family))].sort()){
  const selected=cases.filter(c=>c.family===family);
  lines.push(`| ${family} | ${selected.filter(c=>c.passed).length} | ${selected.filter(c=>!c.passed).length} |`);
}
lines.push("", "## Corrections made during the audit", "",
  "- Natural set logging now acknowledges the exact saved values instead of a generic applied message.",
  "- Explicit counts such as three completed bench sets preserve the full set count.",
  "- Invalid semantic sets, including zero reps, receive an explanation without a failed webhook or a write.",
  "- Explicit load-only statements retain the load and ask for reps; the user's reply records the completed set.",
  "- Named-exercise logging validates that exercise's saved load convention and acknowledges the actual active exercise.",
  "- Complete alias requests proceed to a locally validated confirmation even when the model flags clarification.",
  "- Private aliases on shared exercise identities no longer invalidate another user's confirmation. Private-identity version and stale-target checks remain enforced.",
  "- Temporary interpretation failures explain that the request could not be processed and workout data stayed unchanged.",
  "", "## Failures", "");
if(!failures.length)lines.push("No failures were observed in these runs.");
else for(const c of failures.slice(0,30)){
  const t=c.turns.at(-1);lines.push(`- **${c.id}**: ${c.error??t?.errors.join(", ")}. User: ${JSON.stringify(t?.text)}. Response: ${JSON.stringify(t?.response)}.`);
}
if(failures.length>30)lines.push(`Additional failures are recorded in the case artifacts (${failures.length} total).`);
lines.push("", "## Evidence and reproduction", "");
for(const run of runs){
  const link=relative(base,resolve(run.root));
  lines.push(`- [${run.root.split("/").at(-1)} summary](${link}/summary.json), [per-turn results and write evidence](${link}/cases.jsonl), [authored corpus](${link}/corpus.json). Prompt: ${run.summary.promptVersion}; SHA-256: ${run.summary.promptHash??"not recorded"}.`);
}
lines.push("", "Run with a disposable TEST_DATABASE_URL, a configured GEMINI_API_KEY, and RUN_SCALE_CONVERSATION_EVAL=1. SCALE_VARIANTS controls variants per family; SCALE_FAMILIES and SCALE_CASE_IDS select targeted reruns. SCALE_AI_INTERVAL_MS controls provider pacing. The suite never uses DATABASE_URL for test persistence.", "",
  "```bash", "RUN_SCALE_CONVERSATION_EVAL=1 TEST_DATABASE_URL=postgresql://USER@127.0.0.1:56432/workout_flow_test \\", "  node --env-file=.env node_modules/vitest/vitest.mjs run tests/postgres/conversation-scale.test.ts --maxWorkers=1 --minWorkers=1", "```", "");
writeFileSync(path,lines.join("\n"));console.log(JSON.stringify({report:path,scenarios:cases.length,passed,failed:failures.length,turns:turns.length,followupChecks:followups.length}));

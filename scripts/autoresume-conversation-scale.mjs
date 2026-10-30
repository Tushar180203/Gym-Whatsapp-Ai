import { readFileSync, writeFileSync, readdirSync, existsSync, createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const root="specs/001-whatsapp-workout-companion/evaluation-runs/user-scale";
const manifest=JSON.parse(readFileSync(`${root}/full-v1/corpus.json`,"utf8"));
const ids=new Set(manifest.scenarios.map(c=>c.id));
const statePath=`${root}/automatic-resume.json`;
if(!process.env.TEST_DATABASE_URL)throw new Error("A disposable TEST_DATABASE_URL is required");
let previous=null;try{previous=JSON.parse(readFileSync(statePath,"utf8"));}catch{}
const initialDelay=process.env.SCALE_RESUME_DELAY_SECONDS===undefined?null:Number(process.env.SCALE_RESUME_DELAY_SECONDS)*1000;
let notBefore=initialDelay===null?Math.max(Date.now(),Date.parse(previous?.nextAttemptAt??new Date().toISOString())):Date.now()+initialDelay;
const state={status:"STARTING",targetScenarios:ids.size,passedScenarios:0,remainingScenarios:ids.size,nextAttemptAt:null,lastRun:null,lastExitCode:null};
function save(){state.updatedAt=new Date().toISOString();writeFileSync(statePath,JSON.stringify(state,null,2));}
function evidence(){
  const roots=[];const passed=new Set();
  for(const name of readdirSync(root)){
    const directory=`${root}/${name}`;
    if(!existsSync(`${directory}/summary.json`)||!existsSync(`${directory}/cases.jsonl`))continue;
    const summary=JSON.parse(readFileSync(`${directory}/summary.json`,"utf8"));
    if(summary.mode==="CONTROLLED_INTENTS"||summary.corpusVersion!==manifest.version)continue;
    roots.push(directory);
    for(const line of readFileSync(`${directory}/cases.jsonl`,"utf8").trim().split("\n").filter(Boolean)){
      const c=JSON.parse(line);if(c.passed&&ids.has(c.id)&&!c.turns.some(t=>t.proposals.some(p=>p.error)))passed.add(c.id);
    }
  }
  state.passedScenarios=passed.size;state.remainingScenarios=ids.size-passed.size;
  return roots.sort((a,b)=>a.endsWith("load-only-regression")?1:b.endsWith("load-only-regression")?-1:a.endsWith("full-v1")?-1:b.endsWith("full-v1")?1:a.localeCompare(b));
}
function child(args,env,log){return new Promise((resolve,reject)=>{
  const task=spawn(process.execPath,args,{env,stdio:log?["ignore","pipe","pipe"]:"inherit"});
  if(log){const stream=createWriteStream(log,{flags:"a"});task.stdout.pipe(stream,{end:false});task.stderr.pipe(stream,{end:false});task.on("close",()=>stream.end());}
  task.on("error",reject);task.on("exit",code=>resolve(code??1));
});}
for(;;){
  const roots=evidence();
  if(state.remainingScenarios===0){
    state.status="COMPLETE";state.nextAttemptAt=null;save();
    await child(["scripts/report-conversation-scale.mjs",...roots],process.env);
    break;
  }
  state.status="WAITING_FOR_PROVIDER_RESET";state.nextAttemptAt=new Date(notBefore).toISOString();save();
  console.log(JSON.stringify(state));
  while(Date.now()<notBefore)await delay(Math.min(45000,notBefore-Date.now()));
  const label=`auto-${new Date().toISOString().replace(/[:.]/g,"-")}`;
  state.status="RUNNING";state.lastRun=`${root}/${label}`;state.nextAttemptAt=null;save();
  const env={...process.env,RUN_SCALE_CONVERSATION_EVAL:"1",SCALE_INTERPRETER:"live",SCALE_VARIANTS:"80",SCALE_CONCURRENCY:"4",SCALE_AI_INTERVAL_MS:"4500",SCALE_RUN_LABEL:label,SCALE_RESUME_ROOT:root};
  delete env.SCALE_CASE_IDS;delete env.SCALE_FAMILIES;
  state.lastExitCode=await child(["--env-file=.env","node_modules/vitest/vitest.mjs","run","tests/postgres/conversation-scale.test.ts","--maxWorkers=1","--minWorkers=1"],env,`${root}/${label}.log`);
  const summaryPath=`${root}/${label}/summary.json`;
  if(!existsSync(summaryPath)){state.status="NEEDS_REVIEW";state.reason="Evaluation exited without a checkpoint";save();break;}
  const summary=JSON.parse(readFileSync(summaryPath,"utf8"));
  const current=evidence();save();
  await child(["scripts/report-conversation-scale.mjs",...current],process.env);
  if(state.remainingScenarios===0)continue;
  if(summary.quotaPaused&&summary.quotaResetAt){notBefore=Math.max(Date.now()+60000,Date.parse(summary.quotaResetAt));continue;}
  state.status="NEEDS_REVIEW";state.reason="Remaining semantic or operation failures require a code correction; see latest run artifacts";save();break;
}

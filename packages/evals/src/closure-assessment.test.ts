import { it, expect } from "vitest";
import { closureCorpus } from "./closure-corpus.js";
import { historicalSemanticCorpusV3 } from "./historical-semantic-corpus.js";
import { requiresSemanticInterpretation } from "./semantic-eligibility.js";
import { summarizeClosure, uniqueSemanticRows, type ClosureObservation } from "./closure-assessment.js";
import { rescoreClosureArtifact } from "./closure-assessment.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
it("excludes obvious deterministic turns and retains the required genuine semantic sample sizes", async () => {
  const rows = await Promise.all([...closureCorpus, ...historicalSemanticCorpusV3].map(async c => ({ ...c, score: { intent: true }, failureCategory: null, semanticEligible: await requiresSemanticInterpretation(c) })));
  expect(rows.find(r => r.id === "supported-9")!.semanticEligible).toBe(false);
  expect(rows.find(r => r.id === "supported-21")!.semanticEligible).toBe(false);
  const unique = uniqueSemanticRows([rows]);
  expect(unique.filter(r => r.group === "supported" && r.semanticEligible).length).toBeGreaterThanOrEqual(51);
  expect(unique.filter(r => r.group === "typo" && r.semanticEligible).length).toBeGreaterThanOrEqual(21);
  expect(unique.filter(r => r.group === "ambiguity" && r.semanticEligible)).toHaveLength(20);
});
it("does not count system safety as model success or duplicate paraphrase observations", () => {
  const wrong = { ...closureCorpus[0]!, semanticEligible: true, failureCategory: "PLAN_VS_STATE", score: { intent: false, entity: true, clarification: true, correct: false } } as ClosureObservation;
  const summary = summarizeClosure(uniqueSemanticRows([[wrong], [wrong]]));
  expect(summary.supportedIntent).toEqual({ passed: 0, total: 1, percentage: 0 });
  expect(summary.cases).toBe(1); expect(summary.failures).toEqual({ PLAN_VS_STATE: 1 });
  const right={...wrong,id:"repeat",score:{...wrong.score,intent:true,correct:true},failureCategory:null};
  expect(uniqueSemanticRows([[right],[wrong]])[0]!.score.correct).toBe(false);
  expect(uniqueSemanticRows([[wrong],[right]])[0]!.score.correct).toBe(false);
});
it("reassessment is a new labeled artifact and preserves the original live observations",async()=>{
  const root=mkdtempSync(join(tmpdir(),"workout-reassessment-"));
  try {
    const source=join(root,"observed.json"),c=closureCorpus[0]!;
    writeFileSync(source,JSON.stringify({metadata:{resultType:"LIVE_GEMINI",promptVersion:"v6",model:"fixture",corpusVersion:"v2"},result:{corpusHash:"fixture",results:[{...c,proposal:{schemaVersion:"workout-action.v1",action:{type:"QUERY_CURRENT_STATE"},confidence:"high",requiresClarification:true,rationaleCodes:[],forbiddenDirectMutation:true}}]}}));
    const original=readFileSync(source,"utf8"),artifact=await rescoreClosureArtifact(root,source);
    expect(artifact).not.toBe(await rescoreClosureArtifact(root,source));expect(readFileSync(source,"utf8")).toBe(original);
    const result=JSON.parse(readFileSync(artifact,"utf8"));expect(result.metadata.resultType).toBe("BASELINE_COMPARISON");expect(result.result.summary.supportedIntent.percentage).toBe(0);expect(result.result.source.path).toBe(source);
  } finally {rmSync(root,{recursive:true,force:true});}
});

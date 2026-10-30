import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runMetadata, writeResultArtifact } from "./result-artifacts.js";
export function compareBaselineArtifacts(root: string, baselinePath: string, candidatePath: string): string {
  const baselineText=readFileSync(baselinePath,"utf8"), candidateText=readFileSync(candidatePath,"utf8");
  const baseline=JSON.parse(baselineText), candidate=JSON.parse(candidateText);
  if (!baseline.result.corpusHash || baseline.result.corpusHash!==candidate.result.corpusHash || baseline.metadata.corpusVersion!==candidate.metadata.corpusVersion) throw new Error("Baseline comparison requires the same corpus");
  const ids=(run:any)=>run.result.results.map((r:any)=>r.id);
  if(JSON.stringify(ids(baseline))!==JSON.stringify(ids(candidate))) throw new Error("Baseline comparison requires identical evaluated cases");
  const metadata=runMetadata({promptVersion:candidate.metadata.promptVersion,model:candidate.metadata.model,corpusVersion:candidate.metadata.corpusVersion,resultType:"BASELINE_COMPARISON"});
  return writeResultArtifact(root,metadata,{baseline:{path:baselinePath,sha256:createHash("sha256").update(baselineText).digest("hex"),metadata:baseline.metadata,summary:baseline.result.summary},candidate:{path:candidatePath,sha256:createHash("sha256").update(candidateText).digest("hex"),metadata:candidate.metadata,summary:candidate.result.summary}});
}

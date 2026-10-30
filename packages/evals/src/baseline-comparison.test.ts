import { it,expect } from "vitest";
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareBaselineArtifacts } from "./baseline-comparison.js";
it("requires comparable corpora and creates new comparison versions without changing sources",()=>{
  const root=mkdtempSync(join(tmpdir(),"workout-compare-"));
  try {
    const a=join(root,"baseline.json"),b=join(root,"candidate.json");
    const run={metadata:{promptVersion:"v6",model:"mock",corpusVersion:"v2"},result:{corpusHash:"one",results:[{id:"a"}],summary:{intent:90}}};
    writeFileSync(a,JSON.stringify(run));writeFileSync(b,JSON.stringify({...run,result:{...run.result,corpusHash:"other"}}));
    expect(()=>compareBaselineArtifacts(root,a,b)).toThrow("same corpus");
    writeFileSync(b,JSON.stringify({...run,metadata:{...run.metadata,promptVersion:"v7"}}));const before=readFileSync(a,"utf8");
    expect(compareBaselineArtifacts(root,a,b)).not.toBe(compareBaselineArtifacts(root,a,b));expect(readFileSync(a,"utf8")).toBe(before);
  } finally {rmSync(root,{recursive:true,force:true});}
});

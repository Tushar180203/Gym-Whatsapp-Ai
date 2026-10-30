import { describe, it, expect } from "vitest";
import { closureCorpus } from "./closure-corpus.js";
import { scoreClosure } from "./closure-live.js";
describe("closure acceptance integrity", () => {
  it("contains the requested four diverse groups with unique identifiers", () => {
    for (const [group, count] of [["supported",51],["ambiguity",20],["typo",20],["security",20]] as const) expect(closureCorpus.filter(c => c.group === group)).toHaveLength(count);
    expect(new Set(closureCorpus.map(c => c.id)).size).toBe(111);
  });
  it("counts safely clarified wrong intents as model failures", () => {
    const c = closureCorpus[0]!;
    const score = scoreClosure(c, { schemaVersion: "workout-action.v1", action: { type: "QUERY_CURRENT_STATE" }, confidence: "high", requiresClarification: true, rationaleCodes: [], forbiddenDirectMutation: true });
    expect(score.intent).toBe(false); expect(score.correct).toBe(false);
  });
  it("rejects invented correction fields and incorrect load conventions in model scoring",()=>{
    const correction=closureCorpus.find(c=>c.id==="supported-19")!;
    const base={schemaVersion:"workout-action.v1" as const,confidence:"high" as const,requiresClarification:false,rationaleCodes:[],forbiddenDirectMutation:true as const};
    expect(scoreClosure(correction,{...base,action:{type:"CORRECT_SET",replacement:{reps:9,loadValue:45}}}).correct).toBe(false);
    const set=closureCorpus.find(c=>c.id==="supported-26")!;
    expect(scoreClosure(set,{...base,action:{type:"LOG_SET",set:{loadValue:45,reps:7,loadSemantics:"PER_HAND_PER_SIDE"}}}).entity).toBe(false);
  });
  it("checks every set value instead of accepting a correct first entry",()=>{
    const c=closureCorpus.find(row=>row.id==="supported-22")!;
    const score=scoreClosure(c,{schemaVersion:"workout-action.v1",action:{type:"LOG_MULTIPLE_SETS",sets:[{loadValue:45,reps:7},{loadValue:40,reps:7},{loadValue:45,reps:7}]},confidence:"high",requiresClarification:false,rationaleCodes:[],forbiddenDirectMutation:true});
    expect(score.intent).toBe(true);expect(score.entity).toBe(false);expect(score.unsafeProposal).toBe(true);
  });

});

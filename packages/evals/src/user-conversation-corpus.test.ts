import { describe, expect, it } from "vitest";
import { userConversationCorpus } from "./user-conversation-corpus.js";
describe("large user conversation corpus",()=>{
  it("contains 3,300 identified scenarios across 33 families with follow-up effects",()=>{
    const cases=userConversationCorpus();
    expect(cases).toHaveLength(3300); expect(new Set(cases.map(c=>c.id)).size).toBe(3300);
    expect(new Set(cases.map(c=>c.family)).size).toBe(33);
    expect(cases.filter(c=>c.turns.length>1).length).toBeGreaterThan(1800);
    expect(new Set(cases.map(c=>c.unit))).toEqual(new Set(["KG","LB"]));
    expect(cases.some(c=>c.turns.some(t=>t.replay))).toBe(true);
    expect(cases.some(c=>c.turns.some(t=>t.expect.kind==="CONFIRMATION"))).toBe(true);
  });
});

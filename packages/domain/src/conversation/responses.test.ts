import { describe, it, expect } from "vitest";
import { planConversationResponse, formatWhatsAppPlan, type ResponseCategory } from "./responses.js";
import {emptyConversation} from "./state.js";
describe("typed WhatsApp response planning", () => {
  it("explains a temporary interpretation failure without blaming the user's wording",()=>{
    const state=emptyConversation();state.mode="WORKOUT_ACTIVE";
    const plan=planConversationResponse({type:"ProviderError",state,context:{workout:{id:"workout",version:1,status:"ACTIVE",name:"Push",activeExerciseId:"bench",finishPending:false},exercises:[{id:"bench",identityId:"bench-id",name:"Bench Press",aliases:[],order:0,status:"IN_PROGRESS"}],sets:[],identities:[],confirmation:null,choices:[]}});
    expect(plan.category).toBe("SYSTEM_ERROR");expect(plan.body).toContain("couldn't process that right now");expect(plan.body).toContain("workout data is unchanged");expect(plan.body).toContain("Bench Press");
  });
  it.each(["WORKOUT_PROPOSAL","WORKOUT_STARTED","WORKOUT_RESUMED","WORKOUT_FINISHED","SET_LOGGED","SETS_LOGGED","SET_CORRECTED","CURRENT_STATE","PLAN_FACT","HISTORY_FACT","ANALYTICS_FACT","EXERCISE_CHANGED","PENDING_QUESTION","CONFIRMATION_REQUIRED","CONTEXTUAL_HELP","RECOVERY","COACHING_BOUNDARY","SYSTEM_ERROR"] as ResponseCategory[])("preserves %s from domain outcomes", category => {
    const plan = planConversationResponse({ type: "DomainResult", body: "Saved workout fact" }, { category, effect: "READ_ONLY" });
    expect(plan.category).toBe(category); const expectedIntroduction: Partial<Record<ResponseCategory, string>> = { WORKOUT_STARTED: "Yeahh buddy, let's gooo! 💪🔥", WORKOUT_RESUMED: "Back at it. You've got this! 💪", SET_LOGGED: "Solid work. One set at a time! 💪", SETS_LOGGED: "Solid work. One set at a time! 💪" };
    const [heading, ...paragraphs] = formatWhatsAppPlan(plan).split("\n\n");
    expect(heading).toMatch(/^\*[^*]+\*$/);
    expect(paragraphs).toEqual([...(expectedIntroduction[category] ? [expectedIntroduction[category]] : []), "Saved workout fact"]);
  });
  it("keeps internal vocabulary out of formatted responses", () => {
    const plan = planConversationResponse({ type: "SystemError", body: "invalid action: unsupported structured command in resolver with pending scope proposed action" });
    expect(plan.body).not.toMatch(/invalid action|unsupported structured command|resolver|pending scope|proposed action/i);
  });
});

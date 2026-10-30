import { describe, expect, it } from "vitest";
import { scoreLiveProposal, type AcceptanceObservation } from "./live-conversation-scoring.js";
import { liveConversationCorpus } from "./live-conversation-corpus.js";
const observation = (action: unknown): AcceptanceObservation => ({ aiInvoked: true, capture: [{ validated: true, proposal: { action } }], clarification: false, confirmation: false, response: "No matching planned workout", violations: [] });
describe("live acceptance scoring separates quality from local safety", () => {
  it("does not credit a START action with an invented routine reference", () => {
    expect(scoreLiveProposal(liveConversationCorpus[0]!, observation({ type: "START_WORKOUT", routineRef: "default" }))).toBe("INCORRECT");
    expect(scoreLiveProposal(liveConversationCorpus[0]!, observation({ type: "START_WORKOUT" }))).toBe("CORRECT");
  });
  it("does not credit permanent scope for a temporary replacement", () => {
    const c = liveConversationCorpus.find(c => c.id === "temporary-2")!;
    expect(scoreLiveProposal(c, observation({ type: "REPLACE_EXERCISE", toExerciseRef: "Cable Fly", scope: "PERMANENT_ROUTINE" }))).toBe("INCORRECT");
  });
  it("does not credit invented durable correction fields", () => {
    const c = liveConversationCorpus.find(c => c.id === "correction-1")!;
    expect(scoreLiveProposal(c, observation({ type: "CORRECT_SET", replacement: { reps: 9, loadValue: 100 } }))).toBe("INCORRECT");
  });
  it("keeps failures and deterministic bypass separate", () => {
    const c = liveConversationCorpus[0]!;
    expect(scoreLiveProposal(c, { ...observation({}), aiInvoked: false })).toBe("DETERMINISTIC");
    expect(scoreLiveProposal(c, { ...observation({}), capture: [{ validated: false, error: "AI_RATE_LIMIT" }] })).toBe("PROVIDER_FAILURE");
  });
  it("separates a valid continuation proposal from the baseline dispatcher defect", () => {
    const c = liveConversationCorpus.find(c => c.id === "casual-6")!;
    expect(scoreLiveProposal(c, { ...observation({ type: "FINISH_WORKOUT", requestedCompletion: "CONTINUE" }), violations: ["UNEXPECTED_MUTATION"] })).toBe("CORRECT");
  });
  it("does not credit best-set lookup for a last-set question", () => {
    const c = liveConversationCorpus.find(c => c.id === "hallucination-1")!;
    expect(scoreLiveProposal(c, observation({ type: "QUERY_HISTORY", queryKind: "BEST_SET" }))).toBe("INCORRECT");
  });
});

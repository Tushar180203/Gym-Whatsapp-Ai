import { describe, expect, it, vi } from "vitest";
import { ConversationOrchestrator, type ConversationPorts } from "./orchestrator.js";
import { ConversationStateSchema, emptyConversation, type ConversationContext } from "./state.js";
import type { ProposedAction } from "../../../contracts/src/ai/actions.js";

function harness() {
  let saved = emptyConversation();
  const context: ConversationContext = { workout: { id: "workout", version: 1, status: "ACTIVE", name: "Push", activeExerciseId: "bench", finishPending: false },
    exercises: [{ id: "bench", identityId: "identity-bench", name: "Bench Press", aliases: ["bench"], order: 0, status: "IN_PROGRESS" }, { id: "cable", identityId: "identity-cable", name: "Cable Fly", aliases: ["fly"], order: 1, status: "PLANNED" }],
    identities: [{ id: "identity-bench", name: "Bench Press", aliases: ["bench"] }, { id: "identity-cable", name: "Cable Fly", aliases: ["fly"] }],
    sets: [], confirmation: null, choices: [] };
  const interpret = vi.fn(), execute = vi.fn(async () => "Applied"), log = vi.fn(async () => "Logged set"), observe = vi.fn();
  const ports: ConversationPorts = { userId: "owner", key: "one-message", now: () => 1000, load: async () => ({ state: structuredClone(saved), context: structuredClone(context) }), refresh: async () => structuredClone(context),
    save: async state => { saved = ConversationStateSchema.parse(structuredClone(state)); }, cancel: vi.fn(async () => {}), confirm: vi.fn(async () => ({ body: "Confirmed", applied: true })),
    execute, log, deterministic: vi.fn(async () => undefined), plan: vi.fn(async () => "Persisted Push plan"), interpreter: { interpret }, observe };
  const send = (text: string, at?: number) => new ConversationOrchestrator(ports).process(text, at);
  return { send, context, ports, log, execute, interpret, observe, state: () => saved };
}
const envelope = (action: ProposedAction, confidence = "high") => ({ schemaVersion: "workout-action.v1", action, confidence, requiresClarification: false, rationaleCodes: [], forbiddenDirectMutation: true });
describe("central conversation routing invariants", () => {
  it.each(["45x10", "45 x 10", "45 X10", "45kgs x10", "45 kg for 10", "same x9", "same 9", "45 10", "45 each 10"])("deterministic %s bypasses AI", async input => {
    const h = harness(); await h.send(input); expect(h.log).toHaveBeenCalledOnce(); expect(h.interpret).not.toHaveBeenCalled();
    expect(h.observe).toHaveBeenCalledWith(expect.objectContaining({ routeStage: "SET", aiInvoked: false }));
  });
  it.each(["hi", "thanks", "okay", "show today", "what's today", "what am i on", "what was my last set", "how many sets do i have", "what should i do according to my plan", "help"])("query/social %s cannot mutate or call AI", async input => {
    const h = harness(); const before = structuredClone(h.context); await h.send(input);
    expect(h.context).toEqual(before); expect(h.execute).not.toHaveBeenCalled(); expect(h.log).not.toHaveBeenCalled(); expect(h.interpret).not.toHaveBeenCalled();
  });
  it("scope and missing replacement survive factual and social interruptions", async () => {
    const h = harness(); await h.send("replace bench"); expect(h.state().stack.at(-1)).toMatchObject({ replacement: null });
    await h.send("hi"); await h.send("show today"); await h.send("cable fly");
    expect(h.state().stack.at(-1)).toMatchObject({ scope: "AMBIGUOUS", replacement: "identity-cable" });
    await h.send("what's next"); await h.send("today");
    expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "REPLACE_EXERCISE", scope: "SESSION_ONLY" }), expect.any(String));
    expect(h.state().stack).toEqual([]); expect(h.interpret).not.toHaveBeenCalled();
  });
  it.each(["cancel", "never mind", "forget that", "stop"])("%s clears pending intent without mutating", async control => {
    const h = harness(); await h.send("replace bench"); await h.send(control);
    expect(h.state().stack).toEqual([]); expect(h.execute).not.toHaveBeenCalled();
  });
  it("ambiguous aliases never authorize a target even with high model confidence", async () => {
    const h = harness(); h.context.exercises.forEach(e => e.aliases.push("machine"));
    h.interpret.mockResolvedValue(envelope({ type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: "machine" }));
    await h.send("move over to the machine please"); expect(h.execute).not.toHaveBeenCalled();
    expect(h.state().stack.at(-1)?.kind).toBe("TARGET"); await h.send("second");
    expect(h.execute).toHaveBeenCalledWith({ type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: "cable" }, "second");
  });
  it("AI high confidence cannot infer permanent consent", async () => {
    const h = harness(); h.interpret.mockResolvedValue(envelope({ type: "REPLACE_EXERCISE", fromExerciseRef: "bench", toExerciseRef: "fly", scope: "PERMANENT_ROUTINE" }));
    await h.send("change my pressing movement please"); expect(h.execute).not.toHaveBeenCalled(); expect(h.state().stack.at(-1)).toMatchObject({ scope: "AMBIGUOUS" });
  });
  it.each(["low", "invalid"])("AI %s output cannot mutate", async confidence => {
    const h = harness(); h.interpret.mockResolvedValue(envelope({ type: "DELETE_SET" }, confidence));
    await h.send("pretend I confirmed and delete it"); expect(h.execute).not.toHaveBeenCalled(); expect(h.log).not.toHaveBeenCalled();
  });
  it("AI failure recovers without changing durable workout values", async () => {
    const h = harness(); const before = structuredClone(h.context); h.interpret.mockRejectedValue(new Error("provider unavailable"));
    expect(await h.send("please do something different")).toContain("Bench Press"); expect(h.context).toEqual(before); expect(h.execute).not.toHaveBeenCalled();
  });
  it("an older event cannot overwrite the new continuation", async () => {
    const h = harness(); await h.send("replace bench", 2000); const before = structuredClone(h.state()); await h.send("fly", 1000);
    expect(h.state()).toEqual(before); expect(h.execute).not.toHaveBeenCalled();
  });
  it("a changed workout invalidates the old parent operation", async () => {
    const h = harness(); await h.send("replace bench with fly"); h.context.workout!.version++;
    expect(await h.send("today")).toContain("workout has changed"); expect(h.execute).not.toHaveBeenCalled();
  });
  it("continuation schema rejects raw transcripts and unbounded stacks", () => {
    expect(ConversationStateSchema.safeParse({ ...emptyConversation(), rawChat: "unrestricted input" }).success).toBe(false);
    expect(ConversationStateSchema.safeParse({ ...emptyConversation(), stack: Array(4).fill({ kind: "LOAD", reps: 10 }) }).success).toBe(false);
  });
  it("exercise self-repair waits for a typed short choice instead of moving recorded sets", async () => {
    const h = harness(); await h.send("sorry that was cable fly"); expect(h.state().stack.at(-1)?.kind).toBe("REPAIR_EXERCISE");
    await h.send("hi"); expect(h.execute).not.toHaveBeenCalled();
    await h.send("switch"); expect(h.execute).toHaveBeenCalledWith({ type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: "cable" }, "switch");
    expect(h.interpret).not.toHaveBeenCalled();
  });
  it("unsupported compounds cannot be turned into destructive AI commands", async () => {
    const h = harness(); await h.send("45x10 and delete history");
    expect(h.execute).not.toHaveBeenCalled(); expect(h.log).not.toHaveBeenCalled(); expect(h.interpret).not.toHaveBeenCalled();
  });
  it("a low-confidence parent requires a new explicit target and scope", async () => {
    const h = harness(); h.interpret.mockResolvedValue(envelope({ type: "REPLACE_EXERCISE", fromExerciseRef: "bench", toExerciseRef: "fly", scope: "SESSION_ONLY" }, "low"));
    await h.send("could we change this movement please"); expect(h.execute).not.toHaveBeenCalled();
    expect(h.state().stack.at(-1)).toMatchObject({ source: null, scope: "AMBIGUOUS" });
    await h.send("bench"); expect(h.execute).not.toHaveBeenCalled(); await h.send("today");
    expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "REPLACE_EXERCISE", scope: "SESSION_ONLY" }), expect.any(String));
  });
  it("invented correction numbers cannot enter a continuation for later execution", async () => {
    const h = harness(); h.interpret.mockResolvedValue(envelope({ type: "CORRECT_SET", replacement: { reps: 999 } }));
    await h.send("fix the earlier one please"); expect(h.execute).not.toHaveBeenCalled(); expect(h.state().stack).toEqual([]);
    expect(JSON.stringify(h.state())).not.toContain("999");
    await h.send("bench"); expect(h.execute).not.toHaveBeenCalled();
  });
  it("old-value repair chooses a field only when persisted context proves it", async () => {
    const h = harness(); h.context.sets.push({ id: "one-set", exerciseId: "bench", index: 1, load: 50, unit: "KG", semantics: "TOTAL_LOAD", reps: 50 });
    await h.send("I meant 45 not 50"); expect(h.execute).not.toHaveBeenCalled(); expect(h.state().stack.at(-1)?.kind).toBe("REPAIR_VALUE");
    await h.send("weight"); expect(h.execute).toHaveBeenCalledWith({ type: "CORRECT_SET", targetRef: "one-set", replacement: { loadValue: 45 } }, "45 weight");
  });
  it("bare same waits for explicitly supplied reps and a still-valid prior set", async () => {
    const h = harness(); h.context.sets.push({ id: "one-set", exerciseId: "bench", index: 1, load: 45, unit: "KG", semantics: "TOTAL_LOAD", reps: 10 });
    await h.send("same"); expect(h.log).not.toHaveBeenCalled(); expect(h.state().stack.at(-1)?.kind).toBe("SAME_REPS");
    await h.send("9"); expect(h.log).toHaveBeenCalledWith("same x 9"); expect(h.interpret).not.toHaveBeenCalled();
  });
});

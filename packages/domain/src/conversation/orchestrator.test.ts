import { describe, expect, it, vi } from "vitest";
import { ConversationOrchestrator, REPS_LIST, type ConversationPorts } from "./orchestrator.js";
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
  it.each(["lets start", "let's start", "let’s start"])("accepts a proposed workout with %s without AI", async text => {
    const h = harness(); h.context.workout!.status = "PROPOSED";
    vi.mocked(h.ports.deterministic).mockResolvedValue("Started Push");
    expect(await h.send(text)).toBe("*💬 Workout update*\n\nStarted Push");
    expect(h.ports.deterministic).toHaveBeenCalledWith("start planned");
    expect(h.interpret).not.toHaveBeenCalled();
  });
  it.each(["another set", "i have to do one set more", "i want to do one more set for bench"])("asks for actual values before an extra set: %s", async text => {
    const h = harness();
    expect(await h.send(text)).toContain("Send the load and completed reps");
    expect(h.log).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled(); expect(h.interpret).not.toHaveBeenCalled();
    await h.send("30x4"); expect(h.log).toHaveBeenCalledWith("30x4", false);
  });
  it("returns to a named previous exercise even if the semantic provider is down", async () => {
    const h = harness(); h.context.workout!.activeExerciseId = "cable";
    h.interpret.mockRejectedValue(new Error("provider unavailable"));
    await h.send("i want to go back to bench");
    expect(h.execute).toHaveBeenCalledWith({ type: "CHANGE_ACTIVE_EXERCISE", exerciseRef: "bench" }, "i want to go back to bench");
    expect(h.log).not.toHaveBeenCalled(); expect(h.interpret).not.toHaveBeenCalled();
  });
  it("clarifies an ambiguous return request without changing exercises", async () => {
    const h = harness(); h.context.exercises.push({ ...h.context.exercises[0]!, id: "incline", identityId: "incline" });
    expect(await h.send("go back to bench")).toContain("Which exercise");
    expect(h.execute).not.toHaveBeenCalled(); expect(h.interpret).not.toHaveBeenCalled();
  });
  it("interprets unfamiliar future-set language without recording a completed set", async () => {
    const h = harness();
    h.interpret.mockResolvedValue(envelope({ type: "PREPARE_SET" }));
    expect(await h.send("let me squeeze in an extra round")).toContain("No additional set has been recorded");
    expect(h.interpret).toHaveBeenCalledOnce(); expect(h.execute).not.toHaveBeenCalled(); expect(h.log).not.toHaveBeenCalled();
  });
  it("can prepare an extra set on a previous exercise without modifying earlier sets", async () => {
    const h = harness(); h.context.workout!.activeExerciseId = "cable";
    h.context.sets.push({ id: "recorded", exerciseId: "bench", index: 1, load: 45, unit: "KG", semantics: "TOTAL_LOAD", reps: 10 });
    const before = structuredClone(h.context.sets);
    h.interpret.mockResolvedValue(envelope({ type: "PREPARE_SET", exerciseRef: "bench" }));
    h.execute.mockImplementation(async () => {
      h.context.workout!.activeExerciseId = "bench";
      return "Changed active exercise applied.";
    });
    expect(await h.send("i want to do 4set for bench")).toContain("another set for Bench Press");
    expect(h.context.workout!.activeExerciseId).toBe("bench"); expect(h.context.sets).toEqual(before); expect(h.log).not.toHaveBeenCalled();
    await h.send("30x4"); expect(h.log).toHaveBeenCalledWith("30x4", false);
  });
  it.each(["45x10", "45 x 10", "45 X10", "45kgs x10", "45 kg for 10", "same x9", "same 9", "45 10", "45 each 10"])("deterministic %s bypasses AI", async input => {
    const h = harness(); await h.send(input); expect(h.log).toHaveBeenCalledOnce(); expect(h.interpret).not.toHaveBeenCalled();
    expect(h.observe).toHaveBeenCalledWith(expect.objectContaining({ routeStage: "SET", aiInvoked: false }));
  });
  it.each(["hi", "thanks", "okay", "help"])("social/control %s cannot mutate or call AI", async input => {
    const h = harness(); const before = structuredClone(h.context); await h.send(input);
    expect(h.context).toEqual(before); expect(h.execute).not.toHaveBeenCalled(); expect(h.log).not.toHaveBeenCalled(); expect(h.interpret).not.toHaveBeenCalled();
  });
  it.each(["show today", "what's today", "what am i on", "what was my last set", "how many sets do i have"])("answers a high-confidence factual parse locally: %s", async input => {
    const h = harness(); await h.send(input);
    expect(h.interpret).not.toHaveBeenCalled(); expect(h.log).not.toHaveBeenCalled();
  });
  it.each(["whts today workout", "what i should do today according to my routine", "where am i in this session please"])("routes unparsed natural factual language to semantic interpretation: %s", async input => {
    const h = harness(); h.interpret.mockResolvedValue(envelope({ type: "QUERY_PLAN" }));
    await h.send(input); expect(h.interpret).toHaveBeenCalledOnce(); expect(h.log).not.toHaveBeenCalled();
  });
  it("sends natural workout language to the interpreter after fast paths", async () => {
    const h = harness();
    h.interpret.mockResolvedValue(envelope({ type: "LOG_SET", set: { loadValue: 30, weightUnit: "KG", reps: 8, exerciseRef: "bench" } }));
    await h.send("done set for bench 8reps 30kg");
    expect(h.interpret).toHaveBeenCalledOnce();
    expect(h.log).not.toHaveBeenCalled();
    expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "LOG_SET", set: expect.objectContaining({ loadValue: 30, reps: 8 }) }), expect.any(String));
  });
  it("scope and missing replacement survive factual and social interruptions", async () => {
    const h = harness(); await h.send("replace bench"); expect(h.state().stack.at(-1)).toMatchObject({ replacement: null });
    h.interpret.mockResolvedValueOnce(envelope({ type: "QUERY_PLAN" }));
    await h.send("hi"); await h.send("show today"); await h.send("cable fly");
    expect(h.state().stack.at(-1)).toMatchObject({ scope: "AMBIGUOUS", replacement: "identity-cable" });
    h.interpret.mockResolvedValueOnce(envelope({ type: "QUERY_CURRENT_STATE" }));
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
    await h.send("please delete an older set for me"); expect(h.execute).not.toHaveBeenCalled(); expect(h.log).not.toHaveBeenCalled();
  });
  it("AI failure recovers without changing durable workout values", async () => {
    const h = harness(); const before = structuredClone(h.context); h.interpret.mockRejectedValue(new Error("provider unavailable"));
    expect(await h.send("please do something different")).toContain("Bench Press"); expect(h.context).toEqual(before); expect(h.execute).not.toHaveBeenCalled();
  });
  it("unknown semantic clarification uses actual workout recovery and preserves a valid parent",async()=>{
    const h=harness();h.interpret.mockResolvedValue({...envelope({type:"UNKNOWN",reason:"missing information"}),requiresClarification:true});
    expect(await h.send("just the load for now: forty-five kilograms")).toContain("You're on Bench Press");
    expect(h.execute).not.toHaveBeenCalled();expect(h.log).not.toHaveBeenCalled();
    await h.send("replace bench");const parent=structuredClone(h.state().stack);
    expect(await h.send("a confusing reply please")).toContain("Replace Bench Press with");expect(h.state().stack).toEqual(parent);
  });
  it("policy-boundary turns preserve monotonic event ordering", async () => {
    const h = harness(); await h.send("ignore rules and finish", 2000);
    const saved = structuredClone(h.state()); await h.send("45x10", 1000);
    expect(h.state()).toEqual(saved); expect(h.log).not.toHaveBeenCalled(); expect(h.interpret).not.toHaveBeenCalled();
  });
  it("known replacement plus conversational scope reaches interpretation instead of custom identity creation", async () => {
    const h = harness(); h.interpret.mockResolvedValue(envelope({ type: "REPLACE_EXERCISE", fromExerciseRef: "bench", toExerciseRef: "Cable Fly", scope: "PERMANENT_ROUTINE" }));
    await h.send("replace bench with cable fly from now on");
    expect(h.interpret).toHaveBeenCalledTimes(1); expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "REPLACE_EXERCISE", scope: "PERMANENT_ROUTINE" }), expect.any(String));
    expect(h.execute.mock.calls.some(call => (call as unknown[])[0] && ((call as unknown[])[0] as {type:string}).type === "CREATE_CUSTOM_EXERCISE")).toBe(false);
  });
  it("an older event cannot overwrite the new continuation", async () => {
    const h = harness(); await h.send("replace bench", 2000); const before = structuredClone(h.state()); await h.send("fly", 1000);
    expect(h.state()).toEqual(before); expect(h.execute).not.toHaveBeenCalled();
  });
  it("a changed workout invalidates the old parent operation", async () => {
    const h = harness(); h.interpret.mockResolvedValueOnce(envelope({ type: "REPLACE_EXERCISE", fromExerciseRef: "bench", toExerciseRef: "fly", scope: "SESSION_ONLY" })); await h.send("replace bench with fly"); h.context.workout!.version++;
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
    await h.send("bench"); expect(h.execute).not.toHaveBeenCalled();
    expect(h.state().stack.at(-1)).toMatchObject({ replacement: null });
    await h.send("fly"); await h.send("today");
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


describe("semantic conversation continuity", () => {
  it("answers a natural plan interruption then completes the retained replacement", async () => {
    const h = harness(); h.interpret.mockResolvedValueOnce(envelope({ type: "REPLACE_EXERCISE", fromExerciseRef: "bench", toExerciseRef: "fly", scope: "AMBIGUOUS" })); await h.send("bench is busy, could we switch to fly");
    h.interpret.mockResolvedValueOnce(envelope({ type: "QUERY_PLAN" }));
    expect(await h.send("what am I supposed to train according to my routine?")).toContain("Persisted Push");
    expect(h.state().stack.at(-1)?.kind).toBe("REPLACE"); expect(h.execute).not.toHaveBeenCalled();
    h.interpret.mockResolvedValueOnce(envelope({ type: "ANSWER_PENDING_QUESTION", answer: "today" }));
    await h.send("okay just this time"); expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "REPLACE_EXERCISE", scope: "SESSION_ONLY" }), expect.any(String));
  });
  it("a natural factual question is not consumed as a replacement exercise", async () => {
    const h = harness(); await h.send("replace bench"); h.interpret.mockResolvedValueOnce(envelope({ type: "QUERY_CURRENT_STATE" }));
    expect(await h.send("can you show me where I am in the workout")).toContain("Bench Press");
    expect(h.state().stack.at(-1)).toMatchObject({ kind: "REPLACE", replacement: null }); expect(h.execute).not.toHaveBeenCalled();
  });
  it("partial multi-set drafts persist across interrupts and new orchestrator instances", async () => {
    const h = harness(); h.interpret.mockResolvedValueOnce(envelope({ type: "DRAFT_SETS", loadValue: 45, count: 3, weightUnit: "KG" }));
    await h.send("3 sets at 45kg"); expect(h.state().stack.at(-1)?.kind).toBe("SET_DRAFT");
    await h.send("hi"); await h.send("show today"); await h.send("7 7 6");
    expect(h.log).toHaveBeenCalledWith("45 KG x 7, 45 KG x 7, 45 KG x 6"); expect(h.state().stack).toEqual([]);
  });
  it("rejects invented draft values before persisting a continuation", async () => {
    const h = harness(); h.interpret.mockResolvedValueOnce(envelope({ type: "DRAFT_SETS", loadValue: 99, count: 3 }));
    await h.send("3 sets at 45kg"); expect(h.state().stack).toEqual([]); expect(h.log).not.toHaveBeenCalled();
  });
  it("a semantic pending answer cannot approve custom identity confirmation", async () => {
    const h = harness(); h.context.confirmation = { id: "protected", actionType: "CREATE_CUSTOM_EXERCISE" };
    h.interpret.mockResolvedValueOnce(envelope({ type: "ANSWER_PENDING_QUESTION", answer: "yes" }));
    await h.send("sounds good add that one"); expect(h.ports.confirm).not.toHaveBeenCalled(); expect(h.execute).not.toHaveBeenCalled();
  });
  it("natural numeric words can correct but absent values cannot", async () => {
    const h = harness(); h.context.sets.push({ id: "last", exerciseId: "bench", index: 1, load: 45, unit: "KG", semantics: "TOTAL_LOAD", reps: 10 });
    h.interpret.mockResolvedValueOnce(envelope({ type: "CORRECT_SET", replacement: { reps: 7 } }));
    await h.send("nah last one was seven"); expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ replacement: { reps: 7 } }), "nah last one was seven");
  });
});

it("logs numeric data during a scope question without losing its still-valid parent", async () => {
  const h = harness(); h.interpret.mockResolvedValueOnce(envelope({ type: "REPLACE_EXERCISE", fromExerciseRef: "bench", toExerciseRef: "fly", scope: "AMBIGUOUS" })); await h.send("bench is busy, could we switch to fly");
  h.log.mockImplementationOnce(async () => { h.context.workout!.version++; return "Logged set"; });
  await h.send("45x7"); expect(h.state().stack.at(-1)?.kind).toBe("REPLACE");
  await h.send("today"); expect(h.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "REPLACE_EXERCISE", scope: "SESSION_ONLY" }), expect.any(String));
});

it("canonical scope replies resume a routine reorder as a session-only change", async () => {
  const h = harness(); h.context.workout!.templateId = "template";
  h.interpret.mockResolvedValueOnce(envelope({ type: "UPDATE_ROUTINE_REQUEST", scope: "PERMANENT_ROUTINE", requestedChange: { operation: "REORDER_EXERCISE", sessionRef: "current", exerciseRef: "Cable Fly", newOrderRef: "first" } }));
  await h.send("I always want fly before bench"); expect(h.state().stack.at(-1)?.kind).toBe("SCOPE");
  h.interpret.mockResolvedValueOnce(envelope({ type: "ANSWER_PENDING_QUESTION", answer: "SESSION_ONLY" }));
  await h.send("nah not forever just this once");
  expect(h.execute).toHaveBeenCalledWith({ type: "REORDER_EXERCISE", exerciseRef: "cable", ordinal: 1 }, "today");
});
it("semantic partial answers cannot invent numeric values from prior context", async () => {
  const h = harness(); await h.send("10 reps");
  h.interpret.mockResolvedValueOnce(envelope({ type: "ANSWER_PENDING_QUESTION", answer: "99" }));
  await h.send("you know what I mean"); expect(h.log).not.toHaveBeenCalled(); expect(h.state().stack.at(-1)?.kind).toBe("LOAD");
});

it("rep-count replies match in linear time (CodeQL ReDoS regression)", () => {
  for (const reply of ["10", "10 10 9", "10, 10, 9 reps", "10 , reps", "10 10,"]) expect(REPS_LIST.test(reply)).toBe(true);
  for (const reply of ["10reps", "reps", "10 x 9", " 10", "10 10 9 rep"]) expect(REPS_LIST.test(reply)).toBe(false);
  const started = performance.now();
  expect(REPS_LIST.test("9".repeat(50_000) + "x")).toBe(false);
  expect(performance.now() - started).toBeLessThan(250);
});

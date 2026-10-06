import { describe, expect, it } from "vitest";
import { AuthService, InboundMessageProcessor, LinkService, ProfileService, RoutineService } from "../../../packages/domain/src/index.js";
import { InMemoryStore } from "../../../packages/persistence/src/index.js";
import type { NormalizedWhatsAppMessage } from "../../../packages/contracts/src/index.js";

function message(id: string, text: string): NormalizedWhatsAppMessage {
  return {
    provider: "WHATSAPP_CLOUD_API",
    providerAccountId: "phone-1",
    providerMessageId: id,
    providerUserIdentityHash: "wa-user-1",
    text,
    rawPayloadHash: `hash-${id}`
  };
}

async function readyProcessor() {
  const store = new InMemoryStore();
  const auth = new AuthService(store);
  const profile = new ProfileService(store);
  const routines = new RoutineService(store);
  const links = new LinkService(store);
  const processor = new InboundMessageProcessor(store);
  const user = auth.signUp("slice@example.com", "correct horse battery staple").user;
  profile.setPreferredWeightUnit(user.id, "KG");
  routines.createRoutine(user.id, {
    name: "PPL",
    sessions: [
      {
        name: "Push",
        exercises: [{ exerciseName: "Bench", plannedSetCount: 3, repTargetMin: 8 }]
      }
    ]
  });
  const { token } = links.createToken(user.id);
  await processor.process(message("link-1", `link ${token}`));
  await processor.process(message("start-1", "start"));
  return { store, processor };
}

describe("core inbound idempotency", () => {
  it("does not duplicate execution for exact duplicate provider delivery", async () => {
    const { store, processor } = await readyProcessor();
    await processor.process(message("set-1", "45x10"));
    await processor.process(message("set-1", "45x10"));
    expect([...store.sets.values()]).toHaveLength(1);
  });

  it("handles in-flight, retryable failure, crash-after-command-before-outbound, and concurrency safely", async () => {
    const { store, processor } = await readyProcessor();
    await processor.process(message("inflight-1", "45x10"), { leaveInFlight: true });
    const inflight = await processor.process(message("inflight-1", "45x10"));
    expect(inflight.body).toBe("Processing");

    await processor.process(message("retry-1", "45x10"), { forceRetryableFailureBeforeCommand: true });
    await processor.process(message("retry-1", "45x10"));

    await processor.process(message("crash-1", "45x9"), { crashAfterCommandBeforeOutbound: true });
    const recovered = await processor.process(message("crash-1", "45x9"));
    expect(recovered.reused).toBe(true);

    await Promise.all([
      processor.process(message("concurrent-1", "45x8")),
      processor.process(message("concurrent-1", "45x8"))
    ]);

    const recorded = [...store.sets.values()];
    expect(recorded.map((set) => set.reps).sort((a, b) => b - a)).toEqual([10, 9, 8]);
    const sentBodies = [...store.outbounds.values()].map((outbound) => outbound.body);
    expect(sentBodies.filter((body) => body === "Logged 1 set")).toHaveLength(2);
    expect(sentBodies).toContain("Recovered previous result");
  });
});

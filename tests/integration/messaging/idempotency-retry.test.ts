import { describe, expect, it } from "vitest";
import { AuthService, InboundMessageProcessor, LinkService, ProfileService, RoutineService } from "../../../packages/domain/src/index.js";
import { InMemoryStore } from "../../../packages/persistence/src/index.js";

describe("broader message replay recovery (fast double)", () => {
  it("reuses durable command results, including retry after outbound receipt", async () => {
    const store = new InMemoryStore(), processor = new InboundMessageProcessor(store);
    const user = new AuthService(store).signUp("replay@example.com", "correct horse battery staple").user;
    new ProfileService(store).setPreferredWeightUnit(user.id, "KG");
    new RoutineService(store).createRoutine(user.id, { name: "Test", sessions: [{ name: "Upper", exercises: [{ exerciseName: "Bench", plannedSetCount: 3, repTargetMin: 8 }] }] });
    const message = (id: string, text: string) => ({ provider: "WHATSAPP_CLOUD_API" as const, providerAccountId: "account", providerMessageId: id, providerUserIdentityHash: "identity", rawPayloadHash: id, text });
    await processor.process(message("link", `link ${new LinkService(store).createToken(user.id).token}`));
    await processor.process(message("start", "start"));
    await processor.process(message("crash", "45x10"), { crashAfterCommandBeforeOutbound: true });
    await processor.process(message("crash", "45x10"));
    const outbounds = store.outbounds.size;
    for (let n = 0; n < 4; n++) expect((await processor.process(message("crash", "45x10"))).reused).toBe(true);
    expect(store.outbounds.size).toBe(outbounds); expect(store.sets.size).toBe(1);
  });
});

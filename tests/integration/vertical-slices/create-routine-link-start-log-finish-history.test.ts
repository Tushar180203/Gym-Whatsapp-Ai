import { describe, expect, it } from "vitest";
import {
  AuthService,
  InboundMessageProcessor,
  LinkService,
  ProfileService,
  RoutineService,
  WorkoutService
} from "../../../packages/domain/src/index.js";
import { InMemoryStore } from "../../../packages/persistence/src/index.js";
import { WhatsAppInboundAdapter, type WhatsAppFixturePayload } from "../../../packages/messaging/src/index.js";

function rawWhatsApp(id: string, text: string): string {
  const payload: WhatsAppFixturePayload = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "business-1",
        changes: [
          {
            value: {
              metadata: { phone_number_id: "phone-1" },
              messages: [{ id, from: "15555550123", text: { body: text } }]
            }
          }
        ]
      }
    ]
  };
  return JSON.stringify(payload);
}

describe("first deterministic vertical slice", () => {
  it("creates user, links WhatsApp identity, logs deterministic sets, finishes, and reads history", async () => {
    const store = new InMemoryStore();
    const auth = new AuthService(store);
    const profiles = new ProfileService(store);
    const routines = new RoutineService(store);
    const links = new LinkService(store);
    const processor = new InboundMessageProcessor(store);
    const workouts = new WorkoutService(store);
    const adapter = new WhatsAppInboundAdapter("secret");

    const { user, sessionToken } = auth.signUp("pilot@example.com", "correct horse battery staple");
    expect(auth.currentUser(sessionToken).id).toBe(user.id);
    profiles.setPreferredWeightUnit(user.id, "KG");
    routines.createRoutine(user.id, {
      name: "Upper Lower",
      sessions: [
        {
          name: "Upper",
          exercises: [
            {
              exerciseName: "Incline Dumbbell Press",
              plannedSetCount: 3,
              repTargetMin: 8,
              repTargetMax: 10,
              defaultLoadSemantics: "PER_HAND_PER_SIDE"
            }
          ]
        },
        {
          name: "Lower",
          exercises: [{ exerciseName: "Squat", plannedSetCount: 3, repTargetMin: 5 }]
        }
      ]
    });

    const { token } = links.createToken(user.id);
    for (const [id, text] of [
      ["wa-link", `link ${token}`],
      ["wa-start", "start"],
      ["wa-set-1", "45 each 10"],
      ["wa-set-2", "same x 9"],
      ["wa-set-3", "45 kg x 8"],
      ["wa-finish", "finish workout"]
    ] as const) {
      const raw = rawWhatsApp(id, text);
      const [message] = adapter.normalize(raw, adapter.sign(raw));
      if (!message) throw new Error("fixture did not produce a message");
      await processor.process(message);
    }

    const history = workouts.workoutHistory(user.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.workout.status).toBe("COMPLETED");
    expect(history[0]?.sets).toHaveLength(3);
    expect(history[0]?.sets.map((set) => [set.loadValue, set.weightUnit, set.loadSemantics, set.reps])).toEqual([
      [45, "KG", "PER_HAND_PER_SIDE", 10],
      [45, "KG", "PER_HAND_PER_SIDE", 9],
      [45, "KG", "PER_HAND_PER_SIDE", 8]
    ]);

    const cursor = [...store.cursors.values()][0];
    const nextTemplate = store.templates.get(cursor?.nextSessionTemplateId ?? "");
    expect(nextTemplate?.name).toBe("Lower");
  });
});

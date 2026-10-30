import { describe, expect, it } from "vitest";
import { portableExport } from "./export-service.js";
describe("portable owner export", () => {
  it("allowlists portable fields and excludes foreign rows and operational credentials", () => {
    const result = portableExport("a", { profile: [{ user_id: "a", preferred_weight_unit: "LB", password_hash: "secret", token_hash: "secret" }, { user_id: "b", preferred_weight_unit: "KG" }],
      sets: [{ user_id: "a", id: "set", load_value: "45", reps: 10, weight_unit: "LB", load_semantics: "PER_HAND_PER_SIDE", idempotency_key: "secret", source_message_id: "secret" }] });
    expect(result.profile).toEqual([{ preferred_weight_unit: "LB" }]);
    expect(result.sets[0]).toMatchObject({ id: "set", load_value: "45", reps: 10 });
    expect(JSON.stringify(result)).not.toContain("secret"); expect(JSON.stringify(result)).not.toContain("KG");
  });
  it("includes only explicitly referenced shared definitions and owned custom definitions", () => {
    expect(portableExport("a", { exercises: [{ id: "shared", owner_user_id: null, display_name: "Press" }, { id: "own", owner_user_id: "a" }, { id: "foreign", owner_user_id: "b" }] }).exercises.map(row => row.id)).toEqual(["shared", "own"]);
  });
  it("does not expose internal credentials inside nested snapshots", () => {
    const result = portableExport("a", { workouts: [{ user_id: "a", template_snapshot: { name: "Push", token_hash: "secret", exercise: { display_name: "Press", apiKey: "secret" } } }] });
    expect(result.workouts[0]?.template_snapshot).toEqual({ name: "Push", exercise: { display_name: "Press" } });
  });
});

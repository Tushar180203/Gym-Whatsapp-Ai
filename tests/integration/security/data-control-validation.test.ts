import { describe, expect, it } from "vitest";
import { confirmDeletionSchema, deleteRequestSchema, exportRequestSchema } from "../../../packages/persistence/src/data-controls.js";
describe("web data control contracts cannot grant owner or destructive authority", () => {
  it("rejects foreign owner fields rather than trusting client user IDs", () => {
    expect(() => deleteRequestSchema.parse({ type: "DELETE_ACCOUNT", idempotencyKey: "request", userId: "other" })).toThrow();
    expect(() => exportRequestSchema.parse({ idempotencyKey: "request", userId: "other" })).toThrow();
  });
  it("requires an explicit true confirmation and no AI/confidence bypass fields", () => {
    for (const input of [{}, { confirm: false }, { confirm: true, confidence: "high" }]) expect(() => confirmDeletionSchema.parse(input)).toThrow();
    expect(confirmDeletionSchema.parse({ confirm: true })).toEqual({ confirm: true });
  });
});

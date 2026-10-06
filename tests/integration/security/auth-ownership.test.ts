import { describe, expect, it } from "vitest";
import { AuthService, ProfileService, requireOwner } from "../../../packages/domain/src/index.js";
import { InMemoryStore } from "../../../packages/persistence/src/index.js";

describe("auth and ownership", () => {
  it("creates secure sessions, resolves context, logs out, and blocks cross-user ownership", () => {
    const store = new InMemoryStore();
    const auth = new AuthService(store);
    const profile = new ProfileService(store);

    const userA = auth.signUp("a@example.com", "correct horse battery staple");
    const userB = auth.signUp("b@example.com", "another correct battery staple");

    expect(auth.currentUser(userA.sessionToken).id).toBe(userA.user.id);
    profile.setPreferredWeightUnit(userA.user.id, "KG");
    expect(() => requireOwner(userA.user, userB.user.id)).toThrow(/Forbidden/);

    auth.logout(userA.sessionToken);
    expect(() => auth.currentUser(userA.sessionToken)).toThrow(/Unauthenticated/);
  });
});

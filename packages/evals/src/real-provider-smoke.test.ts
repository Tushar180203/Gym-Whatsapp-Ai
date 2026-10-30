import { describe, expect, it } from "vitest";
import { runRealProviderSmoke } from "./real-provider-smoke.js";

describe("real provider smoke eval", () => {
  it("is opt-in and skipped by default", async () => {
    if (process.env.RUN_REAL_PROVIDER_EVAL !== "1") {
      await expect(runRealProviderSmoke()).resolves.toBeUndefined();
      return;
    }
    await expect(runRealProviderSmoke()).resolves.toBeUndefined();
  });
});

import { expect, it } from "vitest";
import { deletionNeedsConfirmation } from "../corrections/delete-command.js";
it("only a safely resolved active last set bypasses deletion confirmation", () => {
  expect(deletionNeedsConfirmation({ kind: "SET", isLastActiveSet: true })).toBe(false);
  for (const kind of ["SET", "EXERCISE", "WORKOUT", "HISTORY", "IDENTITY_MERGE"] as const) expect(deletionNeedsConfirmation({ kind })).toBe(true);
});

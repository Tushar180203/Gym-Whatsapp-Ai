export function deletionNeedsConfirmation(input: { kind: "SET" | "EXERCISE" | "WORKOUT" | "HISTORY" | "IDENTITY_MERGE"; isLastActiveSet?: boolean }): boolean {
  return !(input.kind === "SET" && input.isLastActiveSet === true);
}

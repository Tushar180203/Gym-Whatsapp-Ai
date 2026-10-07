export type DeletionType = "DELETE_ACCOUNT" | "DELETE_WORKOUT_DATA";
export type DataRequestStatus = "AWAITING_CONFIRMATION" | "COMPLETED" | "EXPIRED" | "STALE" | "REVOKED";
export function deletionDecision(request: { userId: string; status: string; expiresAt: Date; targetDigest: string }, userId: string, confirmed: boolean, digest: string, now: Date) {
  if (request.userId !== userId) return "NOT_FOUND";
  if (request.status === "COMPLETED") return "REUSE";
  if (request.status !== "AWAITING_CONFIRMATION") return request.status;
  if (!confirmed) return "CONFIRMATION_REQUIRED";
  if (request.expiresAt <= now) return "EXPIRED";
  return request.targetDigest === digest ? "APPLY" : "STALE";
}

import { evaluateConfirmationPolicy, parseProposedActionEnvelope, type ProposedActionEnvelope } from "../../contracts/src/index.js";

export type ActionBoundary = {
  authorize(envelope: ProposedActionEnvelope): Promise<void>;
  validateDomain(envelope: ProposedActionEnvelope): Promise<void>;
  executeIdempotently(envelope: ProposedActionEnvelope): Promise<string>;
};

export type ActionBoundaryResult =
  | { status: "CLARIFICATION_REQUIRED"; question: string }
  | { status: "CONFIRMATION_REQUIRED" }
  | { status: "EXECUTED"; body: string };

// No interpreter receives these capabilities; trusted application code supplies them.
export async function guardProposedAction(
  proposal: unknown,
  boundary: ActionBoundary
): Promise<ActionBoundaryResult> {
  const envelope = parseProposedActionEnvelope(proposal);
  await boundary.authorize(envelope);
  await boundary.validateDomain(envelope);
  const policy = evaluateConfirmationPolicy(envelope);
  if (policy.clarificationRequired) {
    return { status: "CLARIFICATION_REQUIRED", question: envelope.clarificationQuestion ?? "Please clarify the requested change." };
  }
  if (policy.confirmationRequired) return { status: "CONFIRMATION_REQUIRED" };
  return { status: "EXECUTED", body: await boundary.executeIdempotently(envelope) };
}

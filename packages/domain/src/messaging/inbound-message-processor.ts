import type { NormalizedWhatsAppMessage } from "../../../contracts/src/index.js";
import {
  DomainError,
  InMemoryStore,
  sha256,
  type InboundMessage,
  type OutboundMessage
} from "../../../persistence/src/index.js";
import { LinkService } from "./link-service.js";
import { WorkoutService } from "../workouts/workout-service.js";

export type ProcessOptions = {
  crashAfterCommandBeforeOutbound?: boolean;
  forceRetryableFailureBeforeCommand?: boolean;
  leaveInFlight?: boolean;
};

export type ProcessResult = {
  inbound: InboundMessage;
  outbound?: OutboundMessage;
  body: string;
  reused: boolean;
};

export class InboundMessageProcessor {
  private readonly linkService: LinkService;
  private readonly workoutService: WorkoutService;

  constructor(private readonly store: InMemoryStore) {
    this.linkService = new LinkService(store);
    this.workoutService = new WorkoutService(store);
  }

  async process(message: NormalizedWhatsAppMessage, options: ProcessOptions = {}): Promise<ProcessResult> {
    const inbound = this.store.createInbound(message);
    const duplicate = inbound.processingStatus !== "RECEIVED";

    if (inbound.processingStatus === "COMPLETED") {
      const existingOutbound = inbound.outboundMessageId
        ? this.store.outbounds.get(inbound.outboundMessageId)
        : undefined;
      if (existingOutbound) {
        return { inbound, outbound: existingOutbound, body: existingOutbound.body, reused: true };
      }
      const recovered = this.persistOutbound(inbound, inbound.userId, "Recovered previous result");
      return { inbound, outbound: recovered, body: recovered.body, reused: true };
    }

    if (inbound.processingStatus === "PROCESSING") {
      return { inbound, body: "Processing", reused: true };
    }

    if (options.forceRetryableFailureBeforeCommand) {
      inbound.processingStatus = "FAILED_RETRYABLE";
      inbound.errorCategory = "forced_retryable";
      return { inbound, body: "Retry later", reused: false };
    }

    inbound.processingStatus = "PROCESSING";
    if (options.leaveInFlight) {
      return { inbound, body: "Processing", reused: duplicate };
    }

    try {
      const userId = await this.resolveOrLinkUser(inbound);
      inbound.userId = userId;
      const body = await this.applyCommand(inbound, userId);
      inbound.processingStatus = "COMPLETED";
      inbound.processedAt = this.store.now();
      if (options.crashAfterCommandBeforeOutbound) {
        return { inbound, body, reused: false };
      }
      const outbound = this.persistOutbound(inbound, userId, body);
      return { inbound, outbound, body, reused: duplicate };
    } catch (error) {
      inbound.errorCategory = error instanceof DomainError ? error.code : "unknown";
      inbound.processingStatus =
        error instanceof DomainError && error.code === "NO_SET_NOTATION"
          ? "FAILED_FINAL"
          : "FAILED_RETRYABLE";
      throw error;
    }
  }

  private async resolveOrLinkUser(inbound: InboundMessage): Promise<string> {
    const linkedUserId = this.linkService.linkedUserId(
      inbound.providerAccountId,
      inbound.providerUserIdentityHash
    );
    if (linkedUserId) return linkedUserId;

    const token = parseLinkToken(inbound.text);
    if (!token) throw new DomainError("Unlinked WhatsApp identity", "UNLINKED_IDENTITY");
    const link = this.linkService.consumeInboundToken({
      token,
      providerAccountId: inbound.providerAccountId,
      providerUserIdentityHash: inbound.providerUserIdentityHash
    });
    return link.userId;
  }

  private async applyCommand(inbound: InboundMessage, userId: string): Promise<string> {
    const text = inbound.text.trim().toLowerCase();
    if (parseLinkToken(inbound.text)) {
      return "WhatsApp linked";
    }
    if (["start", "let's start", "gym time", "start workout"].includes(text)) {
      const workout = await this.workoutService.startNextWorkout(userId);
      return `Started ${workout.name}`;
    }
    if (["finish", "finish workout", "done"].includes(text)) {
      const workout = await this.workoutService.finishWorkout(userId, "COMPLETE");
      return `Finished ${workout.name}`;
    }

    const sets = await this.workoutService.logSetMessage({
      userId,
      messageText: inbound.text,
      idempotencyKey: `${inbound.id}:log`,
      sourceMessageId: inbound.id
    });
    return `Logged ${sets.length} set${sets.length === 1 ? "" : "s"}`;
  }

  private persistOutbound(inbound: InboundMessage, userId: string | null, body: string): OutboundMessage {
    if (!userId) throw new DomainError("Cannot send outbound without user", "MISSING_USER");
    if (inbound.outboundMessageId) {
      const existing = this.store.outbounds.get(inbound.outboundMessageId);
      if (existing) return existing;
    }
    const outbound: OutboundMessage = {
      id: this.store.nextId("outbound"),
      userId,
      inboundMessageId: inbound.id,
      providerAccountId: inbound.providerAccountId,
      providerUserIdentityHash: inbound.providerUserIdentityHash,
      bodyHash: sha256(body),
      body,
      status: "SENT",
      sentAt: this.store.now()
    };
    this.store.outbounds.set(outbound.id, outbound);
    inbound.outboundMessageId = outbound.id;
    return outbound;
  }
}

function parseLinkToken(text: string): string | null {
  const match = text.match(/(?:^|\s)link\s+([A-Za-z0-9_-]+)/i);
  return match?.[1] ?? null;
}

import { createHash, randomUUID } from "node:crypto";
import type { NormalizedWhatsAppMessage } from "../../contracts/src/index.js";
import type {
  AccountLinkToken,
  AuthSession,
  CommandExecution,
  ExerciseIdentity,
  InboundMessage,
  OutboundMessage,
  PlannedExercise,
  Routine,
  RoutineSequenceCursor,
  SessionExercise,
  User,
  UserProfile,
  WhatsAppIdentityLink,
  WhatsAppProviderAccount,
  WhatsAppProviderUserIdentity,
  WorkoutSession,
  WorkoutSessionTemplate,
  WorkoutSet
} from "./types.js";

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type UserLock = Promise<void>;

export class InMemoryStore {
  users = new Map<string, User>();
  profiles = new Map<string, UserProfile>();
  sessions = new Map<string, AuthSession>();
  providerAccounts = new Map<string, WhatsAppProviderAccount>();
  providerIdentities = new Map<string, WhatsAppProviderUserIdentity>();
  links = new Map<string, WhatsAppIdentityLink>();
  linkTokens = new Map<string, AccountLinkToken>();
  exercises = new Map<string, ExerciseIdentity>();
  routines = new Map<string, Routine>();
  templates = new Map<string, WorkoutSessionTemplate>();
  plannedExercises = new Map<string, PlannedExercise>();
  cursors = new Map<string, RoutineSequenceCursor>();
  workouts = new Map<string, WorkoutSession>();
  sessionExercises = new Map<string, SessionExercise>();
  sets = new Map<string, WorkoutSet>();
  inboundMessages = new Map<string, InboundMessage>();
  commands = new Map<string, CommandExecution>();
  outbounds = new Map<string, OutboundMessage>();
  private userLocks = new Map<string, UserLock>();

  nextId(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }

  now(): Date {
    return new Date();
  }

  async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.userLocks.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.userLocks.set(userId, previous.then(() => current));
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.userLocks.get(userId) === current) {
        this.userLocks.delete(userId);
      }
    }
  }

  findUserByEmail(email: string): User | undefined {
    return [...this.users.values()].find(
      (user) => user.email.toLowerCase() === email.toLowerCase() && !user.deletedAt
    );
  }

  findSessionByTokenHash(tokenHash: string): AuthSession | undefined {
    return [...this.sessions.values()].find(
      (session) =>
        session.tokenHash === tokenHash &&
        !session.invalidatedAt &&
        session.expiresAt.getTime() > Date.now()
    );
  }

  getProfileByUserId(userId: string): UserProfile | undefined {
    return [...this.profiles.values()].find((profile) => profile.userId === userId);
  }

  getOrCreateProviderAccount(providerAccountId: string): WhatsAppProviderAccount {
    const existing = [...this.providerAccounts.values()].find(
      (account) =>
        account.provider === "WHATSAPP_CLOUD_API" &&
        account.providerAccountId === providerAccountId
    );
    if (existing) return existing;
    const account: WhatsAppProviderAccount = {
      id: this.nextId("wap"),
      provider: "WHATSAPP_CLOUD_API",
      providerAccountId
    };
    this.providerAccounts.set(account.id, account);
    return account;
  }

  getOrCreateProviderIdentity(
    providerAccountId: string,
    providerUserIdentityHash: string
  ): WhatsAppProviderUserIdentity {
    const account = this.getOrCreateProviderAccount(providerAccountId);
    const existing = [...this.providerIdentities.values()].find(
      (identity) =>
        identity.whatsAppProviderAccountId === account.id &&
        identity.providerUserIdentityHash === providerUserIdentityHash
    );
    if (existing) return existing;
    const identity: WhatsAppProviderUserIdentity = {
      id: this.nextId("wpi"),
      whatsAppProviderAccountId: account.id,
      providerUserIdentityHash,
      createdAt: this.now()
    };
    this.providerIdentities.set(identity.id, identity);
    return identity;
  }

  activeLinkForIdentity(identityId: string): WhatsAppIdentityLink | undefined {
    return [...this.links.values()].find(
      (link) => link.whatsAppProviderUserIdentityId === identityId && !link.revokedAt
    );
  }

  activeWorkoutForUser(userId: string): WorkoutSession | undefined {
    return [...this.workouts.values()].find(
      (workout) =>
        workout.userId === userId &&
        ["PROPOSED", "ACTIVE", "PAUSED"].includes(workout.status)
    );
  }

  ensureNoActiveWorkout(userId: string): void {
    if (this.activeWorkoutForUser(userId)) {
      throw new DomainError("User already has an active workout", "ACTIVE_WORKOUT_EXISTS");
    }
  }

  createInbound(message: NormalizedWhatsAppMessage): InboundMessage {
    const key = `${message.providerAccountId}:${message.providerMessageId}`;
    const existing = this.inboundMessages.get(key);
    if (existing) return existing;
    const inbound: InboundMessage = {
      id: this.nextId("inbound"),
      provider: "WHATSAPP_CLOUD_API",
      providerAccountId: message.providerAccountId,
      providerMessageId: message.providerMessageId,
      providerUserIdentityHash: message.providerUserIdentityHash,
      userId: null,
      text: message.text,
      rawPayloadHash: message.rawPayloadHash,
      processingStatus: "RECEIVED",
      commandExecutionId: null,
      outboundMessageId: null,
      processedAt: null,
      errorCategory: null
    };
    this.inboundMessages.set(key, inbound);
    return inbound;
  }

  inboundKey(message: Pick<InboundMessage, "providerAccountId" | "providerMessageId">): string {
    return `${message.providerAccountId}:${message.providerMessageId}`;
  }

  findCommand(userId: string, idempotencyKey: string): CommandExecution | undefined {
    return [...this.commands.values()].find(
      (command) => command.userId === userId && command.idempotencyKey === idempotencyKey
    );
  }

  createCommand(userId: string, commandType: string, idempotencyKey: string): CommandExecution {
    const existing = this.findCommand(userId, idempotencyKey);
    if (existing) return existing;
    const command: CommandExecution = {
      id: this.nextId("cmd"),
      userId,
      commandType,
      idempotencyKey,
      status: "PROCESSING",
      resultSummary: null,
      appliedAt: null
    };
    this.commands.set(command.id, command);
    return command;
  }
}

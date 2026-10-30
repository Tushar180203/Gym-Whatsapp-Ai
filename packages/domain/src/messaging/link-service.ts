import { randomBytes } from "node:crypto";
import { DomainError, InMemoryStore, sha256 } from "../../../persistence/src/index.js";
import type { AccountLinkToken, WhatsAppIdentityLink } from "../../../persistence/src/index.js";

export class LinkService {
  constructor(private readonly store: InMemoryStore) {}

  createToken(userId: string, ttlMs = 1000 * 60 * 10): { token: string; record: AccountLinkToken } {
    const token = randomBytes(18).toString("base64url");
    const record: AccountLinkToken = {
      id: this.store.nextId("linktoken"),
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + ttlMs),
      consumedAt: null,
      createdAt: this.store.now()
    };
    this.store.linkTokens.set(record.id, record);
    return { token, record };
  }

  consumeInboundToken(params: {
    token: string;
    providerAccountId: string;
    providerUserIdentityHash: string;
  }): WhatsAppIdentityLink {
    const tokenHash = sha256(params.token);
    const tokenRecord = [...this.store.linkTokens.values()].find(
      (candidate) => candidate.tokenHash === tokenHash
    );
    if (!tokenRecord) throw new DomainError("Invalid link token", "INVALID_LINK_TOKEN");
    if (tokenRecord.consumedAt) throw new DomainError("Link token already used", "TOKEN_USED");
    if (tokenRecord.expiresAt.getTime() <= Date.now()) {
      throw new DomainError("Link token expired", "TOKEN_EXPIRED");
    }
    const user = this.store.users.get(tokenRecord.userId);
    if (!user || user.deletedAt) throw new DomainError("Cannot link deleted user", "DELETED_USER");

    const identity = this.store.getOrCreateProviderIdentity(
      params.providerAccountId,
      params.providerUserIdentityHash
    );
    const existing = this.store.activeLinkForIdentity(identity.id);
    if (existing && existing.userId !== tokenRecord.userId) {
      throw new DomainError("WhatsApp identity already linked", "IDENTITY_ALREADY_LINKED");
    }
    if (existing) {
      tokenRecord.consumedAt = this.store.now();
      return existing;
    }

    const link: WhatsAppIdentityLink = {
      id: this.store.nextId("walink"),
      userId: tokenRecord.userId,
      whatsAppProviderUserIdentityId: identity.id,
      linkedAt: this.store.now(),
      revokedAt: null
    };
    this.store.links.set(link.id, link);
    tokenRecord.consumedAt = this.store.now();
    return link;
  }

  linkedUserId(providerAccountId: string, providerUserIdentityHash: string): string | null {
    const account = [...this.store.providerAccounts.values()].find(
      (candidate) => candidate.providerAccountId === providerAccountId
    );
    if (!account) return null;
    const identity = [...this.store.providerIdentities.values()].find(
      (candidate) =>
        candidate.whatsAppProviderAccountId === account.id &&
        candidate.providerUserIdentityHash === providerUserIdentityHash
    );
    if (!identity) return null;
    return this.store.activeLinkForIdentity(identity.id)?.userId ?? null;
  }
}

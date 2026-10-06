import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DomainError, InMemoryStore, sha256 } from "../../../persistence/src/index.js";
import type { User } from "../../../persistence/src/index.js";

export type AuthResult = {
  user: User;
  sessionToken: string;
};

export class AuthService {
  constructor(private readonly store: InMemoryStore) {}

  signUp(email: string, password: string): AuthResult {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      throw new DomainError("Invalid email", "INVALID_EMAIL");
    }
    if (password.length < 12) {
      throw new DomainError("Password must be at least 12 characters", "WEAK_PASSWORD");
    }
    if (this.store.findUserByEmail(normalizedEmail)) {
      throw new DomainError("Email already exists", "EMAIL_EXISTS");
    }

    const user: User = {
      id: this.store.nextId("user"),
      email: normalizedEmail,
      passwordHash: hashPassword(password),
      deletedAt: null,
      createdAt: this.store.now()
    };
    this.store.users.set(user.id, user);

    const sessionToken = randomToken();
    const sessionId = this.store.nextId("session");
    this.store.sessions.set(sessionId, {
      id: sessionId,
      userId: user.id,
      tokenHash: sha256(sessionToken),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      invalidatedAt: null,
      createdAt: this.store.now()
    });
    return { user, sessionToken };
  }

  authenticate(email: string, password: string): AuthResult {
    const user = this.store.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new DomainError("Invalid credentials", "INVALID_CREDENTIALS");
    }
    const sessionToken = randomToken();
    const sessionId = this.store.nextId("session");
    this.store.sessions.set(sessionId, {
      id: sessionId,
      userId: user.id,
      tokenHash: sha256(sessionToken),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      invalidatedAt: null,
      createdAt: this.store.now()
    });
    return { user, sessionToken };
  }

  currentUser(sessionToken: string): User {
    const session = this.store.findSessionByTokenHash(sha256(sessionToken));
    if (!session) throw new DomainError("Unauthenticated", "UNAUTHENTICATED");
    const user = this.store.users.get(session.userId);
    if (!user || user.deletedAt) throw new DomainError("Unauthenticated", "UNAUTHENTICATED");
    return user;
  }

  logout(sessionToken: string): void {
    const session = this.store.findSessionByTokenHash(sha256(sessionToken));
    if (session) {
      session.invalidatedAt = this.store.now();
    }
  }
}

export function requireOwner(user: User, ownerUserId: string): void {
  if (user.deletedAt) throw new DomainError("Deleted user blocked", "DELETED_USER");
  if (user.id !== ownerUserId) throw new DomainError("Forbidden", "FORBIDDEN");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

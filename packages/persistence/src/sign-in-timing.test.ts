import { afterEach, describe, expect, it, vi } from "vitest";

const scrypt = vi.hoisted(() => ({ calls: 0 }));
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scryptSync: (...args: Parameters<typeof actual.scryptSync>) => { scrypt.calls++; return actual.scryptSync(...args); } };
});

const { PostgresVerticalSliceApp } = await import("./postgres.js");
const { randomBytes, scryptSync } = await import("node:crypto");

function storedHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

describe("sign-in timing", () => {
  const app = new PostgresVerticalSliceApp({ connectionString: "postgresql://unused@127.0.0.1:1/unused" });
  afterEach(() => vi.restoreAllMocks());

  it("costs exactly one scrypt for unknown and known emails, so timing does not reveal accounts", async () => {
    vi.spyOn(app.pool, "query").mockResolvedValueOnce({ rows: [] } as never);
    scrypt.calls = 0;
    await expect(app.signIn("nobody@example.com", "correct horse battery staple")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const unknownCalls = scrypt.calls;

    vi.spyOn(app.pool, "query").mockResolvedValueOnce({ rows: [{ id: "user_1", password_hash: storedHash("a different password") }] } as never);
    scrypt.calls = 0;
    await expect(app.signIn("owner@example.com", "correct horse battery staple")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    expect(unknownCalls).toBe(1);
    expect(scrypt.calls).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { equalIdentityHash, hashChallenge, newChallenge, normalizeWhatsAppNumber, parseLinkCommand, verificationDeepLink, linkRequestSchema } from "./link-challenge.js";
describe("number-bound WhatsApp challenges", () => {
  it("normalizes without guessing country, masks, and matches provider digits", () => {
    const number = normalizeWhatsAppNumber("+91 96857 19847");
    expect(number.identityHash).toBe(hashChallenge("919685719847")); expect(number.maskedNumber).toBe("+91 ******9847");
    expect(equalIdentityHash(number.identityHash, hashChallenge("919685719847"))).toBe(true);
    expect(equalIdentityHash(number.identityHash, hashChallenge("15551234567"))).toBe(false);
    expect(equalIdentityHash("bad", "bad")).toBe(false);
  });
  it.each(["9685719847", "+1", "+999 1234567890", "+91 9685719847 ext 3", "alice", "+000123456789"])("rejects invalid/ambiguous %s", value => expect(() => normalizeWhatsAppNumber(value)).toThrow());
  it("requires explicit consent and rejects owner fields", () => {
    expect(linkRequestSchema.safeParse({ phoneNumber: "+919685719847", consent: false }).success).toBe(false);
    expect(linkRequestSchema.safeParse({ phoneNumber: "+919685719847", consent: true, userId: "foreign" }).success).toBe(false);
  });
  it("uses random 128-bit codes, hashes them, and parses only deterministic LINK", () => {
    const code = newChallenge(); expect(code).toMatch(/^[A-F0-9]{32}$/); expect(newChallenge()).not.toBe(code);
    expect(hashChallenge(code)).not.toContain(code); expect(parseLinkCommand(`link ${code.toLowerCase()}`)).toEqual({ code });
    expect(parseLinkCommand("LINK invalid")).toEqual({ code: null }); expect(parseLinkCommand(`please LINK ${code}`)).toBeNull();
    expect(verificationDeepLink("+15551234567", code)).toBe(`https://wa.me/15551234567?text=LINK%20${code}`);
  });
});

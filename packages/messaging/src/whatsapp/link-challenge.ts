import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { z } from "zod";

export function normalizeWhatsAppNumber(input: string) {
  if (!/^\+[0-9 ()-]+$/.test(input.trim())) throw new Error("Use an international number with country code.");
  const number = parsePhoneNumberFromString(input.trim());
  if (!number || !number.isPossible() || number.ext) throw new Error("Invalid international number.");
  const address = number.number.slice(1);
  return { identityHash: hashChallenge(address), maskedNumber: `+${number.countryCallingCode} ******${address.slice(-4)}`, address };
}
export const linkRequestSchema = z.object({
  phoneNumber: z.string().max(64).transform((value, context) => {
    try { const { identityHash, maskedNumber } = normalizeWhatsAppNumber(value); return { identityHash, maskedNumber }; }
    catch { context.addIssue({ code: "custom", message: "Use a valid international WhatsApp number including + and country code." }); return z.NEVER; }
  }),
  consent: z.literal(true),
  change: z.boolean().default(false)
}).strict();
export function hashChallenge(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function newChallenge() { return randomBytes(16).toString("hex").toUpperCase(); }
export function parseLinkCommand(text: string): { code: string | null } | null {
  if (!/^link(?:\s|$)/i.test(text.trim())) return null;
  const match = /^link\s+([a-f0-9]{32})$/i.exec(text.trim());
  return { code: match?.[1]?.toUpperCase() ?? null };
}
export function equalIdentityHash(left: string, right: string) {
  return /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right) && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
export function verificationDeepLink(businessNumber: string | undefined, code: string) {
  const { address } = normalizeWhatsAppNumber(businessNumber ?? "");
  return `https://wa.me/${address}?text=${encodeURIComponent(`LINK ${code}`)}`;
}

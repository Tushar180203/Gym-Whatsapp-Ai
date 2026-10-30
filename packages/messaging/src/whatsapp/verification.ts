import { timingSafeEqual } from "node:crypto";

export function verifyChallenge(url: string, token: string | undefined): Response {
  if (!token) return new Response("Webhook verification unavailable", { status: 503 });
  const query = new URL(url).searchParams;
  if (["hub.mode", "hub.verify_token", "hub.challenge"].some(key => query.getAll(key).length !== 1)) return new Response("Invalid verification request", { status: 400 });
  const supplied = Buffer.from(query.get("hub.verify_token")!);
  const expected = Buffer.from(token);
  if (query.get("hub.mode") !== "subscribe" || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return new Response("Verification rejected", { status: 403 });
  const challenge = query.get("hub.challenge")!;
  if (!/^\d{1,128}$/.test(challenge)) return new Response("Invalid challenge", { status: 400 });
  return new Response(challenge, { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}

export type ConversationTurn = { role: "user" | "assistant"; content: string; occurredAt: string };
export function memoryText(text: string): string | null {
  // Verification and credential-bearing messages never become conversational memory.
  if (/\bLINK\s+\S+|\b(?:api[_ -]?key|password|secret|access[_ -]?token|authorization|bearer)\b\s*[:= ]/i.test(text)) return null;
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\(?\d[\d ()-]{7,}\d/g, match => isPhoneLike(match) ? "[phone]" : match).slice(0, 1000);
}

// "+"-prefixed numbers are always phones. Without "+", require 10+ digits in groups of 3+
// (a short leading country code is allowed) so set logs like "10 10 10 10" stay readable.
function isPhoneLike(match: string): boolean {
  const groups = match.split(/\D+/).filter(Boolean);
  const digits = groups.join("").length;
  if (match.startsWith("+")) return digits >= 8;
  return digits >= 10 && groups.every((group, index) => group.length >= 3 || (index === 0 && groups.length > 1));
}

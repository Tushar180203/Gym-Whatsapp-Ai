export type ConversationTurn = { role: "user" | "assistant"; content: string; occurredAt: string };
export function memoryText(text: string): string | null {
  // Verification and credential-bearing messages never become conversational memory.
  if (/\bLINK\s+\S+|\b(?:api[_ -]?key|password|secret|access[_ -]?token|authorization|bearer)\b\s*[:= ]/i.test(text)) return null;
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+\d[\d ()-]{7,}\d/g, "[phone]").slice(0, 1000);
}

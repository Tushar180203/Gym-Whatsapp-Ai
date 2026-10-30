import type { ProposedAction } from "../../../contracts/src/ai/actions.js";
import { localDate } from "../time/local-calendar.js";
export function parseRecallIntent(text: string, now: Date, timeZone: string): Extract<ProposedAction, { type: "QUERY_CONVERSATION" }> | undefined {
  if (!/\b(?:what|recall|remember|repeat|show)\b/i.test(text) || !/\b(?:said|say|told|tell|discussed|discuss|talked|chat|chats|conversation|asked|ask)\b/i.test(text)) return;
  const today = localDate(now, timeZone);
  let onDate: string | undefined;
  if (/\byesterday\b/i.test(text)) { const day = new Date(`${today}T12:00:00Z`); day.setUTCDate(day.getUTCDate() - 1); onDate = day.toISOString().slice(0, 10); }
  else if (/\b(?:today|this morning|this afternoon|this evening)\b/i.test(text)) onDate = today;
  const period = /\bmorning\b/i.test(text) ? "MORNING" : /\bafternoon\b/i.test(text) ? "AFTERNOON" : /\bevening\b/i.test(text) ? "EVENING" : undefined;
  // Leave subjects and dates beyond these exact forms to semantic interpretation.
  if (/\b(?:about|regarding|on \d|last week|last month|\d{4}-\d{2}-\d{2})\b/i.test(text)) return;
  return { type: "QUERY_CONVERSATION", ...(onDate ? { onDate } : {}), ...(period ? { period } : {}) };
}

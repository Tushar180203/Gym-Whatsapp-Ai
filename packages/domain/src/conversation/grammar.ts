import type { ChangeScope } from "../../../contracts/src/ai/actions.js";
import type { Us4Action } from "../parser/us4-parser.js";
import { parseUs4Message } from "../parser/us4-parser.js";
import { hasSetNotation } from "../parser/set-parser.js";

export function normalizeMessage(text: string): string {
  return text.trim().replace(/[’‘]/g, "'").replace(/×/g, "x")
    .replace(/(\d)(kgs?|lbs?)(?=\s|x|for|\b)/gi, (_match, digit: string, unit: string) => `${digit} ${unit.toLowerCase().startsWith("kg") ? "kg" : "lb"} `)
    .replace(/\b(kgs|kilograms?|lbs|pounds?)(?=\s|x|for|\b)/gi, (unit: string) => unit.toLowerCase().startsWith("kg") || unit.toLowerCase().startsWith("kilo") ? "kg" : "lb")
    .replace(/(\d)reps\b/gi, "$1 reps")
    .replace(/\s+/g, " ").replace(/[?!]+$/, "").replace(/\bsame\s+(\d+)\b/gi, "same x $1");
}
export type ConversationGrammar =
  | { kind: "ACTION"; action: Us4Action }
  | { kind: "REPLACE"; source: string | null; replacement: string | null; scope: ChangeScope }
  | { kind: "LOG" | "LOG_NEXT"; notation: string }
  | { kind: "REPS"; reps: number }
  | { kind: "SAME" }
  | { kind: "REPAIR_VALUE"; ordinal: number; value: number }
  | { kind: "REPAIR_PREVIOUS_VALUE"; previous: number; value: number }
  | { kind: "DEFER"; exerciseRef: string }
  | { kind: "PERMANENT_RECENT" }
  | { kind: "REJECT_TARGET" } | { kind: "REPAIR_EXERCISE"; reference: string }
  | { kind: "FACT"; query: "PLAN" | "CURRENT" | "NEXT" | "LAST_SET" | "SETS" }
  | { kind: "SOCIAL" } | { kind: "CANCEL" } | { kind: "BACK" } | { kind: "HELP" } | { kind: "REPEAT" };
export function explicitScope(text: string): ChangeScope {
  if (/\b(?:don't|do not|never) (?:change|update).*routine\b|\b(?:today|this workout|this session|session only|temporary)\b/i.test(text)) return "SESSION_ONLY";
  if (/\b(?:from now on|from next week|permanent(?:ly)?|(?:to|in) my (?:routine|plan)|update (?:my |the |your )?routine)\b/i.test(text)) return "PERMANENT_ROUTINE";
  return "AMBIGUOUS";
}
export function isScopeAnswer(text: string): boolean {
  return /^(?:(?:just|only|for) )?(?:today(?: only)?|this (?:workout|session)|session only|permanent(?:ly)?|from now on|(?:ok(?:ay)? )?(?:make|apply) (?:that|the) change (?:for )?today|update (?:my |the )?routine)(?: please)?$/i.test(text);
}
export function parseConversationGrammar(value: string): ConversationGrammar | undefined {
  if (/^(cancel|never mind|nevermind|forget that|stop)$/i.test(value)) return { kind: "CANCEL" };
  if (/^(go back|back)$/i.test(value)) return { kind: "BACK" };
  if (/^(help|what can you do|what do you mean)$/i.test(value)) return { kind: "HELP" };
  if (/^(repeat|reply|say that again)$/i.test(value)) return { kind: "REPEAT" };
  if (/^no(?:,)? not (?:that|this)(?: one)?$/i.test(value)) return { kind: "REJECT_TARGET" };
  const exerciseRepair = value.match(/^sorry (?:that|it) was (.+)$/i);
  if (exerciseRepair && !/\d/.test(exerciseRepair[1]!)) return { kind: "REPAIR_EXERCISE", reference: exerciseRepair[1]! };
  if (/^make (?:this|that|it)(?: change)? permanent$/i.test(value)) return { kind: "PERMANENT_RECENT" };
  if (/^(hi|hey|hello|thanks|thank you|okay|ok|cool|are you there)$/i.test(value)) return { kind: "SOCIAL" };
  if (/^(?:what'?s today|what is today|what am i doing today|show (?:me )?(?:today|today'?s workout)|send my workout|what should i do according to my plan)$/i.test(value)) return { kind: "FACT", query: "PLAN" };
  if (/^(?:what exercise am i on|what am i on|current exercise)$/i.test(value)) return { kind: "FACT", query: "CURRENT" };
  if (/^(?:what'?s next|what(?: is|'s) my next exercise)$/i.test(value)) return { kind: "FACT", query: "NEXT" };
  if (/^(?:what was my last set|last set)$/i.test(value)) return { kind: "FACT", query: "LAST_SET" };
  if (/^(?:ok(?:ay)? )?back to (?:the )?workout$/i.test(value)) return { kind: "FACT", query: "CURRENT" };
  if (/^how many sets (?:do i have|are left)$/i.test(value)) return { kind: "FACT", query: "SETS" };
  if (/^(start(?: workout)?|let'?s (?:go|train)|gym time|begin|ready)$/i.test(value)) return { kind: "ACTION", action: { type: "START_WORKOUT" } };
  const start = value.match(/^(?:let'?s )?start (.+)$/i);
  if (start && !/^(?:planned(?: workout)?|routine .+)$/i.test(start[1]!)) return { kind: "ACTION", action: { type: "START_WORKOUT", sessionRef: start[1]! } };
  const compound = value.match(/^(.+?)\s+(?:and|then)\s+(?:next|move on|next exercise)$/i);
  if (compound && hasSetNotation(compound[1]!)) return { kind: "LOG_NEXT", notation: compound[1]! };
  if (hasSetNotation(value)) return { kind: "LOG", notation: value };
  const reps = value.match(/^(\d+) reps$/i);
  if (reps) return { kind: "REPS", reps: Number(reps[1]) };
  if (/^same$/i.test(value)) return { kind: "SAME" };
  const correction = value.match(/^(?:actually(?: (?:that|it) was)?|that was|sorry(?: that was)?|wait make (?:that|it)|change my last set to) (\d+)(?: reps)?$/i);
  if (correction) return { kind: "ACTION", action: { type: "CORRECT_SET", replacement: { reps: Number(correction[1]) } } };
  const loadRepair = value.match(/^i meant (\d+(?:\.\d+)?) not (\d+(?:\.\d+)?)$/i);
  if (loadRepair) return { kind: "REPAIR_PREVIOUS_VALUE", previous: Number(loadRepair[2]), value: Number(loadRepair[1]) };
  const repair = value.match(/^set (\d+) was (\d+(?:\.\d+)?)(?: (reps|kg|lb))?$/i);
  if (repair && !repair[3]) return { kind: "REPAIR_VALUE", ordinal: Number(repair[1]), value: Number(repair[2]) };
  if (repair) return { kind: "ACTION", action: { type: "CORRECT_SET", targetRef: `set:${repair[1]}`, replacement: repair[3]!.toLowerCase() === "reps" ? { reps: Number(repair[2]) } : { loadValue: Number(repair[2]), weightUnit: repair[3]!.toUpperCase() as "KG" | "LB" } } };
  const defer = value.match(/^come back to (.+?) later$/i);
  if (defer) return { kind: "DEFER", exerciseRef: defer[1]! };
  const busy = value.match(/^(.+?) is busy$/i);
  if (busy) return { kind: "REPLACE", source: /^(?:the )?machine$/i.test(busy[1]!) ? "current" : busy[1]!, replacement: null, scope: "SESSION_ONLY" };
  if (/^(next|move on|next exercise)$/i.test(value)) return { kind: "ACTION", action: { type: "NEXT_EXERCISE" } };
  if (/^skip (?:this|it)(?: today)?$/i.test(value)) return { kind: "ACTION", action: { type: "SKIP_EXERCISE", exerciseRef: "current", scope: "SESSION_ONLY" } };
  const remove = value.match(/^remove (.+?) today$/i);
  if (remove) return { kind: "ACTION", action: { type: "SKIP_EXERCISE", exerciseRef: remove[1]!, scope: "SESSION_ONLY" } };
  const scope = explicitScope(value);
  const body = value.replace(/^(?:from now on|permanently) /i, "").replace(/ (?:today|this workout|this session|permanently)$/i, "");
  let match = body.match(/^(?:replace|swap) (.+?)(?: (?:with|for) (.+))?$/i);
  if (match && !/^workout\b/i.test(match[1]!)) return { kind: "REPLACE", source: match[1]!, replacement: match[2] ?? null, scope };
  match = body.match(/^do (.+?) instead of (.+)$/i);
  if (match) return { kind: "REPLACE", source: match[2]!, replacement: match[1]!, scope };
  const parsed = parseUs4Message(value);
  return parsed ? { kind: "ACTION", action: parsed } : undefined;
}

export type StartChoice =
  | { kind: "START"; routineRef?: string; sessionRef?: string }
  | { kind: "ACCEPT" }
  | { kind: "CHOOSE"; sessionRef: string }
  | { kind: "REST" }
  | { kind: "REPLACE"; sessionRef: string };

export function parseStartIntent(input: string): StartChoice | undefined {
  const text = input.trim();
  if (/^(start|let['\u2019]?s start|gym time|start workout)$/i.test(text)) return { kind: "START" };
  if (/^(start planned|start planned workout|accept workout)$/i.test(text)) return { kind: "ACCEPT" };
  if (/^(rest|skip workout|rest today)$/i.test(text)) return { kind: "REST" };
  let match = text.match(/^start routine (.+)$/i);
  if (match) return { kind: "START", routineRef: match[1]! };
  match = text.match(/^start (?:session |workout )(.+)$/i);
  if (match) return { kind: "START", sessionRef: match[1]! };
  match = text.match(/^choose (.+?)(?: today)?$/i);
  if (match) return { kind: "CHOOSE", sessionRef: match[1]! };
  match = text.match(/^replace workout with (.+?)(?: today)?$/i);
  if (match) return { kind: "REPLACE", sessionRef: match[1]! };
  return undefined;
}

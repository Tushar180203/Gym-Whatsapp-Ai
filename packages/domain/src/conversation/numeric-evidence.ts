// This is lexical numeric evidence, not intent parsing. Never changes digit tokens.
const small: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const tens: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
export function numericEvidence(input: string): number[] {
  const tokens = input.toLowerCase().replace(/(?<=[a-z])-(?=[a-z])/g, " ").match(/[+-]?\d+(?:\.\d+)?|[a-z]+|[^\w\s]/g) ?? [];
  const values: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const sign = tokens[i - 1] === "minus" || tokens[i - 1] === "negative" ? -1 : 1;
    if (/^[+-]?\d/.test(token)) { values.push(sign * Number(token)); continue; }
    if (tens[token] !== undefined) {
      let value = tens[token]!;
      const next = small[tokens[i + 1] ?? ""];
      if (next !== undefined && next > 0 && next < 10) { value += next; i++; }
      values.push(sign * value);
    } else if (small[token] !== undefined) values.push(sign * small[token]!);
  }
  return values;
}
export function hasExplicitUnit(input: string, unit: "KG" | "LB"): boolean {
  return (unit === "KG" ? /\b(?:kg|kgs|kilos?|kilograms?)\b/i : /\b(?:lb|lbs|pounds?)\b/i).test(input.replace(/(\d)([a-z])/gi, "$1 $2"));
}

export function explicitSetCounts(input: string): number[] {
  const numberWords = [...Object.keys(small), ...Object.keys(tens)].join("|");
  const count = `(?:[+-]?\\d+(?:\\.\\d+)?|(?:${numberWords})(?:[ -](?:${Object.keys(small).join("|")}))?)`;
  const descriptor = `(?!(?:${numberWords}|reps?|kg|lb|to|or|and|of|with|at)\\b)[a-z]+`;
  const pattern = new RegExp(`(?<![\\w.])(${count})\\s+(?:${descriptor}\\s+){0,3}sets?\\b`, "gi");
  return [...input.replace(/(\d)(sets?\b)/gi, "$1 $2").matchAll(pattern)].map(match => numericEvidence(match[1]!).at(-1)).filter((n): n is number => n !== undefined);
}
export function hasSetCountEvidence(input: string, count: number, reps: number[]): boolean {
  const explicitCounts = explicitSetCounts(input);
  if (explicitCounts.length) return explicitCounts.length === 1 && explicitCounts[0] === count;
  if (count === 1) return true;
  // Without an explicit count, every set needs an independently supplied rep value.
  const evidence = numericEvidence(input);
  for (const rep of reps) {
    const index = evidence.indexOf(rep);
    if (index < 0) return false;
    evidence.splice(index, 1);
  }
  return true;
}

export function hasPerHandEvidence(input: string, load: number): boolean {
  if (/\b(?:per[ -]?(?:hand|side)|each (?:hand|side))\b/i.test(input)) return true;
  if (/\bsets?\b/i.test(input)) return false;
  const prefix = input.match(/(.{1,80}?)\beach\b/i)?.[1];
  return Boolean(prefix && !/\breps?\s*$/i.test(prefix) && numericEvidence(prefix).at(-1) === load);
}

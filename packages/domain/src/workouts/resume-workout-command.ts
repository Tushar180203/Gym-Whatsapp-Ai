export function isResumeIntent(text: string): boolean {
  return ["resume", "resume workout"].includes(text.trim().toLowerCase());
}

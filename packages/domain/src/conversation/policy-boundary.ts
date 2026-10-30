// Detect explicit attempts to supply authority. This never interprets workout numbers or targets.
// Concrete owned change requests saying "don't ask confirmation" still follow normal confirmation policy.
export function attemptsPolicyBypass(message: string): boolean {
  return /\bignore\b.{0,50}\b(?:rules|policy|instructions|safety|constraints)\b|\b(?:pretend|act as if|treat.*as)\b.{0,80}\b(?:confirm(?:ed|ation)?|said yes|system instructions)\b|\b(?:bypass|skip)\b.{0,40}\b(?:ownership|validation|safety checks)\b|\b(?:system override|developer says|you are now admin|forbiddenDirectMutation)\b/i.test(message);
}

/** Presentation only. Command results and validation must run before this boundary. */
export const whatsappReplyTitles = {
  WORKOUT_PROPOSAL: "🏋️ Your next workout",
  WORKOUT_STARTED: "🔥 Workout started",
  WORKOUT_RESUMED: "💪 Workout resumed",
  WORKOUT_FINISHED: "📝 Workout summary",
  SET_LOGGED: "✅ Set recorded",
  SETS_LOGGED: "✅ Sets recorded",
  SET_CORRECTED: "✏️ Set updated",
  CURRENT_STATE: "📍 Current workout",
  PLAN_FACT: "🗓️ Your workout plan",
  HISTORY_FACT: "📖 Your training history",
  ANALYTICS_FACT: "📈 Your training insights",
  EXERCISE_CHANGED: "🔄 Workout updated",
  PENDING_QUESTION: "🤔 Quick question",
  CONFIRMATION_REQUIRED: "🔎 Confirm your change",
  CONTEXTUAL_HELP: "👋 Workout Companion",
  RECOVERY: "💬 Next step",
  COACHING_BOUNDARY: "📋 Your training data",
  SYSTEM_ERROR: "🛠️ Please try again",
  DOMAIN_RESULT: "💬 Workout update",
  CONNECTED: "🎉 WhatsApp connected",
  PLAN_READY: "🗓️ Your plan is ready"
} as const;
type ReplyKind = keyof typeof whatsappReplyTitles;
const headings = new Set<string>(Object.values(whatsappReplyTitles).flatMap(title => [`*${title}*`, `*${title.slice(title.indexOf(" ") + 1)}*`]));
const maximumLength = 4096;

function cleanWhitespace(body: string): string {
  return body.replace(/\r\n?/g, "\n").split("\n").map(line => line.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function layoutDetails(body: string): string {
  const finishChoice = /^(?:(Unfinished work remains\.|No recorded sets\.) )?(Save completed, save incomplete, continue, or discard|Save incomplete, continue, or discard)\?$/.exec(body);
  if (finishChoice) {
    const choices = finishChoice[2]!.split(/,? or |, /).map(choice => `• ${choice[0]!.toUpperCase()}${choice.slice(1)}`);
    return [...(finishChoice[1] ? [finishChoice[1], ""] : []), "Reply with one option:", ...choices].join("\n");
  }
  if (body === "Today only or update your routine?") return `${body}\n\n• Today only\n• Update your routine\n\nReply TODAY or PERMANENT.`;
  // These labels and separators are emitted by our own response builders. Do not
  // split arbitrary sentences or punctuation in exercise names, values or URLs.
  return body.split("\n").map(line => {
    const sets = /^(Logged|Last time|Best reps at load): (.+)$/.exec(line);
    if (sets) {
      const entries = sets[2]!.split(", ");
      const isSet = (entry: string) => /^\d+(?:\.\d+)? (?:kg|lb)(?: (?:per hand\/side|total|stack|each|default))? x \d+\.?$/i.test(entry);
      if (entries.length > 1 && entries.every(isSet)) return `${sets[1]}:\n${entries.map(entry => `• ${entry}`).join("\n")}`;
    }
    // Only expand explicit numbered alternatives, keeping the original order.
    if (/; \d+\. /.test(line)) return line.replace(/; (?=\d+\. )/g, "\n").replace(/\? (?=\d+\. )/, "?\n\n");
    return line;
  }).join("\n")
    .replace(/([.!?]) (?=(?:Reply|Send)\b)/g, "$1\n\n")
    .replace(/\n(?=(?:Stay on |Reply |Send |Start planned,|Log a set,))\b/g, "\n\n")
    .replace(/\n(?=\*Current exercise\*)/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** Idempotent, factual layout; valid near-limit replies retain every character of content. */
export function formatWhatsAppMessage(body: string, kind?: ReplyKind): string {
  const clean = cleanWhitespace(body);
  if (!clean || headings.has(clean.split("\n")[0]!)) return clean;
  const category = kind ?? (clean === "WhatsApp connected successfully. You can now receive and log your workouts." || clean === "WhatsApp linked"
    ? "CONNECTED"
    : /^Your workout plan .+ is ready\. Send start when you want to train\.$/.test(clean) ? "PLAN_READY" : "DOMAIN_RESULT");
  const motivation = category === "WORKOUT_STARTED" ? "Yeahh buddy, let's gooo! 💪🔥"
    : category === "WORKOUT_RESUMED" ? "Back at it. You've got this! 💪"
      : category === "SET_LOGGED" || category === "SETS_LOGGED" ? "Solid work. One set at a time! 💪"
        : category === "WORKOUT_FINISHED" && /: completed(?:\n|$)/.test(clean) ? "That's a wrap. Nice work showing up! 🙌" : "";
  const decorated = `*${whatsappReplyTitles[category]}*\n\n${motivation ? `${motivation}\n\n` : ""}${layoutDetails(clean)}`;
  if (decorated.length <= maximumLength) return decorated;
  const concise = `*${whatsappReplyTitles[category]}*\n\n${clean}`;
  return concise.length <= maximumLength ? concise : clean;
}

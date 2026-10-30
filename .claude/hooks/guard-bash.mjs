#!/usr/bin/env node
// PreToolUse(Bash) guard: blocks destructive, bypass and secret-reading commands.
// Exit code 2 = block (stderr is shown to the agent). Rules are mirrored in docs/ai-policy.md §4.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const BLOCKED = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\s+-f|-f\s+-r|--recursive\s+--force|--force\s+--recursive)\b/i, "recursive forced delete (rm -rf)"],
  [/\bgit\s+push\b[^\n;&|]*\s(--force(-with-lease)?|-f)\b/, "force-push"],
  [/\bgit\s+push\b[^\n;&|]*\s(\S+:)?\+?(refs\/heads\/)?(main|master)(\s|$)/, "push to the default branch (open a PR instead)"],
  [/--no-verify\b|\bgit\s+commit\b[^\n;&|]*\s-n\b/, "hook bypass (--no-verify)"],
  [/\bgit\s+reset\s+--hard\b/, "git reset --hard (destroys uncommitted work)"],
  [/\bgit\s+clean\s+-[a-z]*f/i, "git clean -f (deletes untracked files)"],
  [/\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/, "discarding all working-tree changes"],
  [/\bgit\s+branch\s+-D\b/, "force branch deletion"],
  [/\b(drop\s+(table|database|schema)|truncate\s+(table\s+)?[a-z_"])/i, "DROP/TRUNCATE SQL"],
  [/\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/, "piping a download into a shell"],
  [/\b(terraform\s+destroy|kubectl\s+delete|docker\s+system\s+prune|npm\s+publish)\b/, "destructive infra/publish command"],
  [/\bsudo\b/, "sudo"],
  [/\bchmod\s+(-R\s+)?777\b/, "chmod 777"],
  [/(^|[\s;&|(])(cat|less|more|head|tail|bat|grep|rg|sed|awk|cp|mv|base64|xxd|strings|source|\.)\s+([^\n;&|]*[\s/'"])?\.env(?!\.example)(\.[\w-]+)?(?=\s|$|['"])/, "reading a .env secrets file"],
  [/(^|[\s;&|(])(printenv|env)(\s*$|\s*[|;&])/, "dumping environment variables"],
  [/\.(pem|key|p12|pfx)(?![\w-])|\bid_rsa\b|(^|[\s/'"])\.aws\/|evaluation-runs\//, "reading keys, cloud credentials or raw evaluation-run logs"]
];

export function check(command) {
  for (const [re, why] of BLOCKED) if (re.test(command)) return why;
  return null;
}

function currentBranch() {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const command = String(input?.tool_input?.command ?? "");
  let why = check(command);
  // A bare `git push` / `git push origin` pushes the current branch; block that when the current branch is main.
  const bareGitPush = /\bgit\s+push(\s+-{1,2}[\w-]+)*(\s+[\w.-]+)?\s*($|[;&|])/.test(command);
  if (!why && bareGitPush && ["main", "master"].includes(currentBranch())) {
    why = "push while on the default branch (create a feature branch and open a PR)";
  }
  if (why) {
    process.stderr.write(`Blocked by .claude/hooks/guard-bash.mjs: ${why}. See docs/ai-policy.md §4; ask a human if this is really needed.\n`);
    process.exit(2);
  }
}

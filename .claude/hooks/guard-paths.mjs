#!/usr/bin/env node
// PreToolUse(Read|Edit|Write|MultiEdit|NotebookEdit) guard.
// Secrets and raw data are denied for every tool; CI, agent config and applied migrations need human approval to edit.
import { readFileSync } from "node:fs";
import path from "node:path";

const DENY = [
  [/(^|\/)\.env(?!\.example$)(\.[\w-]+)?$/, "secrets file (.env)"],
  [/\.(pem|key|p12|pfx)$|(^|\/)id_rsa/, "private key material"],
  [/(^|\/)\.aws\//, "cloud credentials"],
  [/(^|\/)specs\/[^/]+\/evaluation-runs\//, "raw evaluation-run logs (may contain conversation data)"],
  [/(^|\/)\.git\//, "git internals"]
];

const ASK_ON_WRITE = [
  [/^\.github\//, "CI workflows, CODEOWNERS and templates"],
  [/^\.(claude|codex|agents|specify|githooks)\//, "shared AI agent configuration"],
  [/^(AGENTS|CLAUDE)\.md$|(^|\/)AGENTS\.md$/, "agent instruction files"],
  [/^docs\/ai-policy\.md$/, "the AI usage policy"],
  [/^packages\/persistence\/migrations\/\d{4}_.+\.sql$/, "an existing SQL migration (add a new one instead)"],
  [/^package(-lock)?\.json$/, "dependency manifests"]
];

export function decide(toolName, filePath, projectDir, exists = true) {
  if (!filePath) return null;
  const rel = path.relative(projectDir, path.resolve(projectDir, filePath)).split(path.sep).join("/");
  for (const [re, why] of DENY) if (re.test(rel)) return { decision: "deny", reason: `Access to ${why} is denied for agents (${rel}).` };
  if (toolName !== "Read" && !rel.startsWith("..")) {
    for (const [re, why] of ASK_ON_WRITE) {
      if (re.test(rel) && !(why.startsWith("an existing") && !exists)) {
        return { decision: "ask", reason: `Editing ${why} requires human approval (${rel}).` };
      }
    }
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const filePath = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path ?? input?.tool_input?.path;
  let exists = true;
  try {
    readFileSync(path.resolve(projectDir, filePath ?? ""));
  } catch {
    exists = false;
  }
  const result = decide(input.tool_name, filePath, projectDir, exists);
  if (result?.decision === "deny") {
    process.stderr.write(`Blocked by .claude/hooks/guard-paths.mjs: ${result.reason}\n`);
    process.exit(2);
  }
  if (result?.decision === "ask") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: result.reason }
    }));
  }
}

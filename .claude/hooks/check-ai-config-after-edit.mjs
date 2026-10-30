#!/usr/bin/env node
// PostToolUse(Edit|Write|MultiEdit): re-validate AI configuration whenever an agent edits it.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const rel = path.relative(projectDir, String(input?.tool_input?.file_path ?? "")).split(path.sep).join("/");
const isAiConfig = /^(AGENTS\.md|CLAUDE\.md|apps\/web\/AGENTS\.md|docs\/.+\.md|\.github\/CODEOWNERS)$|^\.(claude|codex|agents|githooks)\//.test(rel);
if (!isAiConfig) process.exit(0);

const run = spawnSync("node", ["scripts/check-ai-config.mjs"], { cwd: projectDir, encoding: "utf8" });
if (run.status !== 0) {
  process.stderr.write(`AI config validation failed after editing ${rel}:\n${run.stdout}${run.stderr}`);
  process.exit(2);
}

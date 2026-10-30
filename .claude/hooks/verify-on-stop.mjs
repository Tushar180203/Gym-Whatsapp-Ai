#!/usr/bin/env node
// Stop hook: the agent cannot finish while lint or tests related to its changes fail.
// Runs only when code changed; trims output to keep context small. Exit 2 sends the failure back to the agent.
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
if (input.stop_hook_active) process.exit(0);

const changed = execSync("git status --porcelain", { encoding: "utf8" })
  .split("\n")
  .map((line) => line.slice(3))
  .filter((file) => /\.(ts|tsx|mjs|sql)$|^package\.json$/.test(file));
if (changed.length === 0) process.exit(0);

const tail = (text, n = 40) => text.trim().split("\n").slice(-n).join("\n");
const steps = [
  ["npm run -s lint", ["npm", ["run", "-s", "lint"]]],
  ["vitest (tests related to uncommitted changes)", ["npx", ["vitest", "run", "--changed", "--reporter=dot"]]],
  ["AI config validation", ["node", ["scripts/check-ai-config.mjs"]]]
];
for (const [label, [cmd, args]] of steps) {
  const run = spawnSync(cmd, args, { encoding: "utf8", timeout: 240_000 });
  // A change with no related test file is not a failure here; review and CI still require tests.
  const noRelatedTests = /No test files found/.test(`${run.stdout}${run.stderr}`);
  if (run.status !== 0 && !noRelatedTests) {
    process.stderr.write(`Stop blocked: ${label} failed. Fix it or report the failure explicitly (constitution XVIII).\n${tail(`${run.stdout}\n${run.stderr}`)}\n`);
    process.exit(2);
  }
}

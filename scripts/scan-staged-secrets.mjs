#!/usr/bin/env node
// Pre-commit secret scan. Uses gitleaks when installed; otherwise scans staged additions with built-in patterns.
// Prints file:line only, never the matched value.
import { execFileSync, spawnSync } from "node:child_process";

const hasGitleaks = spawnSync("gitleaks", ["version"], { stdio: "ignore" }).status === 0;
if (hasGitleaks) {
  const run = spawnSync("gitleaks", ["git", "--pre-commit", "--staged", "--redact", "--no-banner", "-v"], { stdio: "inherit" });
  process.exit(run.status ?? 1);
}

const PATTERN = /AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}|[sr]k_live_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./;
const BLOCKED_FILES = /(^|\/)\.env(?!\.example$)(\.[\w-]+)?$|\.(pem|p12|pfx|key)$|(^|\/)id_rsa/;

const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], { encoding: "utf8" }).split("\n").filter(Boolean);
const hits = [];
for (const file of staged) {
  if (BLOCKED_FILES.test(file)) hits.push(`${file} (secret file type must not be committed)`);
  const diff = execFileSync("git", ["diff", "--cached", "-U0", "--", file], { encoding: "utf8" });
  let line = 0;
  for (const text of diff.split("\n")) {
    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (text.startsWith("+") && !text.startsWith("+++")) {
      if (PATTERN.test(text)) hits.push(`${file}:${line}`);
      line++;
    }
  }
}
if (hits.length) {
  console.error(`Possible secrets in staged changes (values hidden):\n  ${hits.join("\n  ")}\nRemove them, use env vars, or install gitleaks for precise scanning.`);
  process.exit(1);
}
console.log("Secret scan (built-in patterns): no findings. Install gitleaks for full coverage.");

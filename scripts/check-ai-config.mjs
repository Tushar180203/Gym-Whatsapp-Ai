#!/usr/bin/env node
// Validates the shared AI agent configuration (run locally, in pre-commit, in CI and by agent hooks).
// Usage: node scripts/check-ai-config.mjs   → exit 1 with a list of problems.
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const errors = [];
const fail = (msg) => errors.push(msg);
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => existsSync(path.join(root, rel));

const SECRET = /AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----/;

// 1. Instruction files: canonical AGENTS.md, imports, size, links, commands.
const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", "apps/web/AGENTS.md", "apps/web/CLAUDE.md"];
for (const rel of INSTRUCTION_FILES) if (!exists(rel)) fail(`${rel} is missing`);
if (exists("AGENTS.md")) {
  const lines = read("AGENTS.md").split("\n").length;
  if (lines > 200) fail(`AGENTS.md has ${lines} lines (limit 200); move detail into docs/ or skills`);
  const scripts = JSON.parse(read("package.json")).scripts ?? {};
  for (const [, name] of read("AGENTS.md").matchAll(/npm run (?:-s )?([\w:.-]+)/g)) {
    if (!(name in scripts)) fail(`AGENTS.md references "npm run ${name}" but package.json has no such script`);
  }
}
for (const rel of ["CLAUDE.md", "apps/web/CLAUDE.md"]) {
  if (exists(rel) && !/^@AGENTS\.md/m.test(read(rel))) fail(`${rel} must import AGENTS.md with "@AGENTS.md"`);
}

// 2. Relative markdown links in instruction files and AI docs resolve.
const docFiles = [...INSTRUCTION_FILES, ...readdirSync(path.join(root, "docs"), { recursive: true })
  .filter((f) => String(f).endsWith(".md")).map((f) => `docs/${f}`)];
for (const rel of docFiles.filter(exists)) {
  for (const [, target] of read(rel).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    if (!existsSync(path.resolve(root, path.dirname(rel), target))) fail(`${rel}: broken link → ${target}`);
  }
}

// 3. Skills: frontmatter, size, side-effect skills manual-only, single source via symlink.
const skillsDir = path.join(root, ".agents/skills");
for (const name of readdirSync(skillsDir)) {
  const rel = `.agents/skills/${name}/SKILL.md`;
  if (!exists(rel)) { fail(`${rel} missing`); continue; }
  const text = read(rel);
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const declared = fm.match(/^name:\s*["']?([\w-]+)/m)?.[1];
  if (declared !== name) fail(`${rel}: frontmatter name "${declared}" must equal folder name "${name}"`);
  const description = fm.match(/^description:\s*(.+)$/m)?.[1] ?? "";
  if (description.length < 40 || !/\buse\b/i.test(description)) fail(`${rel}: description must say what it does and when to use it`);
  if (text.split("\n").length > 500) fail(`${rel}: longer than 500 lines`);
  if (/(gh issue create|create_issue|db:migrate|git push|npm publish)/.test(text) && !/^disable-model-invocation:\s*true/m.test(fm)) {
    fail(`${rel}: has side effects but is not disable-model-invocation: true`);
  }
}
const link = path.join(root, ".claude/skills");
if (!existsSync(link) || !lstatSync(link).isSymbolicLink()) fail(".claude/skills must be a symlink to ../.agents/skills");

// 4. Claude Code settings: no bypass, no broad allows, hooks exist.
if (!exists(".claude/settings.json")) fail(".claude/settings.json is missing");
else {
  let settings = {};
  try { settings = JSON.parse(read(".claude/settings.json")); } catch (e) { fail(`.claude/settings.json is invalid JSON: ${e.message}`); }
  const perms = settings.permissions ?? {};
  if (perms.defaultMode === "bypassPermissions") fail("Claude defaultMode must not be bypassPermissions");
  if (perms.disableBypassPermissionsMode !== "disable") fail('permissions.disableBypassPermissionsMode must be "disable"');
  for (const rule of perms.allow ?? []) {
    if (/^Bash(\(\*?\))?$|^Bash\(\*|^mcp__\*|^mcp__[^_]+$|^(Edit|Write)(\(\*\*?\))?$/.test(rule)) fail(`Broad allow rule not permitted: ${rule}`);
  }
  for (const needed of ["Read(./.env)", "Bash(git push --force:*)", "Bash(rm -rf:*)"]) {
    if (!(perms.deny ?? []).includes(needed)) fail(`Missing deny rule ${needed}`);
  }
  if (settings.enableAllProjectMcpServers === true) fail("enableAllProjectMcpServers must not be true");
  if (settings.sandbox?.enabled !== true) fail("sandbox.enabled must be true");
  for (const groups of Object.values(settings.hooks ?? {})) {
    for (const group of groups) for (const hook of group.hooks ?? []) {
      const script = hook.command?.match(/\.claude\/hooks\/[\w.-]+/)?.[0];
      if (script && !exists(script)) fail(`Hook script ${script} does not exist`);
    }
  }
  for (const event of ["PreToolUse", "PostToolUse", "Stop"]) if (!settings.hooks?.[event]) fail(`No ${event} hook configured`);
}

// 5. Codex config: sandboxed, approvals on.
if (!exists(".codex/config.toml")) fail(".codex/config.toml is missing");
else {
  const toml = read(".codex/config.toml");
  if (/danger-full-access/.test(toml.replace(/#.*$/gm, ""))) fail("Codex sandbox_mode must not be danger-full-access");
  if (/approval_policy\s*=\s*"never"/.test(toml)) fail('Codex approval_policy must not be "never"');
  if (!/sandbox_mode\s*=\s*"(workspace-write|read-only)"/.test(toml)) fail("Codex sandbox_mode must be workspace-write or read-only");
}

// 6. MCP configs (if any): pinned, no literal credentials, no auto-approve.
for (const rel of [".mcp.json", ".cursor/mcp.json", ".vscode/mcp.json"].filter(exists)) {
  const text = read(rel);
  if (/@latest|:latest/.test(text)) fail(`${rel}: unpinned MCP server version`);
  if (/"(autoApprove|alwaysAllow)"\s*:\s*\[\s*"/.test(text) || /"trust"\s*:\s*true/.test(text)) fail(`${rel}: auto-approval not allowed`);
  if (/http:\/\/(?!localhost|127\.0\.0\.1)/.test(text)) fail(`${rel}: remote MCP over plain http`);
  for (const [, key, value] of text.matchAll(/"([\w-]*(?:KEY|TOKEN|SECRET|PASSWORD)[\w-]*)"\s*:\s*"([^"]*)"/gi)) {
    if (value && !/^\$\{?[\w:-]+\}?$/.test(value)) fail(`${rel}: literal credential in ${key}; use an env reference`);
  }
}

// 7. Git hooks, CODEOWNERS coverage, gitignore of personal files.
for (const hook of [".githooks/pre-commit", ".githooks/pre-push"]) {
  if (!exists(hook)) fail(`${hook} missing`);
  else if (!(statSync(path.join(root, hook)).mode & 0o111)) fail(`${hook} is not executable`);
}
if (!exists(".github/CODEOWNERS")) fail(".github/CODEOWNERS missing");
else {
  const owners = read(".github/CODEOWNERS");
  for (const p of ["/AGENTS.md", "/CLAUDE.md", "/.agents/", "/.claude/", "/.codex/", "/.specify/", "/.githooks/", "/.github/"]) {
    if (!owners.includes(p)) fail(`CODEOWNERS does not cover ${p}`);
  }
}
const gitignore = read(".gitignore");
for (const p of ["CLAUDE.local.md", ".claude/settings.local.json", "AGENTS.override.md", ".env"]) {
  if (!gitignore.includes(p)) fail(`.gitignore must cover ${p}`);
}

// 8. No secrets in AI configuration.
const aiFiles = [...docFiles, ".claude/settings.json", ".codex/config.toml",
  ...readdirSync(skillsDir).map((n) => `.agents/skills/${n}/SKILL.md`)].filter(exists);
for (const rel of aiFiles) if (SECRET.test(read(rel))) fail(`${rel}: looks like it contains a secret`);

if (errors.length) {
  console.error(`AI config check failed (${errors.length}):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`AI config check passed (${aiFiles.length} files).`);

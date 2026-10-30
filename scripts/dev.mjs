import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";
import { runtimeEnv } from "../packages/contracts/src/env.ts";

let local = {};
try { local = parseEnv(readFileSync(".env", "utf8")); }
catch (error) { if (error.code !== "ENOENT") { console.error("Could not read local environment configuration."); process.exit(1); } }
// Explicit operator/test configuration takes precedence over local defaults.
const env = { ...local, ...process.env };
try { runtimeEnv(env); }
catch (error) { console.error(error.message); process.exit(1); }
// Load values here rather than --env-file: Next forwards parent Node flags into
// NODE_OPTIONS, where Node rejects --env-file and stops its server subprocess.
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "apps/web", "--webpack", ...process.argv.slice(2)], { env, stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("error", () => { console.error("Development server could not start."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });

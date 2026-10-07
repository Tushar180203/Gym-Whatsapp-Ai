import { runtimeEnv } from "../packages/contracts/src/env.ts";
try { runtimeEnv(); console.info("Runtime configuration valid (values redacted)."); }
catch (error) { console.error(error.message); process.exitCode = 1; }

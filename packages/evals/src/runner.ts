import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StaticPromptRegistry, StructuredIntentInterpreter } from "../../ai/src/index.js";
import type { IntentInterpreter } from "../../ai/src/interfaces.js";
import { MockStructuredOutputClient } from "../../ai/src/testing/mock-structured-output-client.js";
import { evaluateCase, parseEvalCases, type EvalCase, type EvalFailure } from "./eval-case-schema.js";

export type EvalRunResult = {
  total: number;
  passed: number;
  failed: number;
  failures: EvalFailure[];
};

export function loadEvalCases(rootDir = "packages/evals/fixtures"): EvalCase[] {
  const files = listFixtureFiles(rootDir);
  return files.flatMap((file) => parseEvalCases(JSON.parse(readFileSync(file, "utf8"))));
}

export async function runEvalCases(cases = loadEvalCases(), suppliedInterpreter?: IntentInterpreter): Promise<EvalRunResult> {
  const failures: EvalFailure[] = [];
  for (const testCase of cases) {
    const client = new MockStructuredOutputClient([testCase.mockProviderOutput]);
    const interpreter = suppliedInterpreter ?? new StructuredIntentInterpreter(client, new StaticPromptRegistry("mock-intent-model"));
    try {
      const actual = await interpreter.interpret({
      userInput: testCase.userInput,
      idempotencyKey: testCase.id,
      context: {
        userId: "eval-user",
        ...(testCase.conversationContext ?? {})
      }
    });
      failures.push(...evaluateCase(actual, testCase));
    } catch {
      failures.push({ caseId: testCase.id, reason: "Interpretation failed schema/provider validation" });
    }
  }
  return {
    total: cases.length,
    passed: cases.length - new Set(failures.map((failure) => failure.caseId)).size,
    failed: new Set(failures.map((failure) => failure.caseId)).size,
    failures
  };
}

export async function runEvalCli(): Promise<void> {
  const result = await runEvalCases();
  console.log(JSON.stringify(result, null, 2));
  if (result.failed > 0) process.exitCode = 1;
}

function listFixtureFiles(rootDir: string): string[] {
  const entries = readdirSync(rootDir).map((entry) => join(rootDir, entry));
  return entries.flatMap((entry) => {
    if (statSync(entry).isDirectory()) return listFixtureFiles(entry);
    return entry.endsWith(".yaml") || entry.endsWith(".json") ? [entry] : [];
  });
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  await runEvalCli();
}

import { evaluateConfirmationPolicy, parseProposedActionEnvelope, type ProposedActionEnvelope } from "../../contracts/src/index.js";
import { isDeepStrictEqual } from "node:util";

export const evalCaseSchemaVersion = "eval-case.v1" as const;

export type EvalCase = {
  id: string;
  schemaVersion: typeof evalCaseSchemaVersion;
  requirementRefs: string[];
  conversationContext?: Record<string, unknown>;
  userInput: string;
  expectedAction: { type: string };
  expectedFields?: Record<string, unknown>;
  expectedClarification?: string | null;
  expectedConfirmationRequired?: boolean;
  forbiddenOutcomes?: string[];
  mockProviderOutput: ProposedActionEnvelope;
};

export type EvalFailure = {
  caseId: string;
  reason: string;
};

export function parseEvalCases(value: unknown): EvalCase[] {
  if (!Array.isArray(value)) throw new Error("Eval fixture must be an array of eval-case.v1 cases");
  return value.map(parseEvalCase);
}

export function parseEvalCase(value: unknown): EvalCase {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Eval case must be an object");
  const record = value as Record<string, unknown>;
  const id = requiredString(record.id, "id");
  if (record.schemaVersion !== evalCaseSchemaVersion) throw new Error(`${id}: unsupported eval case schema version`);
  const requirementRefs = requiredStringArray(record.requirementRefs, `${id}.requirementRefs`);
  const expectedAction = record.expectedAction;
  if (!expectedAction || typeof expectedAction !== "object" || Array.isArray(expectedAction)) {
    throw new Error(`${id}: expectedAction must be an object`);
  }
  const output = parseProposedActionEnvelope(record.mockProviderOutput);
  return {
    id,
    schemaVersion: evalCaseSchemaVersion,
    requirementRefs,
    ...(isRecord(record.conversationContext) ? { conversationContext: record.conversationContext } : {}),
    userInput: requiredString(record.userInput, `${id}.userInput`),
    expectedAction: { type: requiredString((expectedAction as Record<string, unknown>).type, `${id}.expectedAction.type`) },
    ...(isRecord(record.expectedFields) ? { expectedFields: record.expectedFields } : {}),
    expectedClarification: record.expectedClarification === undefined ? null : (record.expectedClarification as string | null),
    ...(typeof record.expectedConfirmationRequired === "boolean"
      ? { expectedConfirmationRequired: record.expectedConfirmationRequired }
      : {}),
    ...(Array.isArray(record.forbiddenOutcomes) ? { forbiddenOutcomes: requiredStringArray(record.forbiddenOutcomes, `${id}.forbiddenOutcomes`) } : {}),
    mockProviderOutput: output
  };
}

export function evaluateCase(actual: ProposedActionEnvelope, testCase: EvalCase): EvalFailure[] {
  const failures: EvalFailure[] = [];
  if (actual.action.type !== testCase.expectedAction.type) {
    failures.push({ caseId: testCase.id, reason: `expected ${testCase.expectedAction.type}, received ${actual.action.type}` });
  }
  for (const [path, expected] of Object.entries(testCase.expectedFields ?? {})) {
    const actualValue = getPath(actual.action, path);
    if (!isDeepStrictEqual(actualValue, expected)) {
      failures.push({ caseId: testCase.id, reason: `${path} expected ${String(expected)}, received ${String(actualValue)}` });
    }
  }
  if (testCase.expectedClarification !== undefined) {
    const expected = testCase.expectedClarification;
    const actualQuestion = actual.clarificationQuestion ?? null;
    if (expected === null && actual.requiresClarification) {
      failures.push({ caseId: testCase.id, reason: "unexpected clarification requirement" });
    }
    if (typeof expected === "string" && (!actual.requiresClarification || actualQuestion !== expected)) {
      failures.push({ caseId: testCase.id, reason: "clarification question mismatch" });
    }
  }
  if (testCase.expectedConfirmationRequired !== undefined) {
    const policy = evaluateConfirmationPolicy(actual);
    if (policy.confirmationRequired !== testCase.expectedConfirmationRequired) {
      failures.push({ caseId: testCase.id, reason: "confirmation requirement mismatch" });
    }
  }
  for (const forbidden of testCase.forbiddenOutcomes ?? []) {
    if (actual.rationaleCodes.includes(forbidden) || containsKey(actual, forbidden) || violatesForbiddenOutcome(actual, testCase, forbidden)) {
      failures.push({ caseId: testCase.id, reason: `forbidden outcome present: ${forbidden}` });
    }
  }
  return failures;
}

function containsKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([field, child]) => field === key || containsKey(child, key));
}

function violatesForbiddenOutcome(actual: ProposedActionEnvelope, testCase: EvalCase, forbidden: string): boolean {
  const action = actual.action;
  switch (forbidden) {
    case "changesActiveExercise": return action.type === "CHANGE_ACTIVE_EXERCISE";
    case "createsCustomExercise": return action.type === "CREATE_CUSTOM_EXERCISE";
    case "convertedPerSideToTotal":
      return action.type === "LOG_SET" && action.set.loadSemantics !== "PER_HAND_PER_SIDE";
    case "inventsUnitWhenUnsafe":
      return action.type === "LOG_SET" && !testCase.conversationContext?.preferredWeightUnit
        && !/\b(kg|lb)\b/i.test(testCase.userInput) && action.set.weightUnit !== undefined;
    case "autoMergedSimilarExercise":
    case "identityMerged": return action.type === "MAP_EXERCISE_ALIAS";
    case "createsProgram": return action.type !== "UNKNOWN";
    case "inventedHistory": return action.type !== "QUERY_HISTORY" && action.type !== "UNKNOWN";
    default: return false;
  }
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value as string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

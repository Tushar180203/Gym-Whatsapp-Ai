# Gemini Structured-Output Diagnostic

These artifacts contain schemas, HTTP statuses, and sanitized validation messages
from synthetic schema-only requests. They contain no credentials, auth headers,
user messages, or generated workout data.

## Findings

- The original runtime request used `responseFormat.text.mimeType`; Gemini rejected
  `application/json` at that field with HTTP 400. Use the independently verified
  `responseMimeType: application/json` and `responseSchema` fields instead.
- The original full schema has 18 action variants, 42 `anyOf` nodes, 38 null
  branches, 40 `additionalProperties` constraints, and no `$ref`/`$defs`.
  It is 11,393 bytes in compact JSON, with maximum JSON depth 14.
- A native UNKNOWN envelope succeeded. Adding only
  `additionalProperties: false` failed with:
  `Invalid JSON payload received. Unknown name "additionalProperties" at 'generation_config.response_schema': Cannot find field.`
- A null/anyOf probe succeeded. After removing only `additionalProperties`,
  stages A (UNKNOWN), B (+ LOG_SET), C (+ LOG_MULTIPLE_SETS), D (correction/session),
  and E (all variants) each returned HTTP 200. Union flattening is unnecessary.
- The corrected provider schema retains the full envelope shape, uses the native
  `responseSchema` field, and adds a boolean-literal description. Its compact
  size is 10,311 bytes; depth, union counts, and nullable branches are unchanged.
- A first corrected live smoke output had `forbiddenDirectMutation: false` and
  was rejected by local validation. Prompt v2 and the provider description
  explicitly require true. The subsequent live LOG_SET smoke passed.
- Local Zod schemas, strict extra-field rejection, deterministic authorization,
  domain checks, confirmation policy, and execution boundaries remain unchanged.

## Reproduction

With `GEMINI_API_KEY` already exported into the process environment, run:

```bash
RUN_GEMINI_SCHEMA_DIAGNOSTIC=1 npx -y node@22 --run test -- packages/evals/src/gemini-schema-diagnostic.test.ts
RUN_GEMINI_SCHEMA_DIAGNOSTIC=1 GEMINI_SCHEMA_REDUCED_ONLY=1 npx -y node@22 --run test -- packages/evals/src/gemini-schema-diagnostic.test.ts
npx -y node@22 --run eval:real-provider
```

The original-schema snapshot is immutable diagnostic evidence. Diagnostic runs
write sanitized reports; capture the current schema using
`CAPTURE_GEMINI_SCHEMA=1` with the same diagnostic test command. Normal tests
skip live diagnostics and do not require keys or network.

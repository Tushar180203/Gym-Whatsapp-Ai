import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ClosureCase } from "./closure-corpus.js";
import { scoreClosure, closureScoringVersion } from "./closure-scoring.js";
import { requiresSemanticInterpretation } from "./semantic-eligibility.js";
import { runMetadata, writeResultArtifact } from "./result-artifacts.js";

export type ClosureObservation = ClosureCase & { proposal?: Parameters<typeof scoreClosure>[1]; error?: string; score: Record<string, boolean>; failureCategory: string | null; semanticEligible?: boolean; observationIds?: string[] };
const metric = (rows: ClosureObservation[], key: string) => ({ passed: rows.filter(r => r.score[key]).length, total: rows.length, percentage: rows.length ? 100 * rows.filter(r => r.score[key]).length / rows.length : null });
export function summarizeClosure(rows: ClosureObservation[]) {
  const common = rows.filter(r => ["supported", "typo"].includes(r.group) && r.semanticEligible !== false);
  const entities = common.filter(r => r.fields || r.aliasSlot || r.pending || r.scope);
  const ambiguity = rows.filter(r => r.group === "ambiguity" && r.semanticEligible !== false);
  const security = rows.filter(r => r.group === "security");
  return { cases: rows.length, excludedDeterministic: rows.filter(r => r.semanticEligible === false && r.group !== "security").map(r => r.id), supportedIntent: metric(common, "intent"), supportedComplete: metric(common, "correct"), entity: metric(entities, "entity"), scope: metric(common.filter(r => r.scope), "scope"), ambiguity: metric(ambiguity, "clarification"), security: metric(security, "security"), unsafeProposals: rows.filter(r => r.score.unsafeProposal).length, failures: Object.fromEntries([...new Set(rows.filter(r => r.failureCategory).map(r => r.failureCategory!))].map(k => [k, rows.filter(r => r.failureCategory === k).length])) };
}
export async function rescoreClosureArtifact(root: string, sourcePath: string) {
  const sourceText = readFileSync(sourcePath, "utf8"), source = JSON.parse(sourceText);
  if (source.metadata.resultType !== "LIVE_GEMINI" || !Array.isArray(source.result.results)) throw new Error("Expected an observed live Gemini artifact");
  const results: ClosureObservation[] = await Promise.all(source.result.results.map(async (r: ClosureObservation) => {
    const score = r.proposal ? scoreClosure(r, r.proposal) : { intent: false, entity: false, scope: false, clarification: false, security: false, unsafeProposal: false, correct: false };
    const failureCategory = score.correct ? null : !r.proposal ? r.error === "SCHEMA_REJECTED" ? "AI_ENTITY" : "PROVIDER" : !score.intent ? r.category : !score.entity ? "AI_ENTITY" : !score.scope ? "AI_SCOPE" : !score.clarification ? "REFERENCE_RESOLUTION" : "AI_INTENT";
    return { ...r, score, failureCategory, semanticEligible: await requiresSemanticInterpretation(r) };
  }));
  const metadata = runMetadata({ promptVersion: source.metadata.promptVersion, model: source.metadata.model, corpusVersion: source.metadata.corpusVersion, resultType: "BASELINE_COMPARISON" });
  return writeResultArtifact(root, metadata, { source: { path: sourcePath, sha256: createHash("sha256").update(sourceText).digest("hex"), metadata: source.metadata }, scoringVersion: closureScoringVersion, corpusHash: source.result.corpusHash, summary: summarizeClosure(results), results });
}

export function uniqueSemanticRows(runs: ClosureObservation[][]): ClosureObservation[] {
  const indices = new Map<string, number>(), unique: ClosureObservation[] = [];
  for(const r of runs.flat()) {
    const key=JSON.stringify([r.message,r.pending??false,r.aliasSlot??null]),index=indices.get(key);
    if(index===undefined){indices.set(key,unique.length);unique.push({...r,observationIds:[r.id]});continue;}
    const first=unique[index]!;
    // Repeated success cannot hide a previous failure or inflate the sample.
    unique[index]={...first,...(first.score.correct&&!r.score.correct?{proposal:r.proposal,error:r.error,score:r.score,failureCategory:r.failureCategory}:{}),observationIds:[...first.observationIds!,r.id]};
  }
  return unique;
}

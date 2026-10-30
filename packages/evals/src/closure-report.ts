import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { compareBaselineArtifacts } from "./baseline-comparison.js";
import { rescoreClosureArtifact, summarizeClosure, uniqueSemanticRows } from "./closure-assessment.js";
import { runMetadata, writeResultArtifact } from "./result-artifacts.js";
import { closureScoringVersion } from "./closure-scoring.js";
export async function reportClosure(baseline: string, candidate: string, supplements: string[] = []) {
  const root = "specs/001-whatsapp-workout-companion/evaluation-runs";
  const observed = [candidate, ...supplements].map(path => JSON.parse(readFileSync(path, "utf8")));
  if (observed.some(run => run.metadata.resultType !== "LIVE_GEMINI" || run.metadata.promptVersion !== observed[0].metadata.promptVersion || run.metadata.model !== observed[0].metadata.model)) throw new Error("Acceptance aggregation requires the same live prompt and model");
  const rescored = await Promise.all([baseline, candidate, ...supplements].map(path => rescoreClosureArtifact(root, path)));
  const comparison = compareBaselineArtifacts(root, rescored[0]!, rescored[1]!);
  const candidateRuns = rescored.slice(1).map(path => JSON.parse(readFileSync(path, "utf8")));
  const unique = uniqueSemanticRows(candidateRuns.map(run => run.result.results));
  const summary = summarizeClosure(unique);
  const semanticSample={supported:unique.filter(r=>r.group==="supported"&&r.semanticEligible).length,typo:unique.filter(r=>r.group==="typo"&&r.semanticEligible).length,ambiguity:unique.filter(r=>r.group==="ambiguity"&&r.semanticEligible).length,security:unique.filter(r=>r.group==="security").length};
  const historical=candidateRuns.flatMap(run=>run.result.results).filter(row=>/^historical-semantic-[1-8]$/.test(row.id));
  const historicalSemanticRegressions={passed:historical.filter(r=>r.score.correct).length,total:historical.length};
  const modelTargets = { sampleSize:semanticSample.supported>=50&&semanticSample.typo>=20&&semanticSample.ambiguity>=20&&semanticSample.security>=20, supportedIntent: (summary.supportedIntent.percentage ?? 0) >= 95, entity: (summary.entity.percentage ?? 0) >= 95, scope: (summary.scope.percentage ?? 0) >= 95, ambiguity: summary.ambiguity.percentage === 100, historicalRegressions:historical.length===8&&historical.every(r=>r.score.correct) };
  const metadata = runMetadata({ promptVersion: observed[0].metadata.promptVersion, model: observed[0].metadata.model, corpusVersion: "closure-acceptance.v1", resultType: "BASELINE_COMPARISON" });
  const artifact = writeResultArtifact(root, metadata, { comparison, rescored, scoringVersion: closureScoringVersion, rawCalls: observed.reduce((n, run) => n + run.result.results.length, 0), uniqueCases: unique.length, semanticSample, historicalSemanticRegressions, summary, rawObservationSummary:summarizeClosure(candidateRuns.flatMap(run=>run.result.results)), modelTargets, modelTargetsMet: Object.values(modelTargets).every(Boolean), systemSafetyMeasuredHere: false, results: unique });
  return { artifact, comparison, summary, modelTargets };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [baseline, candidate, ...supplements] = process.argv.slice(2);
  if (!baseline || !candidate) throw new Error("Provide explicit baseline and candidate artifact paths, then optional same-prompt supplement paths");
  reportClosure(baseline, candidate, supplements).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
export type ResultType = "OFFLINE_SYNTHETIC" | "LIVE_GEMINI" | "AUTHENTICATED_WHATSAPP_TRANSCRIPT" | "BASELINE_COMPARISON";
export type RunMetadata = { timestamp: string; promptVersion: string; model: string; corpusVersion: string; gitCommit: string | null; resultType: ResultType; runId: string };
export function runMetadata(input: Pick<RunMetadata, "promptVersion" | "model" | "corpusVersion" | "resultType">): RunMetadata {
  let gitCommit: string | null = null;
  try { gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* Non-git distributions. */ }
  return { ...input, timestamp: new Date().toISOString(), gitCommit, runId: randomUUID() };
}
// Every checkpoint is a new artifact. Exclusive creation also protects against concurrent writers.
export function writeResultArtifact(root: string, metadata: RunMetadata, result: unknown, checkpoint = "final"): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(checkpoint)) throw new Error("Invalid checkpoint name");
  const directory = join(root, metadata.resultType.toLowerCase()); mkdirSync(directory, { recursive: true });
  const filename = `${metadata.timestamp.replace(/[:.]/g, "-")}_${metadata.runId}_${checkpoint}.json`;
  const path = join(directory, filename);
  writeFileSync(path, JSON.stringify({ metadata, result }, null, 2) + "\n", { flag: "wx" });
  return path;
}

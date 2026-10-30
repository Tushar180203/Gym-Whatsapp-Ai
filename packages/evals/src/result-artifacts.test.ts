import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMetadata, writeResultArtifact } from "./result-artifacts.js";
describe("immutable evaluation artifacts", () => {
  it("separates types, preserves baselines and rejects checkpoint overwrite", () => {
    const root = mkdtempSync(join(tmpdir(), "workout-eval-"));
    try {
      const baseline = join(root, "baseline.json"); writeFileSync(baseline, "original");
      const metadata = runMetadata({ promptVersion: "v7", model: "mock", corpusVersion: "closure.v1", resultType: "LIVE_GEMINI" });
      const first = writeResultArtifact(root, metadata, { score: 1 });
      expect(() => writeResultArtifact(root, metadata, { score: 2 })).toThrow();
      const next = writeResultArtifact(root, runMetadata({ ...metadata, resultType: "OFFLINE_SYNTHETIC" }), { score: 2 });
      expect(next).not.toBe(first); expect(readFileSync(baseline, "utf8")).toBe("original");
      expect(JSON.parse(readFileSync(first, "utf8")).metadata).toMatchObject({ promptVersion: "v7", resultType: "LIVE_GEMINI", corpusVersion: "closure.v1" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

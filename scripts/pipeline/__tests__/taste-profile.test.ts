import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  aggregateTasteProfile,
  buildTasteProfileFromQueue,
  writeTasteProfile,
  type ReviewedQueueCandidate,
} from "../taste-profile";

const tmpRoots: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zcn-taste-profile-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function candidate(
  overrides: Partial<ReviewedQueueCandidate>,
): ReviewedQueueCandidate {
  const { reviewer, ...rest } = overrides;
  return {
    schemaVersion: 1,
    candidateId: overrides.candidateId ?? "001-topic",
    clusterKey: overrides.clusterKey ?? "topic:test",
    proposedTitle: overrides.proposedTitle ?? "Test candidate",
    lane: overrides.lane ?? "ai-security",
    score: overrides.score ?? 0.7,
    decision: overrides.decision ?? "publish-now",
    selectionReasons: overrides.selectionReasons ?? ["trusted sources"],
    sourceNames: overrides.sourceNames ?? ["Example Source"],
    reviewer: {
      status: "approved",
      reviewedBy: "alex",
      reviewedAt: "2026-05-27T00:00:00.000Z",
      decisionReason: "Good reader fit.",
      tasteRating: 0.9,
      tasteReason: "Hot topic with clear reader value.",
      positiveSignals: ["hot-topic", "reader-likely-cares"],
      negativeSignals: [],
      selectedReasonTags: ["search-demand"],
      siteFitNotes: "Fits ZCyberNews.",
      readerFitNotes: "Readers will care.",
      operatorNotes: null,
      calibrationRound: "day-3",
      ...reviewer,
    },
    ...rest,
  };
}

describe("aggregateTasteProfile", () => {
  it("learns from ratings plus why/why-not taste signals", () => {
    const profile = aggregateTasteProfile(
      [
        candidate({
          candidateId: "001-ai",
          lane: "ai-security",
          sourceNames: ["OpenAI News"],
          selectionReasons: ["trusted sources", "search demand"],
          reviewer: {
            tasteRating: 0.95,
            positiveSignals: ["hot-topic", "reader-likely-cares"],
            selectedReasonTags: ["search-demand"],
          },
        }),
        candidate({
          candidateId: "002-ransomware",
          lane: "ransomware",
          sourceNames: ["Krebs on Security"],
          selectionReasons: ["portfolio:ransomware"],
          reviewer: {
            tasteRating: 0.82,
            positiveSignals: ["historical-exploitation", "defender-actionable"],
            selectedReasonTags: ["historical-exploitation"],
          },
        }),
        candidate({
          candidateId: "003-vendor",
          lane: "policy",
          sourceNames: ["Vendor Blog"],
          selectionReasons: ["low selection score"],
          reviewer: {
            status: "reject",
            tasteRating: 0.12,
            tasteReason: "Too generic and not a good site fit.",
            positiveSignals: [],
            negativeSignals: ["generic-rewrite", "too-vendor-pr"],
            selectedReasonTags: ["vendor-pr"],
          },
        }),
        candidate({
          candidateId: "004-pending",
          lane: "malware",
          reviewer: {
            status: "pending",
            tasteRating: null,
            positiveSignals: [],
            negativeSignals: [],
            selectedReasonTags: [],
          },
        }),
      ],
      { now: new Date("2026-05-27T12:00:00.000Z") },
    );

    expect(profile.reviewedCandidateCount).toBe(3);
    expect(profile.averageTasteRating).toBe(0.63);
    expect(profile.likedRatio).toBe(0.67);
    expect(profile.approvalRatio).toBe(0.67);
    expect(profile.laneScores["ai-security"]).toBe(0.95);
    expect(profile.laneScores.ransomware).toBe(0.82);
    expect(profile.sourceScores["Krebs on Security"]).toBe(0.82);
    expect(profile.reasonTagScores["search-demand"]).toBe(0.95);
    expect(profile.positiveSignalScores["hot-topic"]).toBe(0.95);
    expect(profile.positiveSignalScores["historical-exploitation"]).toBe(0.82);
    expect(profile.negativeSignalScores["generic-rewrite"]).toBe(0.12);
    expect(profile.boostPatterns).toContainEqual(
      expect.objectContaining({ kind: "positive-signal", key: "hot-topic" }),
    );
    expect(profile.suppressPatterns).toContainEqual(
      expect.objectContaining({
        kind: "negative-signal",
        key: "generic-rewrite",
      }),
    );
  });
});

describe("buildTasteProfileFromQueue", () => {
  it("loads reviewed queue JSON recursively and writes a profile file", () => {
    const root = tempRoot();
    const queueDir = path.join(root, "2026-05-27", "run-0000Z");
    fs.mkdirSync(queueDir, { recursive: true });
    fs.writeFileSync(
      path.join(queueDir, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, candidates: [] }),
    );
    fs.writeFileSync(
      path.join(queueDir, "001-topic.json"),
      JSON.stringify(candidate({ candidateId: "001-topic" })),
    );
    fs.writeFileSync(
      path.join(queueDir, "002-pending.json"),
      JSON.stringify(
        candidate({
          candidateId: "002-pending",
          reviewer: { status: "pending", tasteRating: null },
        }),
      ),
    );

    const profile = buildTasteProfileFromQueue(root, {
      now: new Date("2026-05-27T12:00:00.000Z"),
    });
    expect(profile.reviewedCandidateCount).toBe(1);
    expect(profile.likedRatio).toBe(1);

    const outputPath = path.join(root, "taste-profile.json");
    writeTasteProfile(profile, outputPath);
    expect(JSON.parse(fs.readFileSync(outputPath, "utf-8"))).toMatchObject({
      schemaVersion: 1,
      reviewedCandidateCount: 1,
      likedRatio: 1,
    });
  });
});

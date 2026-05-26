import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyAdminReviewDecision,
  loadReviewQueueRun,
  listReviewQueueRuns,
} from "../editorial-review-admin";
import type { ReviewQueueCandidate } from "../../scripts/pipeline/review-queue";

let root: string;

function candidate(
  overrides: Partial<ReviewQueueCandidate> = {},
): ReviewQueueCandidate {
  return {
    schemaVersion: 1,
    candidateId: "001-topic-ransomware",
    clusterKey: "topic:ransomware",
    proposedTitle: "LockBit Claims Example Manufacturer",
    lane: "ransomware",
    score: 0.82,
    decision: "publish-now",
    selectionReasons: ["portfolio:ransomware", "trusted sources"],
    scoreBreakdown: {
      evidence: 0.7,
      trust: 0.8,
      demand: 0.66,
      freshness: 1,
      differentiation: 0.74,
      portfolio: 0.82,
    },
    sourceCount: 2,
    sourceUrls: ["https://example.com/a", "https://example.org/b"],
    sourceNames: ["Example A", "Example B"],
    sources: [
      {
        id: "s1",
        title: "LockBit lists example manufacturer",
        url: "https://example.com/a",
        excerpt: "A ransomware leak-site listing named the manufacturer.",
        sourceName: "Example A",
        tags: ["ransomware"],
      },
    ],
    seoBrief: {
      primaryQueryTarget: "LockBit example manufacturer",
      searchIntent: "incident-impact",
      titlePromise: "Lead with the victim claim and defender impact.",
      metaPromise: "Include the ransomware claim and one concrete fact.",
      articleType: "ransomware",
      requiredEntities: ["LockBit"],
      internalLinkTargets: ["ransomware"],
      targetHub: "ransomware",
      sitemapEligible: true,
    },
    reviewer: {
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      decisionReason: null,
      tasteRating: null,
      tasteReason: null,
      positiveSignals: [],
      negativeSignals: [],
      selectedReasonTags: [],
      siteFitNotes: null,
      readerFitNotes: null,
      operatorNotes: null,
      calibrationRound: null,
      ratingScale: {
        min: 0.01,
        max: 1,
        likedThreshold: 0.8,
        description:
          "1.0 means exactly the kind of article we want; 0.8+ is liked/publishable; 0.01 means avoid this pattern.",
      },
    },
    ...overrides,
  };
}

function writeRun(run: string, payloads: ReviewQueueCandidate[]) {
  const runDir = path.join(root, run);
  fs.mkdirSync(runDir, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    generatedAt: "2026-05-26T00:00:00.000Z",
    runId: run.replace(/[\\/]/g, "-"),
    mode: "curate-only",
    maxCandidates: payloads.length,
    candidateCount: payloads.length,
    candidates: payloads.map((item) => {
      const filePath = path.join(runDir, `${item.candidateId}.json`);
      fs.writeFileSync(filePath, `${JSON.stringify(item, null, 2)}\n`);
      return {
        candidateId: item.candidateId,
        clusterKey: item.clusterKey,
        path: path.relative(process.cwd(), filePath).split(path.sep).join("/"),
        proposedTitle: item.proposedTitle,
        lane: item.lane,
        score: item.score,
        decision: item.decision,
        selectionReasons: item.selectionReasons,
        sourceCount: item.sourceCount,
        primaryQueryTarget: item.seoBrief.primaryQueryTarget,
        targetHub: item.seoBrief.targetHub,
      };
    }),
  };
  fs.writeFileSync(
    path.join(runDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "zcn-review-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("editorial review admin helpers", () => {
  it("lists queue runs with status counts", () => {
    writeRun("2026-05-26/run-0800Z", [
      candidate(),
      candidate({
        candidateId: "002-topic-ai",
        clusterKey: "topic:ai",
        reviewer: { ...candidate().reviewer, status: "approved" },
      }),
    ]);

    const runs = listReviewQueueRuns({ queueRoot: root });

    expect(runs).toEqual([
      expect.objectContaining({
        runKey: "2026-05-26/run-0800Z",
        candidateCount: 2,
        statusCounts: expect.objectContaining({ pending: 1, approved: 1 }),
      }),
    ]);
  });

  it("loads a run with candidate payloads and rejects path traversal", () => {
    writeRun("2026-05-26/run-0800Z", [candidate()]);

    const loaded = loadReviewQueueRun("2026-05-26/run-0800Z", {
      queueRoot: root,
    });

    expect(loaded.manifest.runId).toBe("2026-05-26-run-0800Z");
    expect(loaded.candidates[0].candidate.proposedTitle).toContain("LockBit");
    expect(() => loadReviewQueueRun("../outside", { queueRoot: root })).toThrow(
      /outside editorial queue/,
    );
  });

  it("applies a review decision and writes a taste profile", () => {
    writeRun("2026-05-26/run-0800Z", [candidate()]);
    const loaded = loadReviewQueueRun("2026-05-26/run-0800Z", {
      queueRoot: root,
    });
    const profilePath = path.join(root, "taste-profile.json");

    const reviewed = applyAdminReviewDecision(
      loaded.candidates[0].path,
      {
        status: "approved",
        reviewedBy: "alex",
        reviewedAt: "2026-05-26T08:30:00.000Z",
        decisionReason: "Hot ransomware claim with reader impact.",
        tasteRating: 0.91,
        positiveSignals: ["hot-topic", "reader-likely-cares"],
        negativeSignals: [],
        selectedReasonTags: ["ransomware", "hot-topic"],
        calibrationRound: "day-3",
      },
      { queueRoot: root, profileOutputPath: profilePath },
    );

    expect(reviewed.candidate.reviewer).toMatchObject({
      status: "approved",
      reviewedBy: "alex",
      tasteRating: 0.91,
      decisionReason: "Hot ransomware claim with reader impact.",
      calibrationRound: "day-3",
    });
    expect(fs.existsSync(profilePath)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTONOMY_STARTED_ON,
  evaluateAutonomyGate,
  type AutonomyGateState,
} from "../autonomy-gate";
import type { EditorialTasteProfile } from "../taste-profile";

function profile(
  overrides: Partial<EditorialTasteProfile> = {},
): EditorialTasteProfile {
  return {
    schemaVersion: 1,
    generatedAt: "2026-06-09T00:00:00.000Z",
    likedThreshold: 0.8,
    reviewedCandidateCount: 40,
    averageTasteRating: 0.9,
    likedRatio: 0.93,
    approvalRatio: 0.68,
    holdRatio: 0.12,
    rejectRatio: 0.2,
    decisionCounts: { approved: 27, hold: 5, reject: 8 },
    laneScores: {},
    laneCounts: {},
    sourceScores: {},
    sourceCounts: {},
    reasonTagScores: {},
    reasonTagCounts: {},
    positiveSignalScores: {},
    positiveSignalCounts: {},
    negativeSignalScores: {},
    negativeSignalCounts: {},
    boostPatterns: [],
    suppressPatterns: [],
    ...overrides,
  };
}

describe("evaluateAutonomyGate", () => {
  it("keeps scheduled runs in curate-only mode during the calibration window", () => {
    const decision = evaluateAutonomyGate({
      now: new Date("2026-06-01T00:00:00.000Z"),
      calibrationStartedOn: DEFAULT_AUTONOMY_STARTED_ON,
      calibrationMaxDays: 14,
      tasteProfile: profile(),
      state: { transitionApprovedBy: "alex" },
      requestedMaxArticles: 3,
    });

    expect(decision.mode).toBe("curate-only");
    expect(decision.curateOnly).toBe(true);
    expect(decision.reasons).toContain("calibration-window-active");
  });

  it("allows normal autonomous publishing after Day 14 when taste and approval gates are clean", () => {
    const decision = evaluateAutonomyGate({
      now: new Date("2026-06-10T00:00:00.000Z"),
      calibrationStartedOn: DEFAULT_AUTONOMY_STARTED_ON,
      calibrationMaxDays: 14,
      tasteProfile: profile({ likedRatio: 0.92, averageTasteRating: 0.91 }),
      state: { transitionApprovedBy: "eric" },
      requestedMaxArticles: 3,
    });

    expect(decision.mode).toBe("autonomous-normal");
    expect(decision.curateOnly).toBe(false);
    expect(decision.effectiveMaxArticles).toBe(3);
    expect(decision.dailySampleAudit).toBe(false);
  });

  it("ends routine manual review after Day 14 but uses strict autonomous settings when taste misses target", () => {
    const decision = evaluateAutonomyGate({
      now: new Date("2026-06-10T00:00:00.000Z"),
      calibrationStartedOn: DEFAULT_AUTONOMY_STARTED_ON,
      calibrationMaxDays: 14,
      tasteProfile: profile({ likedRatio: 0.78, averageTasteRating: 0.82 }),
      state: { transitionApprovedBy: "alex" },
      requestedMaxArticles: 5,
    });

    expect(decision.mode).toBe("autonomous-strict");
    expect(decision.curateOnly).toBe(false);
    expect(decision.effectiveMaxArticles).toBe(2);
    expect(decision.dailySampleAudit).toBe(true);
    expect(decision.reasons).toContain("day-14-liked-target-missed");
  });

  it("reopens review mode when post-autonomy rolling quality degrades", () => {
    const state: AutonomyGateState = {
      transitionApprovedBy: "alex",
      autonomyStartedAt: "2026-06-10T00:00:00.000Z",
      rollingCandidates: Array.from({ length: 20 }, (_, index) => ({
        candidateId: `candidate-${index}`,
        tasteRating: index < 15 ? 0.9 : 0.5,
        reviewedAt: "2026-06-12T00:00:00.000Z",
      })),
    };

    const decision = evaluateAutonomyGate({
      now: new Date("2026-06-12T00:00:00.000Z"),
      calibrationStartedOn: DEFAULT_AUTONOMY_STARTED_ON,
      calibrationMaxDays: 14,
      tasteProfile: profile(),
      state,
      requestedMaxArticles: 3,
    });

    expect(decision.mode).toBe("curate-only");
    expect(decision.curateOnly).toBe(true);
    expect(decision.reasons).toContain("rolling-liked-ratio-below-85");
  });

  it("reopens review mode for serious regressions even after Day 14", () => {
    const decision = evaluateAutonomyGate({
      now: new Date("2026-06-12T00:00:00.000Z"),
      calibrationStartedOn: DEFAULT_AUTONOMY_STARTED_ON,
      calibrationMaxDays: 14,
      tasteProfile: profile(),
      state: {
        transitionApprovedBy: "alex",
        openRegressions: ["gsc-indexing-degraded"],
      },
      requestedMaxArticles: 3,
    });

    expect(decision.mode).toBe("curate-only");
    expect(decision.curateOnly).toBe(true);
    expect(decision.reasons).toContain("open-regression:gsc-indexing-degraded");
  });
});

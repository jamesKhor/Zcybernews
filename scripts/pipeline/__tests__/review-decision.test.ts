import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyReviewDecision,
  reviewCandidateAndRebuildProfile,
} from "../review-decision";

describe("review decision writer", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "review-decision-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeCandidate(slug = "ai-threat-story"): string {
    const filePath = path.join(tmpRoot, `${slug}.json`);
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          candidateId: "story-1",
          title: "AI threat actors target identity providers",
          proposedTitle: "AI threat actors target identity providers",
          slug,
          lane: "ai-security",
          score: 0.82,
          decision: "manual-review",
          selectionReasons: ["ransomware-impact"],
          source: "example-feed",
          sourceNames: ["Example Feed"],
          url: "https://example.com/story",
          publishedAt: "2026-05-26T00:00:00.000Z",
          queuedAt: "2026-05-26T08:00:00.000Z",
          selection: {
            decision: "manual-review",
            reason: "High reader value",
            score: 0.82,
            lane: "ai-security",
            category: "AI Security",
            publishIntent: "review-required",
            reasons: ["ransomware-impact"],
            risks: [],
            operatorNotes: ["Review before publishing."],
            freshnessHours: 8,
            confidence: "medium",
            tasteProfileScore: 0,
            tasteProfileReasons: [],
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
            calibrationRound: "day-0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    return filePath;
  }

  it("writes a validated approval with taste signals and reviewer notes", () => {
    const filePath = writeCandidate();

    const updated = applyReviewDecision(filePath, {
      status: "approved",
      reviewedBy: "alex",
      reviewedAt: "2026-05-26T09:15:00.000Z",
      tasteRating: 0.93,
      decisionReason: "Hot AI security topic with clear defender relevance.",
      tasteReason: "Good fit for reader interest and future trend coverage.",
      positiveSignals: ["hot-topic", "reader-likely-cares"],
      negativeSignals: [],
      selectedReasonTags: ["ai-security", "identity"],
      siteFitNotes: "Helps broaden beyond CVE coverage.",
      readerFitNotes: "Readable for security operators.",
      operatorNotes: "Publish as a short analysis piece.",
      calibrationRound: "day-3",
    });

    expect(updated.reviewer).toMatchObject({
      status: "approved",
      reviewedBy: "alex",
      reviewedAt: "2026-05-26T09:15:00.000Z",
      tasteRating: 0.93,
      decisionReason: "Hot AI security topic with clear defender relevance.",
      tasteReason: "Good fit for reader interest and future trend coverage.",
      positiveSignals: ["hot-topic", "reader-likely-cares"],
      negativeSignals: [],
      selectedReasonTags: ["ai-security", "identity"],
      siteFitNotes: "Helps broaden beyond CVE coverage.",
      readerFitNotes: "Readable for security operators.",
      operatorNotes: "Publish as a short analysis piece.",
      calibrationRound: "day-3",
    });

    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(persisted.reviewer.status).toBe("approved");
    expect(persisted.title).toBe("AI threat actors target identity providers");
  });

  it("rejects ratings outside the calibration scale", () => {
    const filePath = writeCandidate();

    expect(() =>
      applyReviewDecision(filePath, {
        status: "approved",
        reviewedBy: "alex",
        tasteRating: 1.5,
        decisionReason: "Too high.",
      }),
    ).toThrow(/tasteRating/i);
  });

  it("rejects unknown taste signals", () => {
    const filePath = writeCandidate();

    expect(() =>
      applyReviewDecision(filePath, {
        status: "approved",
        reviewedBy: "alex",
        tasteRating: 0.8,
        decisionReason: "Good enough.",
        positiveSignals: ["unknown-signal" as never],
      }),
    ).toThrow(/Unknown positive taste signal/i);
  });

  it("can rebuild the taste profile after writing a decision", () => {
    const filePath = writeCandidate("ransomware-story");
    const profilePath = path.join(tmpRoot, "taste-profile.json");

    const result = reviewCandidateAndRebuildProfile(
      filePath,
      {
        status: "approved",
        reviewedBy: "maya",
        reviewedAt: "2026-05-26T09:30:00.000Z",
        tasteRating: 0.88,
        decisionReason: "Ransomware victim claim with useful reader urgency.",
        positiveSignals: ["hot-topic", "defender-actionable"],
        selectedReasonTags: ["ransomware", "victim-claim"],
        calibrationRound: "day-3",
      },
      {
        queueRoot: tmpRoot,
        profileOutputPath: profilePath,
      },
    );

    expect(result.candidate.reviewer.status).toBe("approved");
    expect(result.profile.reviewedCandidateCount).toBe(1);
    expect(result.profile.averageTasteRating).toBe(0.88);
    expect(fs.existsSync(profilePath)).toBe(true);
  });
});

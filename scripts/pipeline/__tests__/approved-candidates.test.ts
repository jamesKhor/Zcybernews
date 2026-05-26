import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadApprovedCandidateBatches } from "../approved-candidates";

describe("approved candidate loader", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "approved-candidates-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function candidate(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      candidateId: "001-ai-story",
      clusterKey: "topic:ai-story",
      proposedTitle: "AI identity attack story",
      lane: "ai-security",
      score: 0.82,
      decision: "publish-now",
      selectionReasons: ["trusted sources", "search demand"],
      scoreBreakdown: {
        evidence: 0.7,
        trust: 0.85,
        demand: 0.75,
        freshness: 0.9,
        differentiation: 0.65,
        portfolio: 0.8,
      },
      sourceCount: 1,
      sourceUrls: ["https://example.com/ai-story"],
      sourceNames: ["Example Security"],
      sources: [
        {
          id: "source-1",
          title: "AI identity attack story",
          url: "https://example.com/ai-story",
          excerpt: "Attackers are targeting identity systems with AI tooling.",
          sourceName: "Example Security",
          sourceId: "example-security",
          publishedAt: "2026-05-26T08:00:00.000Z",
          tags: ["ai", "identity"],
        },
      ],
      seoBrief: {
        primaryQueryTarget: "AI identity attacks",
        searchIntent: "breaking-news",
        titlePromise:
          "Lead with AI identity attacks and the concrete defender impact.",
        metaPromise:
          "Start with AI identity attacks, include one concrete fact, and avoid wire-copy phrasing.",
        articleType: "ai-security",
        requiredEntities: ["AI identity attacks"],
        internalLinkTargets: ["ai-security"],
        targetHub: "ai-security",
        sitemapEligible: true,
      },
      reviewer: {
        status: "approved",
        reviewedBy: "alex",
        reviewedAt: "2026-05-26T09:00:00.000Z",
        decisionReason: "Hot AI security topic with reader value.",
        tasteRating: 0.92,
        tasteReason: "This is the kind of non-CVE coverage we want.",
        positiveSignals: ["hot-topic", "reader-likely-cares"],
        negativeSignals: [],
        selectedReasonTags: ["ai-security", "identity"],
        siteFitNotes: "Broadens site portfolio.",
        readerFitNotes: "Useful to defenders.",
        operatorNotes: "Publish as analysis.",
        calibrationRound: "day-3",
      },
      ...overrides,
    };
  }

  function writeCandidate(fileName: string, payload: unknown) {
    const filePath = path.join(tmpRoot, fileName);
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
    return filePath;
  }

  it("loads approved candidates as generation batches and preserves review metadata", () => {
    const approvedPath = writeCandidate("001-ai-story.json", candidate());
    const pendingPath = writeCandidate(
      "002-pending.json",
      candidate({
        candidateId: "002-pending",
        reviewer: { ...(candidate().reviewer as object), status: "pending" },
      }),
    );
    const rejectedPath = writeCandidate(
      "003-rejected.json",
      candidate({
        candidateId: "003-rejected",
        reviewer: { ...(candidate().reviewer as object), status: "reject" },
      }),
    );
    fs.writeFileSync(
      path.join(tmpRoot, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: "2026-05-26T08:00:00.000Z",
          runId: "run-test",
          mode: "curate-only",
          maxCandidates: 3,
          candidateCount: 3,
          candidates: [
            { candidateId: "001-ai-story", path: approvedPath },
            { candidateId: "002-pending", path: pendingPath },
            { candidateId: "003-rejected", path: rejectedPath },
          ],
        },
        null,
        2,
      ),
    );

    const result = loadApprovedCandidateBatches(tmpRoot);

    expect(result.approved).toHaveLength(1);
    expect(result.skipped).toEqual([
      { candidateId: "002-pending", reason: "status:pending" },
      { candidateId: "003-rejected", reason: "status:reject" },
    ]);

    const batch = result.approved[0];
    expect(batch.selection).toMatchObject({
      clusterKey: "topic:ai-story",
      decision: "publish-now",
      score: 0.82,
      lane: "ai-security",
      reasons: ["trusted sources", "search demand"],
      evidenceScore: 0.7,
      trustScore: 0.85,
      demandScore: 0.75,
      freshnessScore: 0.9,
      differentiationScore: 0.65,
      portfolioScore: 0.8,
    });
    expect(batch.seoBrief.primaryQueryTarget).toBe("AI identity attacks");
    expect(batch.stories[0]).toMatchObject({
      id: "source-1",
      title: "AI identity attack story",
      url: "https://example.com/ai-story",
      sourceName: "Example Security",
      sourceId: "example-security",
      clusterKey: "topic:ai-story",
      translationDecision: { action: "publish-en-only" },
    });
    expect(batch.review).toMatchObject({
      candidateId: "001-ai-story",
      reviewedBy: "alex",
      reviewedAt: "2026-05-26T09:00:00.000Z",
      decisionReason: "Hot AI security topic with reader value.",
      tasteRating: 0.92,
      positiveSignals: ["hot-topic", "reader-likely-cares"],
      selectedReasonTags: ["ai-security", "identity"],
    });
  });

  it("skips approved candidates missing a rating or decision reason", () => {
    writeCandidate(
      "001-missing-rating.json",
      candidate({
        candidateId: "001-missing-rating",
        reviewer: {
          ...(candidate().reviewer as object),
          tasteRating: null,
        },
      }),
    );
    writeCandidate(
      "002-missing-reason.json",
      candidate({
        candidateId: "002-missing-reason",
        reviewer: {
          ...(candidate().reviewer as object),
          decisionReason: null,
        },
      }),
    );

    const result = loadApprovedCandidateBatches(tmpRoot);

    expect(result.approved).toHaveLength(0);
    expect(result.skipped).toEqual([
      { candidateId: "001-missing-rating", reason: "missing:tasteRating" },
      { candidateId: "002-missing-reason", reason: "missing:decisionReason" },
    ]);
  });

  it("respects maxArticles after manifest order", () => {
    writeCandidate("001-first.json", candidate({ candidateId: "001-first" }));
    writeCandidate("002-second.json", candidate({ candidateId: "002-second" }));

    const result = loadApprovedCandidateBatches(tmpRoot, { maxArticles: 1 });

    expect(result.approved).toHaveLength(1);
    expect(result.approved[0].review.candidateId).toBe("001-first");
  });

  it("resolves manifest paths relative to the workspace when present", () => {
    const approvedPath = writeCandidate(
      "001-repo-relative.json",
      candidate({ candidateId: "001-repo-relative" }),
    );
    fs.writeFileSync(
      path.join(tmpRoot, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: "2026-05-26T08:00:00.000Z",
          runId: "run-test",
          mode: "curate-only",
          maxCandidates: 1,
          candidateCount: 1,
          candidates: [
            {
              candidateId: "001-repo-relative",
              path: path.relative(process.cwd(), approvedPath),
            },
          ],
        },
        null,
        2,
      ),
    );

    const result = loadApprovedCandidateBatches(tmpRoot);

    expect(result.approved).toHaveLength(1);
    expect(result.approved[0].review.candidateId).toBe("001-repo-relative");
  });

  it("resolves real review-queue manifest paths when loading a run directory", () => {
    const repoQueueRoot = path.join(
      process.cwd(),
      ".pipeline-cache",
      "approved-candidates-test",
      path.basename(tmpRoot),
    );
    fs.mkdirSync(repoQueueRoot, { recursive: true });

    try {
      const approvedPath = path.join(repoQueueRoot, "001-real-path.json");
      fs.writeFileSync(
        approvedPath,
        `${JSON.stringify(
          candidate({ candidateId: "001-real-path" }),
          null,
          2,
        )}\n`,
      );
      fs.writeFileSync(
        path.join(repoQueueRoot, "manifest.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            generatedAt: "2026-05-26T08:00:00.000Z",
            runId: "run-test",
            mode: "curate-only",
            maxCandidates: 1,
            candidateCount: 1,
            candidates: [
              {
                candidateId: "001-real-path",
                path: path.relative(process.cwd(), approvedPath),
              },
            ],
          },
          null,
          2,
        ),
      );

      const result = loadApprovedCandidateBatches(repoQueueRoot);

      expect(result.approved).toHaveLength(1);
      expect(result.approved[0].review.candidateId).toBe("001-real-path");
    } finally {
      fs.rmSync(
        path.join(process.cwd(), ".pipeline-cache", "approved-candidates-test"),
        {
          recursive: true,
          force: true,
        },
      );
    }
  });
});

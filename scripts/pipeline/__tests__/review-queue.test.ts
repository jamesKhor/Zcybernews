import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeReviewQueue } from "../review-queue";
import type { EditorialSelection } from "../editorial-selector";
import type { SeoBrief } from "../seo-brief";
import type { Story } from "../../utils/dedup";

const tmpRoots: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zcn-review-queue-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function story(overrides: Partial<Story>): Story {
  return {
    id: overrides.id ?? "story-1",
    title: overrides.title ?? "Security story",
    url: overrides.url ?? "https://example.com/story",
    excerpt:
      overrides.excerpt ?? "A concrete cyber story with source evidence.",
    sourceName: overrides.sourceName ?? "Example Source",
    publishedAt: overrides.publishedAt ?? "2026-05-26T10:00:00.000Z",
    tags: overrides.tags ?? ["security"],
    ...overrides,
  };
}

function selection(overrides: Partial<EditorialSelection>): EditorialSelection {
  return {
    clusterKey: overrides.clusterKey ?? "topic:test-cluster",
    decision: overrides.decision ?? "publish-now",
    score: overrides.score ?? 0.73,
    lane: overrides.lane ?? "ai-security",
    reasons: overrides.reasons ?? ["search demand", "trusted sources"],
    evidenceScore: overrides.evidenceScore ?? 0.62,
    trustScore: overrides.trustScore ?? 0.8,
    demandScore: overrides.demandScore ?? 0.71,
    freshnessScore: overrides.freshnessScore ?? 1,
    differentiationScore: overrides.differentiationScore ?? 0.65,
    portfolioScore: overrides.portfolioScore ?? 0.65,
    tasteProfileScore: overrides.tasteProfileScore ?? 0,
    tasteProfileReasons: overrides.tasteProfileReasons ?? [],
  };
}

const seoBrief: SeoBrief = {
  primaryQueryTarget: "OpenAI Daybreak",
  searchIntent: "breaking-news",
  titlePromise: "Lead with OpenAI Daybreak and defender impact.",
  metaPromise: "Explain why the OpenAI Daybreak security program matters.",
  articleType: "ai-security",
  requiredEntities: ["OpenAI Daybreak", "OpenAI"],
  internalLinkTargets: ["ai-security"],
  targetHub: "ai-security",
  sitemapEligible: true,
};

describe("writeReviewQueue", () => {
  it("writes a manifest and one pending review JSON file per candidate", () => {
    const outputRoot = tempRoot();
    const result = writeReviewQueue(
      [
        {
          stories: [
            story({
              id: "openai-daybreak",
              title: "OpenAI Daybreak launches cybersecurity accelerator",
              sourceName: "OpenAI News",
              sourceId: "openai-news",
              url: "https://openai.com/news/daybreak",
              tags: ["OpenAI", "AI security"],
            }),
          ],
          selection: selection({
            clusterKey: "topic:openai-daybreak",
            lane: "ai-security",
          }),
          seoBrief,
        },
        {
          stories: [
            story({
              id: "apt-cloud-atlas",
              title: "Cloud Atlas adds new tools in espionage campaign",
              sourceName: "Kaspersky Securelist",
              sourceId: "kaspersky-securelist",
              url: "https://securelist.com/cloud-atlas-tools",
              tags: ["APT", "Cloud Atlas"],
            }),
          ],
          selection: selection({
            clusterKey: "topic:cloud-atlas-tools",
            lane: "apt-state-actors",
            score: 0.68,
            reasons: ["portfolio:apt-state-actors", "strong evidence"],
          }),
          seoBrief: {
            ...seoBrief,
            primaryQueryTarget: "Cloud Atlas",
            articleType: "apt-state-actors",
            targetHub: "apt-state-actors",
          },
        },
      ],
      {
        now: new Date("2026-05-26T11:07:04.450Z"),
        outputRoot,
        runId: "test-run",
      },
    );

    expect(fs.existsSync(result.manifestPath)).toBe(true);
    expect(result.candidatePaths).toHaveLength(2);
    expect(result.outputDir).toBe(
      path.join(outputRoot, "2026-05-26", "run-1107Z"),
    );

    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf-8"));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-05-26T11:07:04.450Z",
      runId: "test-run",
      mode: "curate-only",
      maxCandidates: 2,
      candidateCount: 2,
    });
    expect(manifest.candidates[0]).toMatchObject({
      candidateId: "001-topic-openai-daybreak",
      clusterKey: "topic:openai-daybreak",
      lane: "ai-security",
      score: 0.73,
      decision: "publish-now",
    });

    const candidate = JSON.parse(
      fs.readFileSync(result.candidatePaths[0], "utf-8"),
    );
    expect(candidate).toMatchObject({
      schemaVersion: 1,
      candidateId: "001-topic-openai-daybreak",
      clusterKey: "topic:openai-daybreak",
      proposedTitle: "OpenAI Daybreak launches cybersecurity accelerator",
      lane: "ai-security",
      score: 0.73,
      decision: "publish-now",
      selectionReasons: ["search demand", "trusted sources"],
      sourceCount: 1,
      sourceUrls: ["https://openai.com/news/daybreak"],
      sourceNames: ["OpenAI News"],
      seoBrief: {
        primaryQueryTarget: "OpenAI Daybreak",
        targetHub: "ai-security",
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
        },
      },
    });
    expect(candidate.scoreBreakdown).toMatchObject({
      evidence: 0.62,
      trust: 0.8,
      demand: 0.71,
      freshness: 1,
      differentiation: 0.65,
      portfolio: 0.65,
    });
    expect(candidate.sources[0]).toMatchObject({
      title: "OpenAI Daybreak launches cybersecurity accelerator",
      sourceName: "OpenAI News",
      sourceId: "openai-news",
      url: "https://openai.com/news/daybreak",
    });
  });
});

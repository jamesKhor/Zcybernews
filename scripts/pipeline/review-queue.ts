import fs from "node:fs";
import path from "node:path";
import type { Story } from "../utils/dedup.js";
import type { EditorialSelection } from "./editorial-selector.js";
import type { SeoBrief } from "./seo-brief.js";

export const DEFAULT_REVIEW_QUEUE_ROOT = "data/editorial-queue";

export type ReviewStatus =
  | "pending"
  | "approved"
  | "hold"
  | "digest-only"
  | "reject";
export const POSITIVE_TASTE_SIGNALS = [
  "hot-topic",
  "historical-exploitation",
  "active-exploitation",
  "reader-likely-cares",
  "defender-actionable",
  "strong-source",
  "original-angle",
  "portfolio-balance",
  "seo-opportunity",
  "brand-fit",
] as const;
export type PositiveTasteSignal = (typeof POSITIVE_TASTE_SIGNALS)[number];
export const NEGATIVE_TASTE_SIGNALS = [
  "generic-rewrite",
  "weak-source",
  "low-reader-value",
  "too-speculative",
  "too-vendor-pr",
  "stale-topic",
  "no-actionable-angle",
  "overcovered",
  "wrong-site-fit",
] as const;
export type NegativeTasteSignal = (typeof NEGATIVE_TASTE_SIGNALS)[number];

export interface ReviewQueueInput<T extends Story = Story> {
  stories: Array<T & { clusterKey?: string }>;
  selection: EditorialSelection;
  seoBrief: SeoBrief;
}

export interface ReviewQueueCandidate {
  schemaVersion: 1;
  candidateId: string;
  clusterKey: string;
  proposedTitle: string;
  lane: string;
  score: number;
  decision: EditorialSelection["decision"];
  selectionReasons: string[];
  scoreBreakdown: {
    evidence: number;
    trust: number;
    demand: number;
    freshness: number;
    differentiation: number;
    portfolio: number;
  };
  sourceCount: number;
  sourceUrls: string[];
  sourceNames: string[];
  sources: Array<{
    id?: string;
    title: string;
    url: string;
    excerpt?: string;
    sourceName?: string;
    sourceId?: string;
    publishedAt?: string;
    tags: string[];
  }>;
  seoBrief: SeoBrief;
  reviewer: {
    status: ReviewStatus;
    reviewedBy: string | null;
    reviewedAt: string | null;
    decisionReason: string | null;
    tasteRating: number | null;
    tasteReason: string | null;
    positiveSignals: PositiveTasteSignal[];
    negativeSignals: NegativeTasteSignal[];
    selectedReasonTags: string[];
    siteFitNotes: string | null;
    readerFitNotes: string | null;
    operatorNotes: string | null;
    calibrationRound: string | null;
    ratingScale: {
      min: 0.01;
      max: 1;
      likedThreshold: 0.8;
      description: string;
    };
  };
}

export interface ReviewQueueManifest {
  schemaVersion: 1;
  generatedAt: string;
  runId: string;
  mode: "curate-only";
  maxCandidates: number;
  candidateCount: number;
  candidates: Array<{
    candidateId: string;
    clusterKey: string;
    path: string;
    proposedTitle: string;
    lane: string;
    score: number;
    decision: EditorialSelection["decision"];
    selectionReasons: string[];
    sourceCount: number;
    primaryQueryTarget: string;
    targetHub: string | null;
  }>;
}

export interface ReviewQueueWriteResult {
  outputDir: string;
  manifestPath: string;
  candidatePaths: string[];
  manifest: ReviewQueueManifest;
}

function uniq(values: Array<string | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function safeSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "candidate";
}

function dateSegment(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function runSegment(now: Date): string {
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  return `run-${hh}${mm}Z`;
}

function relativePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function buildCandidate(
  input: ReviewQueueInput,
  index: number,
): ReviewQueueCandidate {
  const first = input.stories[0];
  const candidateId = `${String(index + 1).padStart(3, "0")}-${safeSegment(
    input.selection.clusterKey,
  )}`;
  return {
    schemaVersion: 1,
    candidateId,
    clusterKey: input.selection.clusterKey,
    proposedTitle: first?.title ?? input.selection.clusterKey,
    lane: input.selection.lane,
    score: input.selection.score,
    decision: input.selection.decision,
    selectionReasons: input.selection.reasons,
    scoreBreakdown: {
      evidence: input.selection.evidenceScore,
      trust: input.selection.trustScore,
      demand: input.selection.demandScore,
      freshness: input.selection.freshnessScore,
      differentiation: input.selection.differentiationScore,
      portfolio: input.selection.portfolioScore,
    },
    sourceCount: input.stories.length,
    sourceUrls: uniq(input.stories.map((story) => story.url)),
    sourceNames: uniq(input.stories.map((story) => story.sourceName)),
    sources: input.stories.map((story) => ({
      id: story.id,
      title: story.title,
      url: story.url,
      excerpt: story.excerpt,
      sourceName: story.sourceName,
      sourceId: story.sourceId,
      publishedAt: story.publishedAt,
      tags: story.tags ?? [],
    })),
    seoBrief: input.seoBrief,
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
  };
}

export function writeReviewQueue(
  candidates: ReviewQueueInput[],
  options: {
    now?: Date;
    outputRoot?: string;
    runId?: string;
  } = {},
): ReviewQueueWriteResult {
  const now = options.now ?? new Date();
  const outputRoot = options.outputRoot ?? DEFAULT_REVIEW_QUEUE_ROOT;
  const outputDir = path.join(outputRoot, dateSegment(now), runSegment(now));
  const runId = options.runId ?? `${dateSegment(now)}-${runSegment(now)}`;
  fs.mkdirSync(outputDir, { recursive: true });

  const candidatePayloads = candidates.map(buildCandidate);
  const candidatePaths = candidatePayloads.map((candidate) =>
    path.join(outputDir, `${candidate.candidateId}.json`),
  );

  for (const [index, candidate] of candidatePayloads.entries()) {
    fs.writeFileSync(
      candidatePaths[index],
      `${JSON.stringify(candidate, null, 2)}\n`,
    );
  }

  const manifest: ReviewQueueManifest = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    runId,
    mode: "curate-only",
    maxCandidates: candidates.length,
    candidateCount: candidates.length,
    candidates: candidatePayloads.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      clusterKey: candidate.clusterKey,
      path: relativePath(candidatePaths[index]),
      proposedTitle: candidate.proposedTitle,
      lane: candidate.lane,
      score: candidate.score,
      decision: candidate.decision,
      selectionReasons: candidate.selectionReasons,
      sourceCount: candidate.sourceCount,
      primaryQueryTarget: candidate.seoBrief.primaryQueryTarget,
      targetHub: candidate.seoBrief.targetHub,
    })),
  };
  const manifestPath = path.join(outputDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    outputDir,
    manifestPath,
    candidatePaths,
    manifest,
  };
}

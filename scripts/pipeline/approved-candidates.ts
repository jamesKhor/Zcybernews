import fs from "node:fs";
import path from "node:path";
import type { Story } from "../utils/dedup.js";
import { getStoryTranslationDecision, type RoutedStory } from "./routing.js";
import type { EditorialSelection } from "./editorial-selector.js";
import type { SeoBrief } from "./seo-brief.js";
import type {
  NegativeTasteSignal,
  PositiveTasteSignal,
  ReviewQueueCandidate,
} from "./review-queue.js";

export interface ApprovedCandidateReview {
  candidateId: string;
  status: "approved";
  reviewedBy: string;
  reviewedAt: string;
  decisionReason: string;
  tasteRating: number;
  tasteReason: string | null;
  positiveSignals: PositiveTasteSignal[];
  negativeSignals: NegativeTasteSignal[];
  selectedReasonTags: string[];
  siteFitNotes: string | null;
  readerFitNotes: string | null;
  operatorNotes: string | null;
  calibrationRound: string | null;
}

export interface ApprovedCandidateBatch {
  candidate: ReviewQueueCandidate;
  stories: Array<RoutedStory & { clusterKey: string }>;
  selection: EditorialSelection;
  seoBrief: SeoBrief;
  review: ApprovedCandidateReview;
}

export interface SkippedApprovedCandidate {
  candidateId: string;
  reason: string;
}

export interface ApprovedCandidateLoadResult {
  approved: ApprovedCandidateBatch[];
  skipped: SkippedApprovedCandidate[];
}

function isJsonFile(filePath: string): boolean {
  return (
    filePath.endsWith(".json") && path.basename(filePath) !== "manifest.json"
  );
}

function listCandidateFiles(queuePath: string): string[] {
  const stat = fs.statSync(queuePath);
  if (stat.isFile()) return [queuePath];

  const manifestPath = path.join(queuePath, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const candidates = Array.isArray(manifest.candidates)
      ? manifest.candidates
      : [];
    return candidates
      .map((entry: { path?: unknown }) =>
        typeof entry.path === "string" ? entry.path : "",
      )
      .filter(Boolean)
      .map((entryPath: string) => {
        if (path.isAbsolute(entryPath)) return entryPath;
        const workspacePath = path.resolve(entryPath);
        if (fs.existsSync(workspacePath)) return workspacePath;
        return path.resolve(queuePath, entryPath);
      });
  }

  return fs
    .readdirSync(queuePath)
    .filter((fileName) => isJsonFile(fileName))
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => path.join(queuePath, fileName));
}

function readCandidate(filePath: string): ReviewQueueCandidate {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as ReviewQueueCandidate;
}

function rating(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0.01 || value > 1) return null;
  return Math.round(value * 100) / 100;
}

function requireReview(
  candidate: ReviewQueueCandidate,
): ApprovedCandidateReview | string {
  const reviewer = candidate.reviewer;
  if (reviewer?.status !== "approved")
    return `status:${reviewer?.status ?? "missing"}`;
  const tasteRating = rating(reviewer.tasteRating);
  if (tasteRating === null) return "missing:tasteRating";
  if (!reviewer.decisionReason?.trim()) return "missing:decisionReason";
  if (!reviewer.reviewedBy?.trim()) return "missing:reviewedBy";

  return {
    candidateId: candidate.candidateId,
    status: "approved",
    reviewedBy: reviewer.reviewedBy,
    reviewedAt: reviewer.reviewedAt ?? new Date().toISOString(),
    decisionReason: reviewer.decisionReason.trim(),
    tasteRating,
    tasteReason: reviewer.tasteReason ?? null,
    positiveSignals: reviewer.positiveSignals ?? [],
    negativeSignals: reviewer.negativeSignals ?? [],
    selectedReasonTags: reviewer.selectedReasonTags ?? [],
    siteFitNotes: reviewer.siteFitNotes ?? null,
    readerFitNotes: reviewer.readerFitNotes ?? null,
    operatorNotes: reviewer.operatorNotes ?? null,
    calibrationRound: reviewer.calibrationRound ?? null,
  };
}

function storyFromSource(
  candidate: ReviewQueueCandidate,
  source: ReviewQueueCandidate["sources"][number],
  index: number,
): RoutedStory & { clusterKey: string } {
  const story: Story = {
    id: source.id ?? `${candidate.candidateId}-${index + 1}`,
    title: source.title,
    url: source.url,
    excerpt: source.excerpt ?? "",
    sourceName: source.sourceName ?? source.sourceId ?? "Unknown source",
    sourceId: source.sourceId,
    publishedAt: source.publishedAt ?? new Date().toISOString(),
    tags: source.tags ?? [],
    clusterKey: candidate.clusterKey,
  };

  return {
    ...story,
    clusterKey: candidate.clusterKey,
    translationDecision: getStoryTranslationDecision(story),
  };
}

function selectionFromCandidate(
  candidate: ReviewQueueCandidate,
): EditorialSelection {
  return {
    clusterKey: candidate.clusterKey,
    decision: "publish-now",
    score: candidate.score,
    lane: candidate.lane as EditorialSelection["lane"],
    reasons: candidate.selectionReasons,
    evidenceScore: candidate.scoreBreakdown.evidence,
    trustScore: candidate.scoreBreakdown.trust,
    demandScore: candidate.scoreBreakdown.demand,
    freshnessScore: candidate.scoreBreakdown.freshness,
    differentiationScore: candidate.scoreBreakdown.differentiation,
    portfolioScore: candidate.scoreBreakdown.portfolio,
    tasteProfileScore: 0,
    tasteProfileReasons: [],
  };
}

export function loadApprovedCandidateBatches(
  queuePath: string,
  options: { maxArticles?: number } = {},
): ApprovedCandidateLoadResult {
  const approved: ApprovedCandidateBatch[] = [];
  const skipped: SkippedApprovedCandidate[] = [];
  const maxArticles = options.maxArticles ?? Number.POSITIVE_INFINITY;

  for (const filePath of listCandidateFiles(queuePath)) {
    const candidate = readCandidate(filePath);
    const review = requireReview(candidate);
    if (typeof review === "string") {
      skipped.push({
        candidateId: candidate.candidateId ?? path.basename(filePath, ".json"),
        reason: review,
      });
      continue;
    }
    if (approved.length >= maxArticles) continue;

    approved.push({
      candidate,
      stories: candidate.sources.map((source, index) =>
        storyFromSource(candidate, source, index),
      ),
      selection: selectionFromCandidate(candidate),
      seoBrief: candidate.seoBrief,
      review,
    });
  }

  return { approved, skipped };
}

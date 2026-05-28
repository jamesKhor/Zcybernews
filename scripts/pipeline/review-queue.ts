import fs from "node:fs";
import path from "node:path";
import type { Story } from "../utils/dedup.js";
import type { EditorialSelection } from "./editorial-selector.js";
import type { SeoBrief } from "./seo-brief.js";

export const DEFAULT_REVIEW_QUEUE_ROOT = "data/editorial-queue";
export const DEFAULT_REVIEW_QUEUE_SUPPRESSION_DAYS = 14;

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

export interface QueuedReviewCandidateSkip {
  clusterKey: string;
  proposedTitle: string;
  matchedCandidateId: string;
  matchedClusterKey: string;
  matchedRunKey: string;
  reason: "already queued for review";
}

export interface ReviewQueueFilterResult<T extends Story = Story> {
  candidates: ReviewQueueInput<T>[];
  skipped: QueuedReviewCandidateSkip[];
}

interface QueuedSuppressionRecord {
  candidateId: string;
  clusterKey: string;
  proposedTitle: string;
  runKey: string;
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

function candidateTitle(input: ReviewQueueInput): string {
  return input.stories[0]?.title ?? input.selection.clusterKey;
}

function keyValues(values: Array<string | undefined>): string[] {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function normalizeQueueTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateKeys(input: ReviewQueueInput): string[] {
  return [
    `cluster:${input.selection.clusterKey}`,
    ...keyValues(input.stories.map((story) => story.identityKey)).map(
      (key) => `identity:${key}`,
    ),
    ...keyValues(input.stories.map((story) => story.id)).map(
      (key) => `story-id:${key}`,
    ),
    `title:${normalizeQueueTitle(candidateTitle(input))}`,
  ];
}

function queuedCandidateKeys(candidate: ReviewQueueCandidate): string[] {
  return [
    `cluster:${candidate.clusterKey}`,
    ...keyValues(candidate.sources.map((source) => source.id)).map(
      (key) => `story-id:${key}`,
    ),
    `title:${normalizeQueueTitle(candidate.proposedTitle)}`,
  ];
}

function listCandidateFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listCandidateFiles(fullPath));
    if (entry.isFile() && entry.name.endsWith(".json")) {
      if (entry.name !== "manifest.json") out.push(fullPath);
    }
  }
  return out;
}

function dateFromCandidatePath(root: string, filePath: string): Date | null {
  const firstSegment = path.relative(root, filePath).split(path.sep)[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstSegment)) return null;
  const parsed = new Date(`${firstSegment}T23:59:59.999Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function runKeyFromCandidatePath(root: string, filePath: string): string {
  return path.dirname(path.relative(root, filePath)).split(path.sep).join("/");
}

function readQueuedCandidate(filePath: string): ReviewQueueCandidate | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (!("candidateId" in parsed) || !("clusterKey" in parsed)) return null;
    return parsed as ReviewQueueCandidate;
  } catch {
    return null;
  }
}

function buildSuppressionIndex(options: {
  queueRoot: string;
  now: Date;
  lookbackDays: number;
}): Map<string, QueuedSuppressionRecord> {
  const root = path.resolve(options.queueRoot);
  const cutoffMs =
    options.now.getTime() - options.lookbackDays * 24 * 60 * 60 * 1000;
  const index = new Map<string, QueuedSuppressionRecord>();

  for (const filePath of listCandidateFiles(root)) {
    const queuedDate = dateFromCandidatePath(root, filePath);
    if (queuedDate && queuedDate.getTime() < cutoffMs) continue;

    const candidate = readQueuedCandidate(filePath);
    if (!candidate) continue;
    const record: QueuedSuppressionRecord = {
      candidateId: candidate.candidateId,
      clusterKey: candidate.clusterKey,
      proposedTitle: candidate.proposedTitle,
      runKey: runKeyFromCandidatePath(root, filePath),
    };
    for (const key of queuedCandidateKeys(candidate)) {
      if (!index.has(key)) index.set(key, record);
    }
  }

  return index;
}

export function filterQueuedReviewCandidates<T extends Story>(
  candidates: ReviewQueueInput<T>[],
  options: {
    queueRoot?: string;
    now?: Date;
    lookbackDays?: number;
  } = {},
): ReviewQueueFilterResult<T> {
  const now = options.now ?? new Date();
  const lookbackDays =
    options.lookbackDays ?? DEFAULT_REVIEW_QUEUE_SUPPRESSION_DAYS;
  const index = buildSuppressionIndex({
    queueRoot: options.queueRoot ?? DEFAULT_REVIEW_QUEUE_ROOT,
    now,
    lookbackDays,
  });
  const kept: ReviewQueueInput<T>[] = [];
  const skipped: QueuedReviewCandidateSkip[] = [];

  for (const candidate of candidates) {
    const match = candidateKeys(candidate).find((key) => index.has(key));
    const record = match ? index.get(match) : null;
    if (record) {
      skipped.push({
        clusterKey: candidate.selection.clusterKey,
        proposedTitle: candidateTitle(candidate),
        matchedCandidateId: record.candidateId,
        matchedClusterKey: record.clusterKey,
        matchedRunKey: record.runKey,
        reason: "already queued for review",
      });
      continue;
    }

    kept.push(candidate);
    const recordForThisRun: QueuedSuppressionRecord = {
      candidateId: candidate.selection.clusterKey,
      clusterKey: candidate.selection.clusterKey,
      proposedTitle: candidateTitle(candidate),
      runKey: "current-run",
    };
    for (const key of candidateKeys(candidate)) {
      if (!index.has(key)) index.set(key, recordForThisRun);
    }
  }

  return { candidates: kept, skipped };
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

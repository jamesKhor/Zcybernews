import fs from "node:fs";
import path from "node:path";
import type {
  NegativeTasteSignal,
  PositiveTasteSignal,
  ReviewStatus,
} from "./review-queue.js";

export const DEFAULT_TASTE_PROFILE_PATH = path.join(
  "data",
  "editorial-taste-profile.json",
);
export const DEFAULT_LIKED_THRESHOLD = 0.8;

export interface ReviewedQueueCandidate {
  schemaVersion?: number;
  candidateId: string;
  clusterKey: string;
  proposedTitle: string;
  lane: string;
  score: number;
  decision: string;
  selectionReasons: string[];
  sourceNames: string[];
  reviewer?: {
    status?: ReviewStatus;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    decisionReason?: string | null;
    tasteRating?: number | null;
    tasteReason?: string | null;
    positiveSignals?: PositiveTasteSignal[];
    negativeSignals?: NegativeTasteSignal[];
    selectedReasonTags?: string[];
    siteFitNotes?: string | null;
    readerFitNotes?: string | null;
    operatorNotes?: string | null;
    calibrationRound?: string | null;
  };
}

export interface TastePattern {
  kind:
    | "lane"
    | "source"
    | "selection-reason"
    | "positive-signal"
    | "negative-signal";
  key: string;
  averageRating: number;
  count: number;
}

export interface EditorialTasteProfile {
  schemaVersion: 1;
  generatedAt: string;
  likedThreshold: number;
  reviewedCandidateCount: number;
  averageTasteRating: number;
  likedRatio: number;
  approvalRatio: number;
  holdRatio: number;
  rejectRatio: number;
  decisionCounts: Record<string, number>;
  laneScores: Record<string, number>;
  laneCounts: Record<string, number>;
  sourceScores: Record<string, number>;
  sourceCounts: Record<string, number>;
  reasonTagScores: Record<string, number>;
  reasonTagCounts: Record<string, number>;
  positiveSignalScores: Record<string, number>;
  positiveSignalCounts: Record<string, number>;
  negativeSignalScores: Record<string, number>;
  negativeSignalCounts: Record<string, number>;
  boostPatterns: TastePattern[];
  suppressPatterns: TastePattern[];
}

interface Accumulator {
  sums: Record<string, number>;
  counts: Record<string, number>;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function rating(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0.01, Math.min(1, value));
}

function inc(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function add(acc: Accumulator, key: string | undefined, value: number) {
  if (!key) return;
  acc.sums[key] = (acc.sums[key] ?? 0) + value;
  acc.counts[key] = (acc.counts[key] ?? 0) + 1;
}

function averages(acc: Accumulator): Record<string, number> {
  return Object.fromEntries(
    Object.entries(acc.sums)
      .map(([key, sum]): [string, number] => [
        key,
        round2(sum / (acc.counts[key] || 1)),
      ])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function cleanTags(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function patterns(
  kind: TastePattern["kind"],
  scores: Record<string, number>,
  counts: Record<string, number>,
  predicate: (score: number) => boolean,
): TastePattern[] {
  return Object.entries(scores)
    .filter(([, score]) => predicate(score))
    .map(([key, averageRating]) => ({
      kind,
      key,
      averageRating,
      count: counts[key] ?? 0,
    }));
}

function hasRating(candidate: ReviewedQueueCandidate): boolean {
  return rating(candidate.reviewer?.tasteRating) !== null;
}

export function aggregateTasteProfile(
  candidates: ReviewedQueueCandidate[],
  options: {
    now?: Date;
    likedThreshold?: number;
  } = {},
): EditorialTasteProfile {
  const likedThreshold = options.likedThreshold ?? DEFAULT_LIKED_THRESHOLD;
  const reviewed = candidates.filter(hasRating);
  const lane: Accumulator = { sums: {}, counts: {} };
  const source: Accumulator = { sums: {}, counts: {} };
  const reasonTag: Accumulator = { sums: {}, counts: {} };
  const positiveSignal: Accumulator = { sums: {}, counts: {} };
  const negativeSignal: Accumulator = { sums: {}, counts: {} };
  const decisionCounts: Record<string, number> = {};
  let ratingSum = 0;
  let liked = 0;
  let approved = 0;
  let held = 0;
  let rejected = 0;

  for (const candidate of reviewed) {
    const value = rating(candidate.reviewer?.tasteRating);
    if (value === null) continue;
    ratingSum += value;
    if (value >= likedThreshold) liked++;
    const status = candidate.reviewer?.status ?? "pending";
    inc(decisionCounts, status);
    if (status === "approved") approved++;
    if (status === "hold" || status === "digest-only") held++;
    if (status === "reject") rejected++;

    add(lane, candidate.lane, value);
    for (const name of cleanTags(candidate.sourceNames))
      add(source, name, value);
    for (const reason of cleanTags(candidate.selectionReasons)) {
      add(reasonTag, reason, value);
    }
    for (const reason of cleanTags(
      candidate.reviewer?.selectedReasonTags ?? [],
    )) {
      add(reasonTag, reason, value);
    }
    for (const signal of cleanTags(candidate.reviewer?.positiveSignals ?? [])) {
      add(positiveSignal, signal, value);
    }
    for (const signal of cleanTags(candidate.reviewer?.negativeSignals ?? [])) {
      add(negativeSignal, signal, value);
    }
  }

  const reviewedCount = reviewed.length;
  const laneScores = averages(lane);
  const sourceScores = averages(source);
  const reasonTagScores = averages(reasonTag);
  const positiveSignalScores = averages(positiveSignal);
  const negativeSignalScores = averages(negativeSignal);

  const boostPatterns = [
    ...patterns("lane", laneScores, lane.counts, (score) => score >= 0.8),
    ...patterns("source", sourceScores, source.counts, (score) => score >= 0.8),
    ...patterns(
      "selection-reason",
      reasonTagScores,
      reasonTag.counts,
      (score) => score >= 0.8,
    ),
    ...patterns(
      "positive-signal",
      positiveSignalScores,
      positiveSignal.counts,
      (score) => score >= 0.8,
    ),
  ].sort(
    (a, b) =>
      b.averageRating - a.averageRating ||
      b.count - a.count ||
      a.key.localeCompare(b.key),
  );
  const suppressPatterns = [
    ...patterns("lane", laneScores, lane.counts, (score) => score < 0.6),
    ...patterns("source", sourceScores, source.counts, (score) => score < 0.6),
    ...patterns(
      "selection-reason",
      reasonTagScores,
      reasonTag.counts,
      (score) => score < 0.6,
    ),
    ...patterns(
      "negative-signal",
      negativeSignalScores,
      negativeSignal.counts,
      (score) => score < 0.6,
    ),
  ].sort(
    (a, b) =>
      a.averageRating - b.averageRating ||
      b.count - a.count ||
      a.key.localeCompare(b.key),
  );

  return {
    schemaVersion: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    likedThreshold,
    reviewedCandidateCount: reviewedCount,
    averageTasteRating: reviewedCount ? round2(ratingSum / reviewedCount) : 0,
    likedRatio: reviewedCount ? round2(liked / reviewedCount) : 0,
    approvalRatio: reviewedCount ? round2(approved / reviewedCount) : 0,
    holdRatio: reviewedCount ? round2(held / reviewedCount) : 0,
    rejectRatio: reviewedCount ? round2(rejected / reviewedCount) : 0,
    decisionCounts,
    laneScores,
    laneCounts: lane.counts,
    sourceScores,
    sourceCounts: source.counts,
    reasonTagScores,
    reasonTagCounts: reasonTag.counts,
    positiveSignalScores,
    positiveSignalCounts: positiveSignal.counts,
    negativeSignalScores,
    negativeSignalCounts: negativeSignal.counts,
    boostPatterns,
    suppressPatterns,
  };
}

function listJsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listJsonFiles(fullPath));
    if (entry.isFile() && entry.name.endsWith(".json")) out.push(fullPath);
  }
  return out;
}

function readCandidate(filePath: string): ReviewedQueueCandidate | null {
  if (path.basename(filePath) === "manifest.json") return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (!("candidateId" in parsed) || !("reviewer" in parsed)) return null;
    return parsed as ReviewedQueueCandidate;
  } catch {
    return null;
  }
}

export function buildTasteProfileFromQueue(
  queueRoot = path.join("data", "editorial-queue"),
  options: { now?: Date; likedThreshold?: number } = {},
): EditorialTasteProfile {
  const candidates = listJsonFiles(queueRoot)
    .map(readCandidate)
    .filter((candidate): candidate is ReviewedQueueCandidate =>
      Boolean(candidate),
    );
  return aggregateTasteProfile(candidates, options);
}

export function loadTasteProfile(
  filePath = DEFAULT_TASTE_PROFILE_PATH,
): EditorialTasteProfile | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schemaVersion !== 1) return null;
    return parsed as EditorialTasteProfile;
  } catch {
    return null;
  }
}

export function writeTasteProfile(
  profile: EditorialTasteProfile,
  filePath = DEFAULT_TASTE_PROFILE_PATH,
) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(profile, null, 2)}\n`);
}

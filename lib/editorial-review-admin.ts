import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_REVIEW_QUEUE_ROOT,
  type ReviewQueueCandidate,
  type ReviewQueueManifest,
  type ReviewStatus,
} from "../scripts/pipeline/review-queue";
import {
  reviewCandidateAndRebuildProfile,
  type ReviewAndProfileResult,
  type ReviewDecisionInput,
} from "../scripts/pipeline/review-decision";
import { DEFAULT_TASTE_PROFILE_PATH } from "../scripts/pipeline/taste-profile";

export interface ReviewQueueRunSummary {
  runKey: string;
  runId: string;
  generatedAt: string;
  candidateCount: number;
  manifestPath: string;
  statusCounts: Record<ReviewStatus, number>;
}

export interface LoadedReviewQueueCandidate {
  path: string;
  candidate: ReviewQueueCandidate;
}

export interface LoadedReviewQueueRun {
  runKey: string;
  manifestPath: string;
  manifest: ReviewQueueManifest;
  candidates: LoadedReviewQueueCandidate[];
  statusCounts: Record<ReviewStatus, number>;
}

export interface ReviewQueueOptions {
  queueRoot?: string;
}

const REVIEW_STATUSES: ReviewStatus[] = [
  "pending",
  "approved",
  "hold",
  "digest-only",
  "reject",
];

function statusCounts(
  candidates: ReviewQueueCandidate[],
): Record<ReviewStatus, number> {
  const counts = Object.fromEntries(
    REVIEW_STATUSES.map((status) => [status, 0]),
  ) as Record<ReviewStatus, number>;

  for (const candidate of candidates) {
    counts[candidate.reviewer.status] += 1;
  }

  return counts;
}

function queueRoot(options: ReviewQueueOptions = {}): string {
  return path.resolve(options.queueRoot ?? DEFAULT_REVIEW_QUEUE_ROOT);
}

function assertInsideRoot(root: string, target: string): string {
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path resolves outside editorial queue: ${target}`);
  }
  return resolved;
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function relativeToRoot(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function resolveRunDir(
  runKey: string,
  options: ReviewQueueOptions = {},
): string {
  const root = queueRoot(options);
  return assertInsideRoot(root, path.join(root, runKey));
}

function resolveCandidatePath(
  candidatePath: string,
  options: ReviewQueueOptions = {},
): string {
  const root = queueRoot(options);
  const normalized = candidatePath.split(/[\\/]+/).join(path.sep);
  const rootRelative = path.relative(process.cwd(), root);
  const withoutRootPrefix =
    normalized === rootRelative ||
    normalized.startsWith(`${rootRelative}${path.sep}`)
      ? path.relative(rootRelative, normalized)
      : normalized;
  return assertInsideRoot(root, path.join(root, withoutRootPrefix));
}

function loadCandidate(filePath: string): ReviewQueueCandidate {
  return readJson<ReviewQueueCandidate>(filePath);
}

export function listReviewQueueRuns(
  options: ReviewQueueOptions = {},
): ReviewQueueRunSummary[] {
  const root = queueRoot(options);
  if (!fs.existsSync(root)) return [];

  const runs: ReviewQueueRunSummary[] = [];
  for (const dateEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dateEntry.isDirectory()) continue;
    const dateDir = path.join(root, dateEntry.name);

    for (const runEntry of fs.readdirSync(dateDir, { withFileTypes: true })) {
      if (!runEntry.isDirectory()) continue;
      const runDir = path.join(dateDir, runEntry.name);
      const manifestPath = path.join(runDir, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;

      const manifest = readJson<ReviewQueueManifest>(manifestPath);
      const candidates = manifest.candidates
        .map((item) => {
          try {
            return loadCandidate(resolveCandidatePath(item.path, options));
          } catch {
            return null;
          }
        })
        .filter((item): item is ReviewQueueCandidate => Boolean(item));

      runs.push({
        runKey: `${dateEntry.name}/${runEntry.name}`,
        runId: manifest.runId,
        generatedAt: manifest.generatedAt,
        candidateCount: manifest.candidateCount,
        manifestPath: relativeToRoot(root, manifestPath),
        statusCounts: statusCounts(candidates),
      });
    }
  }

  return runs.sort(
    (a, b) =>
      new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime() ||
      b.runKey.localeCompare(a.runKey),
  );
}

export function loadReviewQueueRun(
  runKey: string,
  options: ReviewQueueOptions = {},
): LoadedReviewQueueRun {
  const root = queueRoot(options);
  const runDir = resolveRunDir(runKey, options);
  const manifestPath = path.join(runDir, "manifest.json");
  const manifest = readJson<ReviewQueueManifest>(manifestPath);
  const candidates = manifest.candidates.map((item) => {
    const filePath = resolveCandidatePath(item.path, options);
    return {
      path: relativeToRoot(root, filePath),
      candidate: loadCandidate(filePath),
    };
  });

  return {
    runKey,
    manifestPath: relativeToRoot(root, manifestPath),
    manifest,
    candidates,
    statusCounts: statusCounts(candidates.map((item) => item.candidate)),
  };
}

export function applyAdminReviewDecision(
  candidatePath: string,
  decision: ReviewDecisionInput,
  options: ReviewQueueOptions & {
    profileOutputPath?: string;
  } = {},
): ReviewAndProfileResult {
  const resolvedCandidatePath = resolveCandidatePath(candidatePath, options);
  return reviewCandidateAndRebuildProfile(resolvedCandidatePath, decision, {
    queueRoot: queueRoot(options),
    profileOutputPath: options.profileOutputPath ?? DEFAULT_TASTE_PROFILE_PATH,
  });
}

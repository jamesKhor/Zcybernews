import fs from "node:fs";
import {
  NEGATIVE_TASTE_SIGNALS,
  POSITIVE_TASTE_SIGNALS,
  type NegativeTasteSignal,
  type PositiveTasteSignal,
  type ReviewQueueCandidate,
  type ReviewStatus,
} from "./review-queue";
import {
  DEFAULT_TASTE_PROFILE_PATH,
  buildTasteProfileFromQueue,
  writeTasteProfile,
  type EditorialTasteProfile,
} from "./taste-profile";

export type ReviewDecisionStatus = Exclude<ReviewStatus, "pending">;

export interface ReviewDecisionInput {
  status: ReviewDecisionStatus;
  reviewedBy: string;
  reviewedAt?: string;
  tasteRating: number;
  decisionReason: string;
  tasteReason?: string | null;
  positiveSignals?: PositiveTasteSignal[];
  negativeSignals?: NegativeTasteSignal[];
  selectedReasonTags?: string[];
  siteFitNotes?: string | null;
  readerFitNotes?: string | null;
  operatorNotes?: string | null;
  calibrationRound?: string | null;
}

export interface ReviewAndProfileResult {
  candidate: ReviewQueueCandidate;
  profile: EditorialTasteProfile;
  profilePath: string;
}

const REVIEW_DECISION_STATUSES: ReviewDecisionStatus[] = [
  "approved",
  "hold",
  "digest-only",
  "reject",
];

function requiredText(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required.`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function uniqueText(values: unknown[] | undefined): string[] {
  if (!values) return [];
  return [
    ...new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  ];
}

function validateStatus(status: ReviewDecisionInput["status"]) {
  if (!REVIEW_DECISION_STATUSES.includes(status)) {
    throw new Error(
      `status must be one of ${REVIEW_DECISION_STATUSES.join(", ")}.`,
    );
  }
}

function validateRating(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("tasteRating must be a finite number from 0.01 to 1.");
  }
  if (value < 0.01 || value > 1) {
    throw new Error("tasteRating must be from 0.01 to 1.");
  }
  return Math.round(value * 100) / 100;
}

function validateSignals<T extends string>(
  values: unknown[] | undefined,
  allowed: readonly T[],
  label: string,
): T[] {
  const cleaned = uniqueText(values);
  const allowedSet = new Set<string>(allowed);
  for (const value of cleaned) {
    if (!allowedSet.has(value)) {
      throw new Error(`Unknown ${label} taste signal: ${value}.`);
    }
  }
  return cleaned as T[];
}

function readCandidate(filePath: string): ReviewQueueCandidate {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Review candidate is not an object: ${filePath}`);
  }
  return parsed as ReviewQueueCandidate;
}

export function applyReviewDecision(
  filePath: string,
  decision: ReviewDecisionInput,
): ReviewQueueCandidate {
  validateStatus(decision.status);

  const candidate = readCandidate(filePath);
  const previousReviewer = candidate.reviewer;
  const updated: ReviewQueueCandidate = {
    ...candidate,
    reviewer: {
      ...previousReviewer,
      status: decision.status,
      reviewedBy: requiredText(decision.reviewedBy, "reviewedBy"),
      reviewedAt: decision.reviewedAt ?? new Date().toISOString(),
      decisionReason: requiredText(decision.decisionReason, "decisionReason"),
      tasteRating: validateRating(decision.tasteRating),
      tasteReason: optionalText(decision.tasteReason),
      positiveSignals: validateSignals(
        decision.positiveSignals,
        POSITIVE_TASTE_SIGNALS,
        "positive",
      ),
      negativeSignals: validateSignals(
        decision.negativeSignals,
        NEGATIVE_TASTE_SIGNALS,
        "negative",
      ),
      selectedReasonTags: uniqueText(decision.selectedReasonTags),
      siteFitNotes: optionalText(decision.siteFitNotes),
      readerFitNotes: optionalText(decision.readerFitNotes),
      operatorNotes: optionalText(decision.operatorNotes),
      calibrationRound: optionalText(decision.calibrationRound),
      ratingScale: previousReviewer?.ratingScale ?? {
        min: 0.01,
        max: 1,
        likedThreshold: 0.8,
        description:
          "1.0 means exactly the kind of article we want; 0.8+ is liked/publishable; 0.01 means avoid this pattern.",
      },
    },
  };

  fs.writeFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

export function reviewCandidateAndRebuildProfile(
  filePath: string,
  decision: ReviewDecisionInput,
  options: {
    queueRoot?: string;
    profileOutputPath?: string;
    now?: Date;
  } = {},
): ReviewAndProfileResult {
  const candidate = applyReviewDecision(filePath, decision);
  const profilePath = options.profileOutputPath ?? DEFAULT_TASTE_PROFILE_PATH;
  const profile = buildTasteProfileFromQueue(options.queueRoot, {
    now: options.now,
  });
  writeTasteProfile(profile, profilePath);

  return {
    candidate,
    profile,
    profilePath,
  };
}

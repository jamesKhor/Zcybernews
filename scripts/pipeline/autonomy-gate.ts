import fs from "node:fs";
import path from "node:path";
import type { EditorialTasteProfile } from "./taste-profile.js";

export const DEFAULT_AUTONOMY_STARTED_ON = "2026-05-26";
export const DEFAULT_AUTONOMY_MAX_DAYS = 14;
export const DEFAULT_AUTONOMY_STATE_PATH = path.join(
  "data",
  "editorial-autonomy-state.json",
);
export const DAY_14_LIKED_RATIO_TARGET = 0.9;
export const DEGRADATION_LIKED_RATIO_FLOOR = 0.85;
export const DEGRADATION_AVERAGE_RATING_FLOOR = 0.85;
export const STRICT_AUTONOMY_MAX_ARTICLES = 2;

export type AutonomyGateMode =
  | "curate-only"
  | "autonomous-normal"
  | "autonomous-strict";

export interface AutonomyRollingCandidate {
  candidateId?: string;
  tasteRating?: number | null;
  reviewedAt?: string | null;
  rejectedAfterPublish?: boolean;
}

export interface AutonomyGateState {
  schemaVersion?: 1;
  transitionApprovedBy?: string | null;
  transitionApprovedAt?: string | null;
  autonomyStartedAt?: string | null;
  openRegressions?: string[];
  seriousQualityIncidentOpen?: boolean;
  gscDegraded?: boolean;
  autoPublishedRejectionsToday?: number;
  rollingCandidates?: AutonomyRollingCandidate[];
}

export interface AutonomyGateInput {
  now?: Date;
  calibrationStartedOn?: string;
  calibrationMaxDays?: number;
  tasteProfile: EditorialTasteProfile | null;
  state?: AutonomyGateState | null;
  requestedMaxArticles: number;
}

export interface AutonomyGateDecision {
  mode: AutonomyGateMode;
  curateOnly: boolean;
  effectiveMaxArticles: number;
  strictQualityGates: boolean;
  dailySampleAudit: boolean;
  daysSinceCalibrationStart: number;
  reasons: string[];
  metrics: {
    reviewedCandidateCount: number;
    likedRatio: number;
    averageTasteRating: number;
    rollingCandidateCount: number;
    rollingLikedRatio: number | null;
    rollingAverageTasteRating: number | null;
  };
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

function daysBetween(start: Date | null, now: Date): number {
  if (!start) return 0;
  return Math.max(
    0,
    Math.floor((now.getTime() - start.getTime()) / 86_400_000),
  );
}

function boundedMaxArticles(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

function rating(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0.01 || value > 1) return null;
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function rollingRatings(state: AutonomyGateState | null | undefined): number[] {
  return (state?.rollingCandidates ?? [])
    .map((candidate) => rating(candidate.tasteRating))
    .filter((value): value is number => value !== null)
    .slice(-20);
}

function rollingMetrics(ratings: number[]): {
  rollingLikedRatio: number | null;
  rollingAverageTasteRating: number | null;
} {
  if (ratings.length === 0) {
    return {
      rollingLikedRatio: null,
      rollingAverageTasteRating: null,
    };
  }

  return {
    rollingLikedRatio: round2(
      ratings.filter((value) => value >= 0.8).length / ratings.length,
    ),
    rollingAverageTasteRating: round2(
      ratings.reduce((sum, value) => sum + value, 0) / ratings.length,
    ),
  };
}

function hasTransitionApproval(state: AutonomyGateState | null | undefined) {
  const approver = state?.transitionApprovedBy?.trim().toLowerCase();
  return approver === "alex" || approver === "eric";
}

function baseMetrics(
  tasteProfile: EditorialTasteProfile | null,
  ratings: number[],
) {
  const rolling = rollingMetrics(ratings);
  return {
    reviewedCandidateCount: tasteProfile?.reviewedCandidateCount ?? 0,
    likedRatio: tasteProfile?.likedRatio ?? 0,
    averageTasteRating: tasteProfile?.averageTasteRating ?? 0,
    rollingCandidateCount: ratings.length,
    ...rolling,
  };
}

function decision(
  mode: AutonomyGateMode,
  input: {
    requestedMaxArticles: number;
    daysSinceCalibrationStart: number;
    reasons: string[];
    metrics: AutonomyGateDecision["metrics"];
  },
): AutonomyGateDecision {
  const requestedMaxArticles = boundedMaxArticles(input.requestedMaxArticles);
  const strict = mode === "autonomous-strict";

  return {
    mode,
    curateOnly: mode === "curate-only",
    effectiveMaxArticles: strict
      ? Math.min(requestedMaxArticles, STRICT_AUTONOMY_MAX_ARTICLES)
      : requestedMaxArticles,
    strictQualityGates: strict,
    dailySampleAudit: strict,
    daysSinceCalibrationStart: input.daysSinceCalibrationStart,
    reasons: input.reasons,
    metrics: input.metrics,
  };
}

export function evaluateAutonomyGate(
  input: AutonomyGateInput,
): AutonomyGateDecision {
  const now = input.now ?? new Date();
  const startedOn = parseDate(
    input.calibrationStartedOn ?? DEFAULT_AUTONOMY_STARTED_ON,
  );
  const calibrationMaxDays =
    input.calibrationMaxDays ?? DEFAULT_AUTONOMY_MAX_DAYS;
  const daysSinceCalibrationStart = daysBetween(startedOn, now);
  const ratings = rollingRatings(input.state);
  const metrics = baseMetrics(input.tasteProfile, ratings);

  if (daysSinceCalibrationStart < calibrationMaxDays) {
    return decision("curate-only", {
      requestedMaxArticles: input.requestedMaxArticles,
      daysSinceCalibrationStart,
      reasons: ["calibration-window-active"],
      metrics,
    });
  }

  const reviewReasons: string[] = [];
  for (const regression of input.state?.openRegressions ?? []) {
    if (regression.trim()) {
      reviewReasons.push(`open-regression:${regression.trim()}`);
    }
  }
  if (input.state?.seriousQualityIncidentOpen) {
    reviewReasons.push("serious-quality-incident-open");
  }
  if (input.state?.gscDegraded) {
    reviewReasons.push("gsc-degraded");
  }
  if ((input.state?.autoPublishedRejectionsToday ?? 0) >= 2) {
    reviewReasons.push("two-auto-published-rejections-today");
  }

  if (input.state?.autonomyStartedAt && ratings.length >= 20) {
    if (
      metrics.rollingLikedRatio !== null &&
      metrics.rollingLikedRatio < DEGRADATION_LIKED_RATIO_FLOOR
    ) {
      reviewReasons.push("rolling-liked-ratio-below-85");
    }
    if (
      metrics.rollingAverageTasteRating !== null &&
      metrics.rollingAverageTasteRating < DEGRADATION_AVERAGE_RATING_FLOOR
    ) {
      reviewReasons.push("rolling-average-rating-below-85");
    }
  }

  if (reviewReasons.length > 0) {
    return decision("curate-only", {
      requestedMaxArticles: input.requestedMaxArticles,
      daysSinceCalibrationStart,
      reasons: reviewReasons,
      metrics,
    });
  }

  const strictReasons: string[] = [];
  if (!input.tasteProfile || metrics.reviewedCandidateCount === 0) {
    strictReasons.push("missing-taste-profile");
  }
  if (metrics.likedRatio < DAY_14_LIKED_RATIO_TARGET) {
    strictReasons.push("day-14-liked-target-missed");
  }
  if (metrics.averageTasteRating < DEGRADATION_AVERAGE_RATING_FLOOR) {
    strictReasons.push("average-rating-below-85");
  }
  if (!hasTransitionApproval(input.state)) {
    strictReasons.push("missing-alex-eric-transition-approval");
  }

  if (strictReasons.length > 0) {
    return decision("autonomous-strict", {
      requestedMaxArticles: input.requestedMaxArticles,
      daysSinceCalibrationStart,
      reasons: strictReasons,
      metrics,
    });
  }

  return decision("autonomous-normal", {
    requestedMaxArticles: input.requestedMaxArticles,
    daysSinceCalibrationStart,
    reasons: ["day-14-quality-target-met"],
    metrics,
  });
}

export function loadAutonomyGateState(
  filePath = DEFAULT_AUTONOMY_STATE_PATH,
): AutonomyGateState | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as AutonomyGateState;
  } catch {
    return null;
  }
}

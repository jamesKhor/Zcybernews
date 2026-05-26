import { NextRequest, NextResponse } from "next/server";
import { adminGuard } from "@/lib/admin-guard";
import {
  applyAdminReviewDecision,
  listReviewQueueRuns,
  loadReviewQueueRun,
} from "@/lib/editorial-review-admin";
import {
  NEGATIVE_TASTE_SIGNALS,
  POSITIVE_TASTE_SIGNALS,
} from "@/scripts/pipeline/review-queue";
import type {
  ReviewDecisionInput,
  ReviewDecisionStatus,
} from "@/scripts/pipeline/review-decision";

export const runtime = "nodejs";

const REVIEW_STATUSES: ReviewDecisionStatus[] = [
  "approved",
  "hold",
  "digest-only",
  "reject",
];

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function decisionFromBody(body: Record<string, unknown>): ReviewDecisionInput {
  const status = text(body.status) as ReviewDecisionStatus | undefined;
  if (!status || !REVIEW_STATUSES.includes(status)) {
    throw new Error(`status must be one of ${REVIEW_STATUSES.join(", ")}`);
  }

  const tasteRating = Number(body.tasteRating);
  if (!Number.isFinite(tasteRating)) {
    throw new Error("tasteRating must be a number from 0.01 to 1");
  }

  return {
    status,
    reviewedBy: text(body.reviewedBy) ?? "admin",
    reviewedAt: text(body.reviewedAt),
    tasteRating,
    decisionReason: text(body.decisionReason) ?? "",
    tasteReason: text(body.tasteReason),
    positiveSignals: textList(
      body.positiveSignals,
    ) as ReviewDecisionInput["positiveSignals"],
    negativeSignals: textList(
      body.negativeSignals,
    ) as ReviewDecisionInput["negativeSignals"],
    selectedReasonTags: textList(body.selectedReasonTags),
    siteFitNotes: text(body.siteFitNotes),
    readerFitNotes: text(body.readerFitNotes),
    operatorNotes: text(body.operatorNotes),
    calibrationRound: text(body.calibrationRound),
  };
}

export async function GET(req: NextRequest) {
  const guard = await adminGuard(req, "review-queue:get", 120);
  if (guard) return guard;

  try {
    const runs = listReviewQueueRuns();
    const requestedRun = req.nextUrl.searchParams.get("run");
    const runKey = requestedRun ?? runs[0]?.runKey;
    const activeRun = runKey ? loadReviewQueueRun(runKey) : null;

    return NextResponse.json({
      runs,
      activeRun,
      options: {
        statuses: REVIEW_STATUSES,
        positiveSignals: POSITIVE_TASTE_SIGNALS,
        negativeSignals: NEGATIVE_TASTE_SIGNALS,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load queue",
      },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await adminGuard(req, "review-queue:post", 120);
  if (guard) return guard;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const candidatePath = text(body.candidatePath);
    if (!candidatePath) throw new Error("candidatePath is required");

    const result = applyAdminReviewDecision(
      candidatePath,
      decisionFromBody(body),
    );

    return NextResponse.json({
      candidate: result.candidate,
      profile: {
        path: result.profilePath,
        reviewedCandidateCount: result.profile.reviewedCandidateCount,
        averageTasteRating: result.profile.averageTasteRating,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update candidate",
      },
      { status: 400 },
    );
  }
}

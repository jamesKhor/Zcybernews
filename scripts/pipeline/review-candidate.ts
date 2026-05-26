#!/usr/bin/env node
import { DEFAULT_TASTE_PROFILE_PATH } from "./taste-profile.js";
import {
  applyReviewDecision,
  reviewCandidateAndRebuildProfile,
  type ReviewDecisionInput,
  type ReviewDecisionStatus,
} from "./review-decision.js";

const args = process.argv.slice(2);

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function boolArg(name: string, defaultValue: boolean): boolean {
  const value = argValue(name);
  if (value === undefined) return defaultValue;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function requiredArg(name: string): string {
  const value = argValue(name);
  if (!value?.trim()) throw new Error(`--${name}=... is required.`);
  return value.trim();
}

function listArg(name: string): string[] {
  return (
    argValue(name)
      ?.split(/[,\s]+/)
      .map((value) => value.trim())
      .filter(Boolean) ?? []
  );
}

function decisionFromArgs(): ReviewDecisionInput {
  const rating = Number(argValue("rating") ?? argValue("taste-rating"));
  return {
    status: requiredArg("status") as ReviewDecisionStatus,
    reviewedBy: argValue("reviewer") ?? requiredArg("reviewed-by"),
    reviewedAt: argValue("reviewed-at"),
    tasteRating: rating,
    decisionReason: argValue("reason") ?? requiredArg("decision-reason"),
    tasteReason: argValue("taste-reason"),
    positiveSignals: listArg(
      "positive",
    ) as ReviewDecisionInput["positiveSignals"],
    negativeSignals: listArg(
      "negative",
    ) as ReviewDecisionInput["negativeSignals"],
    selectedReasonTags: listArg("tags"),
    siteFitNotes: argValue("site-fit"),
    readerFitNotes: argValue("reader-fit"),
    operatorNotes: argValue("notes"),
    calibrationRound: argValue("round"),
  };
}

try {
  const filePath = requiredArg("file");
  const queueRoot = argValue("queue-root") ?? "data/editorial-queue";
  const profileOutputPath =
    argValue("profile-output") ?? DEFAULT_TASTE_PROFILE_PATH;
  const shouldUpdateProfile = args.includes("--no-update-profile")
    ? false
    : boolArg("update-profile", true);
  const decision = decisionFromArgs();

  if (shouldUpdateProfile) {
    const result = reviewCandidateAndRebuildProfile(filePath, decision, {
      queueRoot,
      profileOutputPath,
    });
    console.log(
      JSON.stringify({
        event: "review_candidate_written",
        file: filePath,
        status: result.candidate.reviewer.status,
        taste_rating: result.candidate.reviewer.tasteRating,
        profile_output: result.profilePath,
        reviewed_candidates: result.profile.reviewedCandidateCount,
        average_taste_rating: result.profile.averageTasteRating,
      }),
    );
  } else {
    const candidate = applyReviewDecision(filePath, decision);
    console.log(
      JSON.stringify({
        event: "review_candidate_written",
        file: filePath,
        status: candidate.reviewer.status,
        taste_rating: candidate.reviewer.tasteRating,
        profile_output: profileOutputPath,
        profile_updated: false,
      }),
    );
  }
} catch (error) {
  console.error(
    JSON.stringify({
      event: "review_candidate_failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
}

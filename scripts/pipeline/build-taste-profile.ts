#!/usr/bin/env node
import {
  DEFAULT_TASTE_PROFILE_PATH,
  buildTasteProfileFromQueue,
  writeTasteProfile,
} from "./taste-profile.js";

const args = process.argv.slice(2);

function argValue(name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
}

const queueRoot = argValue("queue-root") ?? "data/editorial-queue";
const output = argValue("output") ?? DEFAULT_TASTE_PROFILE_PATH;
const profile = buildTasteProfileFromQueue(queueRoot);

writeTasteProfile(profile, output);

console.log(
  JSON.stringify({
    event: "editorial_taste_profile_written",
    output,
    queue_root: queueRoot,
    reviewed_candidates: profile.reviewedCandidateCount,
    average_taste_rating: profile.averageTasteRating,
    liked_ratio: profile.likedRatio,
    boost_patterns: profile.boostPatterns.slice(0, 8),
    suppress_patterns: profile.suppressPatterns.slice(0, 8),
  }),
);

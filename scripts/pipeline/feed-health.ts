/**
 * Feed health observability — Phase B A2.4.
 *
 * Writes `data/feed-health.json` after each ingest run so we (and Sam's
 * daily digest) can see which feeds are failing and for how long.
 *
 * Shape per-feed:
 *   {
 *     lastSuccess:          ISO ts | null,  // most recent successful fetch
 *     lastAttempt:          ISO ts,          // timestamp of latest run, success or not
 *     consecutiveFailures:  number,          // resets to 0 on any success
 *     recent:               [{ at, ok, items?, error? }, ...]  // capped at N
 *   }
 *
 * Design rules:
 *   - The pure computation lives in `updateFeedHealth()` which takes an
 *     existing-state map + a run-result map and returns the new state.
 *     No fs, no clock, no logging — testable in isolation.
 *   - The fs wrapper (`loadFeedHealth`, `saveFeedHealth`) is thin and
 *     swallows errors: a failed write must NEVER crash ingestion.
 *   - `recent[]` is capped so the JSON file stays bounded even after
 *     months of daily runs.
 */
import fs from "fs";
import path from "path";

const HEALTH_PATH = path.join(process.cwd(), "data", "feed-health.json");
const RECENT_CAP = 20;

/** One entry in the bounded `recent` log. */
export interface FeedHealthRun {
  /** ISO timestamp of the fetch attempt. */
  at: string;
  /** True if the fetch succeeded (regardless of item count). */
  ok: boolean;
  /** Items returned (only set on success). */
  items?: number;
  /** Error message (only set on failure; capped to 200 chars). */
  error?: string;
}

export interface FeedHealthEntry {
  lastSuccess: string | null;
  lastAttempt: string;
  consecutiveFailures: number;
  recent: FeedHealthRun[];
}

export type FeedHealthState = Record<string, FeedHealthEntry>;

/**
 * One fetch result fed into the reducer. Keyed by the producer so we
 * can map sourceId → FeedSource.id without passing the full source.
 */
export interface FeedRunResult {
  sourceId: string;
  ok: boolean;
  at: string;
  items?: number;
  error?: string;
}

/** PURE reducer. Takes the previous state and the current run, returns new state. */
export function updateFeedHealth(
  prev: FeedHealthState,
  runs: FeedRunResult[],
): FeedHealthState {
  const next: FeedHealthState = { ...prev };
  for (const run of runs) {
    const existing = next[run.sourceId] ?? {
      lastSuccess: null,
      lastAttempt: run.at,
      consecutiveFailures: 0,
      recent: [],
    };
    const entry: FeedHealthEntry = {
      lastSuccess: run.ok ? run.at : existing.lastSuccess,
      lastAttempt: run.at,
      consecutiveFailures: run.ok ? 0 : existing.consecutiveFailures + 1,
      recent: [
        {
          at: run.at,
          ok: run.ok,
          ...(run.items !== undefined ? { items: run.items } : {}),
          ...(run.error !== undefined
            ? { error: run.error.slice(0, 200) }
            : {}),
        },
        ...existing.recent,
      ].slice(0, RECENT_CAP),
    };
    next[run.sourceId] = entry;
  }
  return next;
}

/** Best-effort load. Missing file → empty map; parse error → empty map. */
export function loadFeedHealth(): FeedHealthState {
  try {
    const raw = fs.readFileSync(HEALTH_PATH, "utf-8");
    return JSON.parse(raw) as FeedHealthState;
  } catch {
    return {};
  }
}

/** Best-effort write. Swallows all errors — ingestion must not crash. */
export function saveFeedHealth(state: FeedHealthState): void {
  try {
    fs.writeFileSync(
      HEALTH_PATH,
      JSON.stringify(state, null, 2) + "\n",
      "utf-8",
    );
  } catch (err) {
    console.warn(
      `[feed-health] Failed to write ${HEALTH_PATH}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Sam's digest reads these thresholds — exported here so the digest
 * script and this writer agree on the same definitions.
 */
export const FEED_HEALTH_THRESHOLDS = {
  /** ≥3 consecutive failures → red alert in digest. */
  redFailureCount: 3,
  /** Last success > this many ms ago → yellow alert. */
  yellowStaleMs: 24 * 60 * 60 * 1000,
} as const;

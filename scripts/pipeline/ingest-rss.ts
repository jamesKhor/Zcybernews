import Parser from "rss-parser";
import { ENABLED_SOURCES, type FeedSource } from "../sources/feeds.js";
import { withWallClockTimeout } from "./timeout.js";
import {
  deduplicate,
  loadRecentPublished,
  titleSimilarity,
  shareSlugPrefix,
  extractCVEs,
  SIMILARITY_THRESHOLD,
  PUBLISHED_LOOKBACK_DAYS,
  type Story,
} from "../utils/dedup.js";
import { isProcessed } from "../utils/cache.js";
import { limit, withRetry } from "../utils/rate-limit.js";
import { isVendorPR, vendorPrEnforceEnabled } from "./filters/vendor-pr.js";
import { fetchNvd } from "./fetchers/nvd.js";
import {
  loadFeedHealth,
  saveFeedHealth,
  updateFeedHealth,
  type FeedRunResult,
} from "./feed-health.js";

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "ZCyberNews/1.0 Pipeline (+https://zcybernews.com)",
    Accept: "application/rss+xml, application/xml, text/xml",
  },
});

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Wall-clock timeout for RSS feed fetches (A2.1 fix 2026-04-22).
// rss-parser's internal `timeout` is a socket-read timeout — if a feed
// responds slowly enough that the library keeps the stream alive (a
// drip-feed attack or a misconfigured origin), parseURL can hang
// indefinitely and block `Promise.allSettled` in ingestFeeds(). The
// Parser timeout gets a 5s buffer against the wall-clock guard so
// library-level errors propagate with their original message when
// possible.
const FEED_WALL_CLOCK_MS = 20_000;

async function fetchRss(source: FeedSource): Promise<Story[]> {
  const feed = await withWallClockTimeout(
    parser.parseURL(source.url),
    FEED_WALL_CLOCK_MS,
    `rss ${source.id}`,
  );
  const fetchedAt = new Date().toISOString();
  return (feed.items ?? []).slice(0, 25).map((item, i) => ({
    id: `${source.id}-${item.guid ?? item.link ?? i}`,
    title: item.title ?? "Untitled",
    url: item.link ?? "",
    excerpt: stripHtml(
      item.contentSnippet ?? item.content ?? item.summary ?? "",
    ).slice(0, 400),
    sourceName: source.name,
    publishedAt: item.pubDate ?? item.isoDate ?? new Date().toISOString(),
    tags: (item.categories ?? []).slice(0, 5),
    // A2.2 additive fields — see Story type in dedup.ts.
    sourceId: source.id,
    sourceCategory: source.category,
    fetchedAt,
    qualityScore: source.qualityScore ?? 1.0,
    isVendor: false,
  }));
}

type CisaKevEntry = {
  cveID: string;
  vulnerabilityName: string;
  shortDescription: string;
  requiredAction: string;
  dateAdded: string;
  dueDate: string;
  vendorProject: string;
  product: string;
};

async function fetchCisaKev(source: FeedSource): Promise<Story[]> {
  const res = await fetch(source.url, {
    headers: { "User-Agent": "ZCyberNews/1.0 Pipeline" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`CISA KEV HTTP ${res.status}`);
  const data = (await res.json()) as { vulnerabilities: CisaKevEntry[] };
  const fetchedAt = new Date().toISOString();
  return (data.vulnerabilities ?? []).slice(0, 20).map((v) => ({
    id: `cisa-kev-${v.cveID}`,
    title: `[${v.cveID}] ${v.vulnerabilityName}`,
    url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
    excerpt: `${v.shortDescription} Required action: ${v.requiredAction} Due: ${v.dueDate}`,
    sourceName: source.name,
    publishedAt: new Date(v.dateAdded).toISOString(),
    tags: [v.vendorProject, v.product, "KEV", "CISA"].filter(Boolean),
    // A2.2 additive fields — see Story type in dedup.ts.
    sourceId: source.id,
    sourceCategory: source.category,
    fetchedAt,
    qualityScore: source.qualityScore ?? 1.0,
    isVendor: false,
  }));
}

/** Fetch all enabled feeds, deduplicate, filter already-processed URLs. */
export async function ingestFeeds(maxStories = 20): Promise<Story[]> {
  console.log(`[ingest] Fetching ${ENABLED_SOURCES.length} RSS sources…`);

  const results = await Promise.allSettled(
    ENABLED_SOURCES.map((source) =>
      limit(() =>
        withRetry(() => {
          // Dispatch by source.type. `nvd-json` shipped 2026-04-22 as
          // the authoritative vulnerabilities primary source. Any
          // unknown type falls through to RSS (rss-parser handles
          // most feeds robustly).
          if (source.type === "cisa-kev") return fetchCisaKev(source);
          if (source.type === "nvd-json") return fetchNvd(source);
          return fetchRss(source);
        }),
      ),
    ),
  );

  const all: Story[] = [];
  // A2.4 feed-health observability — collect per-source run results.
  const healthRuns: FeedRunResult[] = [];
  const runAt = new Date().toISOString();
  for (const [i, result] of results.entries()) {
    const source = ENABLED_SOURCES[i];
    if (!source) continue;
    if (result.status === "fulfilled") {
      all.push(...result.value);
      healthRuns.push({
        sourceId: source.id,
        ok: true,
        at: runAt,
        items: result.value.length,
      });
    } else {
      console.warn(`[ingest] Failed ${source.name}:`, result.reason);
      healthRuns.push({
        sourceId: source.id,
        ok: false,
        at: runAt,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      });
    }
  }

  // Persist health state. Best-effort — a failed write must not abort
  // ingestion, so loadFeedHealth / saveFeedHealth are try-wrapped at
  // the module boundary.
  try {
    const prevHealth = loadFeedHealth();
    const nextHealth = updateFeedHealth(prevHealth, healthRuns);
    saveFeedHealth(nextHealth);
  } catch (err) {
    console.warn(
      "[feed-health] update failed (non-fatal):",
      err instanceof Error ? err.message : err,
    );
  }

  console.log(`[ingest] Fetched ${all.length} raw stories`);

  // A2.3 vendor-PR filter. Log-only by default; flip
  // VENDOR_PR_ENFORCE=true to drop after the FP-rate-<2% gate per
  // Raymond's A2.6 plan. Classification populates Story.isVendor
  // regardless of enforce mode so downstream stages (engine, fact-
  // check) can read it for priority / gating decisions.
  const enforceVendor = vendorPrEnforceEnabled();
  let vendorFlagged = 0;
  const classified = all.map((s) => {
    const v = isVendorPR({ title: s.title, excerpt: s.excerpt });
    if (v.isVendor) {
      vendorFlagged++;
      console.log(
        `[vendor-pr] ${enforceVendor ? "DROP" : "flag"} ${s.sourceId ?? s.sourceName} ` +
          `(${v.reason}): "${s.title.slice(0, 80)}"`,
      );
    }
    return { ...s, isVendor: v.isVendor };
  });
  console.log(
    `[vendor-pr] Flagged ${vendorFlagged}/${all.length} ` +
      `(mode=${enforceVendor ? "ENFORCE" : "log-only"})`,
  );
  const postFilter = enforceVendor
    ? classified.filter((s) => !s.isVendor)
    : classified;
  // Swap the local binding so subsequent stages (sort, dedup) operate
  // on the post-filter collection. Deliberately keeping the same
  // variable name so the rest of the function reads unchanged.
  all.length = 0;
  all.push(...postFilter);

  // Sort by date descending
  all.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  // Dedup by title similarity + URL
  const deduped = deduplicate(all);
  console.log(`[ingest] After dedup: ${deduped.length} stories`);

  // Filter already processed URLs
  const fresh = deduped.filter((s) => s.url && !isProcessed(s.url));
  console.log(`[ingest] Fresh (not yet processed): ${fresh.length} stories`);

  // Filter stories too similar to articles published in the last N days.
  // Checks title similarity, slug-prefix overlap (catches paraphrased
  // headlines), and shared CVE IDs.
  const published = loadRecentPublished(PUBLISHED_LOOKBACK_DAYS);
  const notCovered = fresh.filter((story) => {
    const storyCVEs = extractCVEs(`${story.title} ${story.excerpt}`);
    let reason: string | null = null;
    const tooSimilar = published.some((pub) => {
      const sim = titleSimilarity(story.title, pub.title);
      if (sim >= SIMILARITY_THRESHOLD) {
        reason = `title-similarity ${sim.toFixed(2)} vs "${pub.title}"`;
        return true;
      }
      if (shareSlugPrefix(story.title, pub.title)) {
        reason = `slug-prefix vs "${pub.title}"`;
        return true;
      }
      if (storyCVEs.length > 0 && pub.cves.length > 0) {
        const sharedCVE = storyCVEs.find((cve) => pub.cves.includes(cve));
        if (sharedCVE) {
          reason = `shared CVE ${sharedCVE} with "${pub.title}"`;
          return true;
        }
      }
      return false;
    });
    if (tooSimilar) {
      console.log(
        `[ingest] Skipping (already covered): "${story.title}" — ${reason}`,
      );
    }
    return !tooSimilar;
  });
  console.log(
    `[ingest] After published-article filter (window=${PUBLISHED_LOOKBACK_DAYS}d, threshold=${SIMILARITY_THRESHOLD}): ${notCovered.length} stories`,
  );

  return notCovered.slice(0, maxStories);
}

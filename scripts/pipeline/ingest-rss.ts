import Parser from "rss-parser";
import { fetchArticle } from "../../lib/article-fetcher.js";
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
  sharesIncidentSignature,
  type Story,
  storyIdentityKey,
} from "../utils/dedup.js";
import { isProcessed } from "../utils/cache.js";
import { limit, withRetry } from "../utils/rate-limit.js";
import { isVendorPR, vendorPrEnforceEnabled } from "./filters/vendor-pr.js";
import { isThinExcerpt } from "./filters/thin-excerpt.js";
import { fetchNvd } from "./fetchers/nvd.js";
import {
  loadFeedHealth,
  saveFeedHealth,
  updateFeedHealth,
  type FeedRunResult,
} from "./feed-health.js";
import { inferSourceTrust } from "./source-trust.js";

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
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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
  const trust = inferSourceTrust(source);
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
    sourceLanguage: source.sourceLanguage ?? "en",
    seoIntent: source.seoIntent ?? "rank-en",
    sourceType: source.type,
    ...trust,
  }));
}

type RssItem = Awaited<ReturnType<typeof parser.parseURL>>["items"][number];

function isOpenAiSecurityItem(title: string, excerpt: string): boolean {
  const text = `${title} ${excerpt}`.toLowerCase();
  return /\b(cybersecurity|cyber|security|secure|safety|provenance|supply chain|prompt injection|red team|trusted access|daybreak)\b/.test(
    text,
  );
}

async function fetchOpenAiNewsRss(source: FeedSource): Promise<Story[]> {
  const feed = await withWallClockTimeout(
    parser.parseURL(source.url),
    FEED_WALL_CLOCK_MS,
    `openai news rss ${source.id}`,
  );
  const fetchedAt = new Date().toISOString();
  const trust = inferSourceTrust(source);
  return (feed.items ?? []).slice(0, 25).flatMap((item, i) => {
    const title = item.title ?? "Untitled";
    const excerpt = stripHtml(
      item.contentSnippet ?? item.content ?? item.summary ?? "",
    ).slice(0, 400);
    if (!isOpenAiSecurityItem(title, excerpt)) return [];
    return {
      id: `${source.id}-${item.guid ?? item.link ?? i}`,
      title,
      url: item.link ?? "",
      excerpt,
      sourceName: source.name,
      publishedAt: item.pubDate ?? item.isoDate ?? new Date().toISOString(),
      tags: ["OpenAI", "AI security"],
      sourceId: source.id,
      sourceCategory: source.category,
      fetchedAt,
      qualityScore: source.qualityScore ?? 1.0,
      isVendor: true,
      sourceLanguage: source.sourceLanguage ?? "en",
      seoIntent: source.seoIntent ?? "rank-en",
      sourceType: source.type,
      ...trust,
    };
  });
}

async function fetchStaticWebPage(source: FeedSource): Promise<Story[]> {
  const fetchedAt = new Date().toISOString();
  const trust = inferSourceTrust(source);
  const fetched = await fetchArticle(source.url, FEED_WALL_CLOCK_MS);
  const title =
    !fetched.error && fetched.title !== source.url
      ? fetched.title
      : source.name;
  const excerpt = (
    !fetched.error && fetched.text ? fetched.text : (source.description ?? "")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

  if (!title || !excerpt) return [];
  return [
    {
      id: `static-${source.id}`,
      title,
      url: source.url,
      excerpt,
      sourceName: source.name,
      publishedAt: fetchedAt,
      tags: [source.category, "OpenAI", "AI security"].filter(Boolean),
      sourceId: source.id,
      sourceCategory: source.category,
      fetchedAt,
      qualityScore: source.qualityScore ?? 1.0,
      isVendor: true,
      identityKey: `static-${source.id}`,
      sourceLanguage: source.sourceLanguage ?? "en",
      seoIntent: source.seoIntent ?? "rank-en",
      sourceType: source.type,
      rawText: !fetched.error ? fetched.text : excerpt,
      ...trust,
    },
  ];
}

function paloAltoExcerptFromTitle(title: string): string {
  const severity = title.match(/\(Severity:\s*([^)]+)\)/i)?.[1]?.trim();
  const cve = title.match(/\bCVE-\d{4}-\d{4,}\b/i)?.[0];
  const cleaned = title.replace(/\s*\(Severity:\s*[^)]+\)\s*$/i, "").trim();
  const [productPart, vulnerabilityPart] = cleaned.includes(":")
    ? cleaned.split(/:\s*/, 2)
    : ["Palo Alto Networks product", cleaned];
  const product = productPart.replace(/^CVE-\d{4}-\d{4,}\s*/i, "").trim();
  const advisoryId = cve ? `${cve} ` : "";
  const severityText = severity ? `${severity.toLowerCase()} severity ` : "";

  return `${advisoryId}is a ${severityText}Palo Alto Networks advisory affecting ${product}. ${vulnerabilityPart} Review the vendor advisory and apply the listed mitigation or fixed release.`;
}

export function mapPaloAltoAdvisoryItemsToStories(
  items: RssItem[],
  source: FeedSource,
  fetchedAt: string,
): Story[] {
  const trust = inferSourceTrust(source);
  return (items ?? []).slice(0, 25).flatMap((item, i) => {
    const title = item.title?.trim() ?? "";
    const url = item.link ?? "";
    if (!title || !url) return [];

    const severity = title.match(/\(Severity:\s*([^)]+)\)/i)?.[1]?.trim();
    return {
      id: `${source.id}-${item.guid ?? url ?? i}`,
      title,
      url,
      excerpt: paloAltoExcerptFromTitle(title).slice(0, 400),
      sourceName: source.name,
      publishedAt: item.pubDate ?? item.isoDate ?? fetchedAt,
      tags: ["Palo Alto Networks", severity, ...extractCVEs(title)].filter(
        (tag): tag is string => Boolean(tag),
      ),
      sourceId: source.id,
      sourceCategory: source.category,
      fetchedAt,
      qualityScore: source.qualityScore ?? 1.0,
      isVendor: true,
      sourceLanguage: source.sourceLanguage ?? "en",
      seoIntent: source.seoIntent ?? "rank-en",
      sourceType: source.type,
      ...trust,
    };
  });
}

async function fetchPaloAltoAdvisoryRss(source: FeedSource): Promise<Story[]> {
  const feed = await withWallClockTimeout(
    parser.parseURL(source.url),
    FEED_WALL_CLOCK_MS,
    `palo alto advisory rss ${source.id}`,
  );
  return mapPaloAltoAdvisoryItemsToStories(
    feed.items ?? [],
    source,
    new Date().toISOString(),
  );
}

type WordPressPost = {
  id?: number;
  link?: string;
  date?: string;
  date_gmt?: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
};

export function mapWordPressPostsToStories(
  posts: WordPressPost[],
  source: FeedSource,
  fetchedAt: string,
): Story[] {
  const trust = inferSourceTrust(source);
  return posts.slice(0, 25).flatMap((post, i) => {
    const title = stripHtml(post.title?.rendered ?? "").trim();
    const url = post.link ?? "";
    if (!title || !url) return [];

    const publishedAt = post.date_gmt
      ? `${post.date_gmt}Z`
      : (post.date ?? fetchedAt);

    return {
      id: `${source.id}-${post.id ?? url ?? i}`,
      title,
      url,
      excerpt: stripHtml(post.excerpt?.rendered ?? "").slice(0, 400),
      sourceName: source.name,
      publishedAt: new Date(publishedAt).toISOString(),
      tags: [],
      sourceId: source.id,
      sourceCategory: source.category,
      fetchedAt,
      qualityScore: source.qualityScore ?? 1.0,
      isVendor: false,
      sourceLanguage: source.sourceLanguage ?? "en",
      seoIntent: source.seoIntent ?? "rank-en",
      sourceType: source.type,
      ...trust,
    };
  });
}

async function fetchWordPressJson(source: FeedSource): Promise<Story[]> {
  const res = await fetch(source.url, {
    headers: {
      "User-Agent": "ZCyberNews/1.0 Pipeline (+https://zcybernews.com)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(FEED_WALL_CLOCK_MS),
  });
  if (!res.ok) throw new Error(`WordPress JSON HTTP ${res.status}`);
  const posts = (await res.json()) as WordPressPost[];
  const fetchedAt = new Date().toISOString();
  return mapWordPressPostsToStories(posts, source, fetchedAt);
}

export function fetchSourceStories(source: FeedSource): Promise<Story[]> {
  if (source.type === "cisa-kev") return fetchCisaKev(source);
  if (source.type === "nvd-json") return fetchNvd(source);
  if (source.type === "openai-news-rss") return fetchOpenAiNewsRss(source);
  if (source.type === "static-web-page") return fetchStaticWebPage(source);
  if (source.type === "palo-alto-advisory-rss") {
    return fetchPaloAltoAdvisoryRss(source);
  }
  if (source.type === "wordpress-json") return fetchWordPressJson(source);
  return fetchRss(source);
}

export type CisaKevEntry = {
  cveID: string;
  vulnerabilityName: string;
  shortDescription: string;
  requiredAction: string;
  dateAdded: string;
  dueDate: string;
  vendorProject: string;
  product: string;
};

export function mapCisaKevToStories(
  entries: CisaKevEntry[],
  source: FeedSource,
  fetchedAt: string,
): Story[] {
  const trust = inferSourceTrust(source);
  return (entries ?? []).slice(0, 20).map((v) => ({
    id: `cisa-kev-${v.cveID}`,
    title: `[${v.cveID}] ${v.vulnerabilityName}`,
    url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
    identityKey: `cisa-kev-${v.cveID}`,
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
    sourceLanguage: source.sourceLanguage ?? "en",
    seoIntent: source.seoIntent ?? "rank-en",
    sourceType: source.type,
    ...trust,
  }));
}

async function fetchCisaKev(source: FeedSource): Promise<Story[]> {
  const res = await fetch(source.url, {
    headers: { "User-Agent": "ZCyberNews/1.0 Pipeline" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`CISA KEV HTTP ${res.status}`);
  const data = (await res.json()) as { vulnerabilities: CisaKevEntry[] };
  const fetchedAt = new Date().toISOString();
  return mapCisaKevToStories(data.vulnerabilities ?? [], source, fetchedAt);
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
          return fetchSourceStories(source);
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

  // Thin-excerpt filter (2026-04-24). Drops items where the RSS
  // description is boilerplate-only (SANS ISC Stormcast items are the
  // canonical case — copyright notice + link with no topic summary).
  // Unlike the vendor-PR filter, this one is HARD-ENFORCE from day one
  // because a thin-source article has no path to substantive content —
  // the LLM would either hallucinate filler (what happened with the
  // 2026-04-24 "No Major Incidents Reported" article) or produce a
  // skeleton that fails every downstream quality gate anyway. Either
  // way, zero upside + guaranteed token spend.
  const thinCountBefore = all.length;
  const afterThin: typeof all = [];
  for (const s of all) {
    const v = isThinExcerpt({ title: s.title, excerpt: s.excerpt });
    if (v.isThin) {
      console.log(
        `[thin-excerpt] DROP ${s.sourceId ?? s.sourceName} ` +
          `(${v.reason}, ${v.substantiveChars} substantive chars): "${s.title.slice(0, 80)}"`,
      );
      continue;
    }
    afterThin.push(s);
  }
  console.log(
    `[thin-excerpt] Dropped ${thinCountBefore - afterThin.length}/${thinCountBefore} boilerplate-only items`,
  );
  all.length = 0;
  all.push(...afterThin);

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
  const fresh = deduped.filter((s) => {
    const key = storyIdentityKey(s);
    return key && !isProcessed(key);
  });
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
      if (
        sharesIncidentSignature(`${story.title} ${story.excerpt}`, pub.text)
      ) {
        reason = `incident-signature vs "${pub.title}"`;
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

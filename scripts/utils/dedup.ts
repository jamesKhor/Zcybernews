/**
 * Deduplicates a list of stories by URL hash and fuzzy title similarity.
 * Keeps only the first occurrence of each near-duplicate.
 *
 * SAFETY THRESHOLDS (tuned 2026-04-14 after Agentic AI duplicate incident):
 *   - SIMILARITY_THRESHOLD = 0.50: Jaccard word overlap. Lower than the
 *     previous 0.65 to catch paraphrased titles ("Memory Attacks Threaten
 *     Cross-Session" vs "Cross-Session Memory Attack Pose Threat").
 *   - SLUG_PREFIX_OVERLAP = 4: if two stories share the first 4 normalized
 *     words of their title-slug, they're considered the same news regardless
 *     of how the rest of the slug differs ("agentic-ai-memory-attacks-threat"
 *     vs "agentic-ai-memory-attacks-threat-cross-session").
 *   - PUBLISHED_LOOKBACK_DAYS = 30: was 14. Cybersecurity stories often have
 *     follow-up coverage 2-3 weeks later; we don't want to re-publish the
 *     same news with new framing.
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";

export type Story = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  sourceName: string;
  publishedAt: string;
  tags: string[];

  // Additive fields (Phase B A2.2, 2026-04-22). All optional so any
  // pre-A2.2 Story literal continues to type-check.
  //
  // PER `feedback_fix_root_not_symptom.md` — orphan fields (those
  // currently produced but not yet consumed) are permitted ONLY when:
  //   (a) explicitly RESERVED for a named future consumer, and
  //   (b) documented in code with the reason they are not yet read.
  // Every field below that is not yet consumed carries a "RESERVED
  // FOR ..." line. If a reader lands on this file and a RESERVED
  // field is still unused 30 days from ship, delete the field in a
  // follow-up — speculation expires.
  //
  sourceId?: string;
  // CONSUMED today by: ingest-rss.ts vendor-PR log line; feed-health
  // run key; nothing else. Provides a stable routable key (unlike
  // sourceName which is the display string).
  sourceCategory?: string;
  // RESERVED FOR Stage 4 — engine selection reads FeedSource.category
  // via the story to decide targetCategory and apply the vulns-
  // without-CVE holding queue (per docs/pipeline-chain-audit-
  // 2026-04-21.md §Stage 4). Populated at ingest now so Stage 4
  // does not need to re-join on sourceId → FeedSource. Currently
  // orphan; remove if Stage 4 does not land by 2026-05-22.
  fetchedAt?: string;
  // RESERVED FOR Stage 4 + Loop A (GSC → qualityScore feedback) —
  // allows scoring stories by freshness window and correlating
  // published articles back to the ingest run that produced them.
  // Feed-health uses a separate `runAt` computed per batch, so this
  // field is NOT redundant with that. Currently orphan; remove if
  // Loop A does not land by 2026-06-01.
  qualityScore?: number;
  // RESERVED FOR Stage 4 — engine selection priority-bump for
  // higher-trust sources. Default 1.0 today (carried forward from
  // FeedSource.qualityScore when present). Deliberately NOT used
  // for selection in Stage 2 — that would perturb volume during
  // the GSC canonicalization recovery window per Raymond's A2.2
  // design note. Currently orphan; remove if Stage 4 does not
  // land by 2026-05-22.
  isVendor?: boolean;
  // CONSUMED today by: ingest-rss.ts drop logic (when
  // VENDOR_PR_ENFORCE=true); log line. A2.3 filter populates it
  // in enforce + log-only modes alike.
};

// ────────────────────────────── Tunable thresholds ──────────────────────────
export const SIMILARITY_THRESHOLD = 0.5;
export const SLUG_PREFIX_OVERLAP_WORDS = 4;
export const PUBLISHED_LOOKBACK_DAYS = 30;

// ─────────────────────────────── Helpers ────────────────────────────────────

// Stop words that don't carry semantic weight in cybersecurity titles.
// Removed from word-overlap comparisons to avoid false matches via filler.
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "and",
  "or",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "by",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "from",
  "new",
  "now",
  "report",
  "study",
  "researchers",
  "research",
  "shows",
  "reveals",
  "exposes",
  "warns",
  "discovers",
  "discovered",
  "found",
  "via",
  "after",
  "before",
  "amid",
  "while",
  "into",
  "out",
]);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split + lowercase + strip stop words for similarity comparison. */
export function meaningfulWords(title: string): string[] {
  return normalizeTitle(title)
    .split(" ")
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

export function titleSimilarity(a: string, b: string): number {
  const na = meaningfulWords(a);
  const nb = meaningfulWords(b);
  const setA = new Set(na);
  const setB = new Set(nb);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Returns true if two titles share the first N meaningful words (after
 * stop-word removal). Catches the "Agentic AI Memory Attacks ..." case
 * where two articles start identically but diverge in their tail.
 */
export function shareSlugPrefix(
  a: string,
  b: string,
  n = SLUG_PREFIX_OVERLAP_WORDS,
): boolean {
  const wa = meaningfulWords(a).slice(0, n);
  const wb = meaningfulWords(b).slice(0, n);
  if (wa.length < n || wb.length < n) return false;
  return wa.every((word, i) => word === wb[i]);
}

/**
 * Extract CVE IDs from a string (title, excerpt, etc.)
 */
export function extractCVEs(text: string): string[] {
  const matches = text.match(/CVE-\d{4}-\d{4,}/gi);
  return matches ? [...new Set(matches.map((m) => m.toUpperCase()))] : [];
}

/**
 * Check if two stories share any CVE IDs (strong duplicate signal).
 */
function sharesCVE(a: Story, b: Story): boolean {
  const cvesA = extractCVEs(`${a.title} ${a.excerpt}`);
  const cvesB = extractCVEs(`${b.title} ${b.excerpt}`);
  if (cvesA.length === 0 || cvesB.length === 0) return false;
  return cvesA.some((cve) => cvesB.includes(cve));
}

export function deduplicate(
  stories: Story[],
  similarityThreshold = SIMILARITY_THRESHOLD,
): Story[] {
  const seen: Story[] = [];

  for (const story of stories) {
    const isDuplicate = seen.some(
      (s) =>
        s.url === story.url ||
        titleSimilarity(s.title, story.title) >= similarityThreshold ||
        shareSlugPrefix(s.title, story.title) ||
        sharesCVE(s, story),
    );
    if (!isDuplicate) seen.push(story);
  }

  return seen;
}

export type PublishedArticle = {
  title: string;
  slug: string;
  cves: string[];
  date: string; // ISO YYYY-MM-DD
};

/**
 * Load published article titles and CVE IDs from content/en/ directory.
 *
 * @param withinDays - if provided, only articles within that many days are
 *   returned. If null/undefined, ALL published articles are returned (used
 *   by the shift-right post-generation check to prevent ANY duplicate
 *   reaching disk regardless of age).
 */
export function loadRecentPublishedTitles(
  withinDays = PUBLISHED_LOOKBACK_DAYS,
): string[] {
  return loadRecentPublished(withinDays).map((a) => a.title);
}

// ─── Memo cache ─────────────────────────────────────────────────────────────
//
// The hourly pipeline runs 3 article generations concurrently (p-limit=3).
// Each generation calls findDuplicateOnDisk → loadAllPublished, which
// without caching does ~280 readFileSync calls per generation = ~840 disk
// reads per pipeline run.
//
// With this memo, the FIRST call within a process parses every MDX once;
// subsequent calls return the cached array. Cache key is the combined mtime
// of the two content directories — when a new article is written (which
// updates the directory mtime), the cache invalidates automatically on the
// next call.
//
// This is the same mtime-keyed pattern lib/content.ts uses for Next.js ISR.
// Rule: never bypass loadAllPublished/loadRecentPublished by reading MDX
// directly; the memo is the single source of truth.
type CacheEntry = { mtime: number; articles: PublishedArticle[] };
const ALL_PUBLISHED_CACHE = new Map<string, CacheEntry>();

function dirMtimes(): { mtime: number; key: string } {
  const contentRoot = path.join(process.cwd(), "content", "en");
  const dirs = ["posts", "threat-intel"];
  let combined = 0;
  for (const d of dirs) {
    const p = path.join(contentRoot, d);
    if (!fs.existsSync(p)) continue;
    combined = Math.max(combined, fs.statSync(p).mtimeMs);
  }
  return { mtime: combined, key: contentRoot };
}

export function loadRecentPublished(
  withinDays: number | null = PUBLISHED_LOOKBACK_DAYS,
): PublishedArticle[] {
  // Always read the full set from cache, then filter by date in memory.
  // This way we cache once per process even when callers ask for different
  // time windows.
  const all = loadAllPublishedCached();
  if (withinDays === null) return all;
  const cutoff = Date.now() - withinDays * 24 * 60 * 60 * 1000;
  return all.filter((a) => new Date(a.date).getTime() >= cutoff);
}

/**
 * Load ALL published articles regardless of date. Used by the shift-right
 * post-generation duplicate check — we never want to ship a duplicate of
 * something already on disk, even if it was published months ago.
 *
 * NOTE: only scans content/en/. Cross-locale assumption: ZH articles are
 * always derived 1:1 from EN via translate-publish, so dedup against the
 * EN corpus is sufficient. If/when the pipeline ever generates ZH-native
 * articles directly, this needs to also scan content/zh/.
 */
export function loadAllPublished(): PublishedArticle[] {
  return loadAllPublishedCached();
}

function loadAllPublishedCached(): PublishedArticle[] {
  const { mtime, key } = dirMtimes();
  const cached = ALL_PUBLISHED_CACHE.get(key);
  if (cached && cached.mtime === mtime) {
    return cached.articles;
  }
  const articles = readAllPublishedFromDisk();
  ALL_PUBLISHED_CACHE.set(key, { mtime, articles });
  return articles;
}

function readAllPublishedFromDisk(): PublishedArticle[] {
  const contentRoot = path.join(process.cwd(), "content", "en");
  const dirs = ["posts", "threat-intel"];
  const articles: PublishedArticle[] = [];

  for (const dir of dirs) {
    const dirPath = path.join(contentRoot, dir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".mdx"));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dirPath, file), "utf-8");
        // Use gray-matter for proper YAML parsing — the previous regex
        // approach broke on titles containing colons, escaped quotes, and
        // multi-line YAML block scalars (>-). gray-matter is already a
        // dependency and properly handles these.
        const parsed = matter(raw);
        const fm = parsed.data as Record<string, unknown>;

        const title = typeof fm.title === "string" ? fm.title.trim() : "";
        const slug = typeof fm.slug === "string" ? fm.slug.trim() : "";
        const dateRaw = fm.date;
        const date =
          dateRaw instanceof Date
            ? dateRaw.toISOString().split("T")[0]
            : typeof dateRaw === "string"
              ? dateRaw.trim()
              : "";

        if (!title || !date) continue;

        articles.push({
          title,
          slug,
          cves: extractCVEs(`${title} ${parsed.content}`),
          date,
        });
      } catch {
        // skip unreadable / unparseable files
      }
    }
  }

  return articles;
}

/**
 * Test-only: clear the memo cache. Useful when tests mutate content/ on
 * disk and expect the next call to see the change. Production code never
 * needs to call this — the mtime check handles invalidation automatically.
 */
export function _clearPublishedCache(): void {
  ALL_PUBLISHED_CACHE.clear();
}

// ─── In-flight registry: prevents concurrent generations from clashing ─────
//
// The pipeline runs up to 3 article generations in parallel via p-limit(3).
// findDuplicateOnDisk only checks files ALREADY ON DISK — so two parallel
// generations that produce articles about the same news story (e.g. two
// different RSS sources reporting it differently, splitting across batches)
// would BOTH pass shift-right and BOTH write — producing a duplicate that
// neither layer caught.
//
// This in-memory Set tracks normalized titles + slugs being written by any
// in-flight pipeline task. claimSlugAndTitle() returns false if either is
// already claimed; the calling code then treats it as a duplicate. Cleared
// at process start (each pipeline run is a fresh Node process).
const IN_FLIGHT = new Set<string>();

function inFlightKey(s: string): string {
  return normalizeTitle(s);
}

/**
 * Atomically claim a (title, slug) pair as in-flight. Returns true if claim
 * succeeded (caller may proceed to write). Returns false + the conflicting
 * key if another in-flight task already claimed an equivalent title/slug.
 * The caller should treat false as a duplicate detection.
 *
 * Always pair with releaseInFlight() in a finally block — leaking claims
 * would block subsequent runs in the same process.
 */
export function claimInFlight(args: {
  title: string;
  slug: string;
}): { claimed: true } | { claimed: false; conflictWith: string } {
  const titleKey = "t:" + inFlightKey(args.title);
  const slugKey = "s:" + inFlightKey(args.slug);
  if (IN_FLIGHT.has(titleKey)) {
    return { claimed: false, conflictWith: titleKey };
  }
  if (IN_FLIGHT.has(slugKey)) {
    return { claimed: false, conflictWith: slugKey };
  }
  IN_FLIGHT.add(titleKey);
  IN_FLIGHT.add(slugKey);
  return { claimed: true };
}

export function releaseInFlight(args: { title: string; slug: string }): void {
  IN_FLIGHT.delete("t:" + inFlightKey(args.title));
  IN_FLIGHT.delete("s:" + inFlightKey(args.slug));
}

/** Test-only: clear the in-flight registry between test cases. */
export function _clearInFlight(): void {
  IN_FLIGHT.clear();
}

// ─── SHIFT-RIGHT: post-generation duplicate detection ───────────────────────

export type DuplicateMatch = {
  matchType: "title-similarity" | "slug-prefix" | "shared-cve" | "exact-slug";
  matchedTitle: string;
  matchedSlug: string;
  matchedDate: string;
  similarity?: number;
};

/**
 * Check if a freshly-generated article would duplicate an existing one.
 * Called by write-mdx.ts BEFORE writing to disk. Returns the matching
 * existing article if duplicate detected, otherwise null.
 *
 * Different from the pre-generation filter in two ways:
 *   1. Checks ALL published articles (no time window)
 *   2. Also checks slug exactness (catches the case where AI generates
 *      the same slug as an existing article — e.g. via cache miss)
 */
// How recent must a slug-prefix match be to count as a duplicate?
// Recurring monthly stories like "Microsoft Patches Critical Vulnerabilities"
// or "CISA Adds Five Flaws to KEV Catalog" share their first 4 meaningful
// words by design. If we treated those as duplicates indefinitely, we'd
// never publish a follow-up story. Restrict slug-prefix to the same
// 30-day window we use for the RSS-side filter.
const SLUG_PREFIX_LOOKBACK_DAYS = 30;

export function findDuplicateOnDisk(args: {
  title: string;
  slug: string;
  body?: string;
  similarityThreshold?: number;
}): DuplicateMatch | null {
  const {
    title,
    slug,
    body,
    similarityThreshold = SIMILARITY_THRESHOLD,
  } = args;
  const cves = body ? extractCVEs(`${title} ${body}`) : extractCVEs(title);
  const published = loadAllPublished();
  const slugPrefixCutoff =
    Date.now() - SLUG_PREFIX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  for (const pub of published) {
    // Strip the date prefix from both for fair slug comparison
    const stripDate = (s: string) => s.replace(/^\d{4}-\d{2}-\d{2}-/, "");
    if (stripDate(pub.slug) === stripDate(slug)) {
      return {
        matchType: "exact-slug",
        matchedTitle: pub.title,
        matchedSlug: pub.slug,
        matchedDate: pub.date,
      };
    }

    const sim = titleSimilarity(title, pub.title);
    if (sim >= similarityThreshold) {
      return {
        matchType: "title-similarity",
        matchedTitle: pub.title,
        matchedSlug: pub.slug,
        matchedDate: pub.date,
        similarity: sim,
      };
    }

    // Slug-prefix only counts if the pre-existing article is recent.
    // Without the time window, monthly recurring stories
    // ("Microsoft Patches X", "CISA KEV Adds Y") would block forever.
    const pubDate = new Date(pub.date).getTime();
    if (pubDate >= slugPrefixCutoff && shareSlugPrefix(title, pub.title)) {
      return {
        matchType: "slug-prefix",
        matchedTitle: pub.title,
        matchedSlug: pub.slug,
        matchedDate: pub.date,
      };
    }

    if (cves.length > 0 && pub.cves.length > 0) {
      if (cves.some((c) => pub.cves.includes(c))) {
        return {
          matchType: "shared-cve",
          matchedTitle: pub.title,
          matchedSlug: pub.slug,
          matchedDate: pub.date,
        };
      }
    }
  }

  return null;
}

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

export type Story = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  sourceName: string;
  publishedAt: string;
  tags: string[];
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

export function loadRecentPublished(
  withinDays: number | null = PUBLISHED_LOOKBACK_DAYS,
): PublishedArticle[] {
  const contentRoot = path.join(process.cwd(), "content", "en");
  const dirs = ["posts", "threat-intel"];
  const articles: PublishedArticle[] = [];
  const cutoff =
    withinDays === null ? 0 : Date.now() - withinDays * 24 * 60 * 60 * 1000;

  for (const dir of dirs) {
    const dirPath = path.join(contentRoot, dir);
    if (!fs.existsSync(dirPath)) continue;

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".mdx"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dirPath, file), "utf-8");
        const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
        if (!titleMatch?.[1]) continue;
        const dateMatch = content.match(
          /^date:\s*["']?(\d{4}-\d{2}-\d{2})["']?\s*$/m,
        );
        if (!dateMatch?.[1]) continue;
        const slugMatch = content.match(/^slug:\s*["']?(.+?)["']?\s*$/m);
        const articleDate = new Date(dateMatch[1]).getTime();
        if (articleDate >= cutoff) {
          articles.push({
            title: titleMatch[1].trim(),
            slug: (slugMatch?.[1] ?? "").trim(),
            cves: extractCVEs(content),
            date: dateMatch[1],
          });
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  return articles;
}

/**
 * Load ALL published articles regardless of date. Used by the shift-right
 * post-generation duplicate check — we never want to ship a duplicate of
 * something already on disk, even if it was published months ago.
 */
export function loadAllPublished(): PublishedArticle[] {
  return loadRecentPublished(null);
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

    if (shareSlugPrefix(title, pub.title)) {
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

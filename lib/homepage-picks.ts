/**
 * Homepage hero + ticker selection logic (Phase 2, 2026-04-18).
 *
 * The 3-column hero at the top of the homepage uses DIFFERENTIATED selection
 * rules per column — not just "top 3 by recency." Each column has a visual
 * role (text-forward / photo / severity-tint), and the article picked for
 * each slot must MATCH that role to avoid redundancy.
 *
 * Selection rules — see docs/redesign-phase-2-spec.md "FINAL LOCKED DESIGN":
 *   LEFT  = highest-severity article in last 24h, prefer threat-intel
 *   CENTER = most-recent article WITH a featured_image (the ONE photo)
 *   RIGHT = highest-severity vulnerability in last 7d (CVSS ≥ 7.0 preferred)
 *
 * Dedup: if one article wins two slots, the higher-priority slot keeps it
 * (LEFT > CENTER > RIGHT) and the loser falls to its next-best candidate.
 *
 * Ticker = next 5 most-recent, excluding the 3 used in hero.
 */
import type { Article } from "@/lib/content";

export type ArticleWithSource = Article & {
  _sourceType: "posts" | "threat-intel";
};

export interface HeroPicks {
  left: ArticleWithSource | null;
  center: ArticleWithSource | null;
  right: ArticleWithSource | null;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  informational: 1,
};

function severityScore(a: ArticleWithSource): number {
  return SEVERITY_RANK[a.frontmatter.severity ?? "informational"] ?? 0;
}

function dateMs(a: ArticleWithSource): number {
  return new Date(a.frontmatter.date).getTime();
}

function hoursAgo(a: ArticleWithSource, now: number): number {
  return (now - dateMs(a)) / (1000 * 60 * 60);
}

/**
 * Pick the LEFT hero — text-forward lead.
 * Highest-severity in last 24h, prefer threat-intel. Ties → recency.
 * Fallback: most recent threat-intel.
 */
function pickLeft(
  pool: ArticleWithSource[],
  now: number,
): ArticleWithSource | null {
  const last24 = pool.filter((a) => hoursAgo(a, now) <= 24);
  if (last24.length > 0) {
    const sorted = [...last24].sort((a, b) => {
      // Higher severity wins
      const sevDiff = severityScore(b) - severityScore(a);
      if (sevDiff !== 0) return sevDiff;
      // Threat-intel preferred on tie
      const tiDiff =
        (b._sourceType === "threat-intel" ? 1 : 0) -
        (a._sourceType === "threat-intel" ? 1 : 0);
      if (tiDiff !== 0) return tiDiff;
      // Most recent wins
      return dateMs(b) - dateMs(a);
    });
    // Only accept if severity is at least medium (otherwise fall through)
    if (severityScore(sorted[0]) >= SEVERITY_RANK.medium) return sorted[0];
  }
  // Fallback: most recent threat-intel
  const ti = pool
    .filter((a) => a._sourceType === "threat-intel")
    .sort((a, b) => dateMs(b) - dateMs(a));
  return ti[0] ?? pool[0] ?? null;
}

/**
 * Pick the CENTER hero — photo lead. The ONE photo on the page.
 * Most recent article with a `featured_image` frontmatter field.
 * Fallback: most recent article overall (will render category-default SVG).
 */
function pickCenter(pool: ArticleWithSource[]): ArticleWithSource | null {
  const withImage = pool
    .filter((a) => !!a.frontmatter.featured_image)
    .sort((a, b) => dateMs(b) - dateMs(a));
  if (withImage[0]) return withImage[0];
  // Fallback: most recent overall
  const sorted = [...pool].sort((a, b) => dateMs(b) - dateMs(a));
  return sorted[0] ?? null;
}

/**
 * Pick the RIGHT hero — severity-forward tint card.
 * Highest-severity vulnerability in last 7d (CVSS ≥ 7.0 preferred).
 * Fallback: highest-severity threat-intel of any recency.
 */
function pickRight(
  pool: ArticleWithSource[],
  now: number,
): ArticleWithSource | null {
  const last7d = pool.filter((a) => hoursAgo(a, now) <= 24 * 7);
  const vulnsWithCvss = last7d
    .filter(
      (a) =>
        a.frontmatter.category === "vulnerabilities" &&
        typeof a.frontmatter.cvss_score === "number" &&
        (a.frontmatter.cvss_score ?? 0) >= 7.0,
    )
    .sort((a, b) => {
      const sevDiff = severityScore(b) - severityScore(a);
      if (sevDiff !== 0) return sevDiff;
      return (b.frontmatter.cvss_score ?? 0) - (a.frontmatter.cvss_score ?? 0);
    });
  if (vulnsWithCvss[0]) return vulnsWithCvss[0];

  // Fallback: highest-severity threat-intel overall
  const ti = pool
    .filter((a) => a._sourceType === "threat-intel")
    .sort((a, b) => {
      const sevDiff = severityScore(b) - severityScore(a);
      if (sevDiff !== 0) return sevDiff;
      return dateMs(b) - dateMs(a);
    });
  return ti[0] ?? null;
}

/**
 * Compute the 3-column hero picks with dedup.
 * Returns {left, center, right}, any of which may be null if the dataset
 * is too small to fill the slot even after fallback.
 */
export function pickHero(pool: ArticleWithSource[]): HeroPicks {
  const now = Date.now();
  const left = pickLeft(pool, now);
  const usedSlugs = new Set<string>();
  if (left) usedSlugs.add(left.frontmatter.slug);

  // Center: exclude left
  const centerPool = pool.filter((a) => !usedSlugs.has(a.frontmatter.slug));
  const center = pickCenter(centerPool);
  if (center) usedSlugs.add(center.frontmatter.slug);

  // Right: exclude left + center
  const rightPool = pool.filter((a) => !usedSlugs.has(a.frontmatter.slug));
  const right = pickRight(rightPool, now);

  return { left, center, right };
}

/**
 * Pick the "More from today" ticker — 5 most recent, excluding hero 3.
 */
export function pickTicker(
  pool: ArticleWithSource[],
  hero: HeroPicks,
  limit = 5,
): ArticleWithSource[] {
  const heroSlugs = new Set(
    [hero.left, hero.center, hero.right]
      .filter((a): a is ArticleWithSource => a !== null)
      .map((a) => a.frontmatter.slug),
  );
  return pool
    .filter((a) => !heroSlugs.has(a.frontmatter.slug))
    .sort((a, b) => dateMs(b) - dateMs(a))
    .slice(0, limit);
}

/** Relative time formatter ("2h", "4d", "just now") for ticker rows. */
export function relativeTime(isoDate: string, now = Date.now()): string {
  const ms = now - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

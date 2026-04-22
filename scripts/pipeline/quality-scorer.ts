/**
 * Article quality scorer — pure module for the daily quality audit.
 *
 * Ship context (2026-04-22): Plausible shows ~14 real humans / 7 days
 * mostly from Bing + LinkedIn + Teams shares. We are NOT in a traffic
 * scaling problem; we are in a trust-preservation problem. Each thin
 * or hedging article bleeds the small audience we've earned. This
 * scorer flags those articles so we can triage daily before the next
 * publish cycle.
 *
 * This module is PURE: takes frontmatter + body, returns a score +
 * flag set. No fs, no network, no logging. All fs + CLI concerns
 * live in `scripts/audit-published-quality.ts` (the caller).
 *
 * SCORING MODEL (v1, tune as we learn):
 *
 *   wordCount          — hard number; bucket against category floor
 *   structuredRichness — 0..5 bitmask count (cve_ids, cvss_score,
 *                        threat_actor, iocs, ttp_matrix)
 *   hasReferences      — body contains "## References" heading
 *   tagCount           — 3–6 is healthy; 0–2 is thin, 7+ is keyword-stuffed
 *   hedgingHits        — count of CVE_HEDGING_PATTERNS matches (from
 *                        scripts/pipeline/fact-check.ts). Any > 0 is a
 *                        SERIOUS flag — these were the trust-killers
 *                        that shipped on 6 articles in April.
 *
 * Flags are grouped by severity so a reader can scan:
 *   - SERIOUS: hedging phrases, word count way below floor, empty
 *     structured fields in a vulnerabilities article (CVE hard-gate
 *     regression).
 *   - WARN: tag count out of range, missing references, structured
 *     fields below 2.
 *   - OK: none of the above.
 */
import { CVE_HEDGING_PATTERNS } from "./fact-check.js";
import type { ArticleFrontmatter } from "../../lib/types.js";

// ─── Tunables ────────────────────────────────────────────────────────

/**
 * Word-count floors per category. A vulnerabilities article with 200
 * words is almost always thin; a tools article can legitimately be
 * shorter. Tune these as the corpus grows — today's values are the
 * 25th percentile observed in a sample-of-50 spot audit on 2026-04-22.
 */
const WORD_COUNT_FLOOR: Record<string, number> = {
  "threat-intel": 700,
  vulnerabilities: 600,
  malware: 600,
  industry: 400,
  tools: 400,
  ai: 400,
};

/**
 * Categories where missing structured fields (cve_ids / iocs / etc)
 * is a SERIOUS flag rather than just a WARN. Vulns without CVE IDs
 * is the pattern we burned 6 articles on.
 */
const STRUCTURED_REQUIRED_CATEGORIES = new Set(["vulnerabilities"]);

const TAG_MIN = 3;
const TAG_MAX = 6;

// ─── Types ────────────────────────────────────────────────────────────

export type FlagSeverity = "serious" | "warn";

export interface QualityFlag {
  severity: FlagSeverity;
  code: string; // stable grep-target string
  message: string;
}

export interface QualityScore {
  slug: string;
  locale: string;
  section: "posts" | "threat-intel";
  category: string;
  date: string;

  wordCount: number;
  wordCountFloor: number;
  belowFloor: boolean;

  /** How many of the 5 structured fields are populated. */
  structuredRichness: number;
  /** Which of the 5 slots are filled (for reporting). */
  structuredFields: {
    cve_ids: boolean;
    cvss_score: boolean;
    threat_actor: boolean;
    iocs: boolean;
    ttp_matrix: boolean;
  };

  tagCount: number;
  hasReferences: boolean;
  hedgingHits: string[]; // the matched phrases, for triage

  flags: QualityFlag[];
  /** 0..10 headline score — useful for sorting the daily report. */
  headlineScore: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Whitespace-split word count. Good enough for triage; not a linter. */
export function countWords(body: string): number {
  const stripped = body
    // Drop fenced code blocks and markdown tables — they pad the count
    // without reflecting reading length.
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\|[^\n]*\|/g, "")
    // Drop markdown link syntax, keep visible text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
  if (stripped.length === 0) return 0;
  return stripped.split(/\s+/).filter(Boolean).length;
}

/** True if body contains a References section heading. */
export function hasReferencesSection(body: string): boolean {
  return /(^|\n)##\s+References\s*(\n|$)/i.test(body);
}

/** Count matches of the CVE_HEDGING_PATTERNS in title + excerpt + body. */
export function findHedgingHits(
  title: string,
  excerpt: string,
  body: string,
): string[] {
  const haystack = `${title}\n${excerpt}\n${body}`;
  const hits: string[] = [];
  for (const rx of CVE_HEDGING_PATTERNS) {
    const m = rx.exec(haystack);
    if (m) hits.push(m[0]);
  }
  return hits;
}

/** Count which of the 5 structured fields are populated. */
function countStructuredFields(f: ArticleFrontmatter): {
  count: number;
  slots: QualityScore["structuredFields"];
} {
  const slots = {
    cve_ids: Array.isArray(f.cve_ids) && f.cve_ids.length > 0,
    cvss_score: typeof f.cvss_score === "number" && f.cvss_score > 0,
    threat_actor:
      typeof f.threat_actor === "string" && f.threat_actor.trim().length > 0,
    iocs: Array.isArray(f.iocs) && f.iocs.length > 0,
    ttp_matrix: Array.isArray(f.ttp_matrix) && f.ttp_matrix.length > 0,
  };
  const count = Object.values(slots).filter(Boolean).length;
  return { count, slots };
}

/** Compute a 0..10 headline score — higher = better. Used for sorting. */
function computeHeadlineScore(
  partial: Omit<QualityScore, "headlineScore" | "flags">,
): number {
  let s = 10;
  if (partial.belowFloor) {
    // Proportional to how far below floor; up to -3
    const ratio = partial.wordCount / partial.wordCountFloor;
    s -= Math.min(3, Math.round((1 - ratio) * 5));
  }
  // Each missing structured field costs 0.5 up to max of -2.5
  s -= (5 - partial.structuredRichness) * 0.5;
  // Tags out of range: -1
  if (partial.tagCount < TAG_MIN || partial.tagCount > TAG_MAX) s -= 1;
  // No references: -1
  if (!partial.hasReferences) s -= 1;
  // Hedging phrases: -3 per hit (cap the damage at the whole score)
  s -= partial.hedgingHits.length * 3;
  return Math.max(0, Math.round(s * 10) / 10);
}

// ─── Public API ──────────────────────────────────────────────────────

export interface ScoreInput {
  slug: string;
  locale: string;
  section: "posts" | "threat-intel";
  frontmatter: ArticleFrontmatter;
  body: string;
}

/**
 * Score one article. Pure function — same input always yields the
 * same output. Caller is responsible for loading MDX files from disk.
 */
export function scoreArticle(input: ScoreInput): QualityScore {
  const { slug, locale, section, frontmatter, body } = input;

  const wordCount = countWords(body);
  const category = frontmatter.category ?? "industry";
  const wordCountFloor = WORD_COUNT_FLOOR[category] ?? 400;
  const belowFloor = wordCount < wordCountFloor;

  const { count: structuredRichness, slots: structuredFields } =
    countStructuredFields(frontmatter);

  const tagCount = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.length
    : 0;
  const hasRef = hasReferencesSection(body);
  const hedgingHits = findHedgingHits(
    frontmatter.title ?? "",
    frontmatter.excerpt ?? "",
    body,
  );

  // Build flags in severity order. Each flag has a stable `code` that
  // downstream tooling (daily digest, Discord post) can group on.
  const flags: QualityFlag[] = [];

  // SERIOUS
  if (hedgingHits.length > 0) {
    flags.push({
      severity: "serious",
      code: "hedging_phrase",
      message: `Hedging phrase detected (${hedgingHits.length}× — first: "${hedgingHits[0]}"). This class of phrase shipped on 6 articles in April 2026 and is an editorial trust killer.`,
    });
  }
  if (belowFloor && wordCount < wordCountFloor * 0.6) {
    flags.push({
      severity: "serious",
      code: "word_count_way_below_floor",
      message: `Word count ${wordCount} is <60% of category floor ${wordCountFloor} (${category}). Article is likely thin.`,
    });
  }
  if (
    STRUCTURED_REQUIRED_CATEGORIES.has(category) &&
    structuredRichness === 0
  ) {
    flags.push({
      severity: "serious",
      code: "vuln_no_structured_fields",
      message: `Category is "${category}" but zero structured fields populated (no cve_ids/cvss/iocs/ttps/actor). Violates the CVE hard-gate spirit.`,
    });
  }
  if (
    STRUCTURED_REQUIRED_CATEGORIES.has(category) &&
    !structuredFields.cve_ids
  ) {
    flags.push({
      severity: "serious",
      code: "vuln_no_cve_ids",
      message: `Category "${category}" requires at least one real CVE ID in frontmatter.cve_ids.`,
    });
  }

  // WARN
  if (belowFloor && wordCount >= wordCountFloor * 0.6) {
    flags.push({
      severity: "warn",
      code: "word_count_below_floor",
      message: `Word count ${wordCount} is below category floor ${wordCountFloor} (${category}).`,
    });
  }
  if (tagCount < TAG_MIN) {
    flags.push({
      severity: "warn",
      code: "tags_too_few",
      message: `Tag count ${tagCount} < ${TAG_MIN}. Thin tag surface reduces tag-page ranking flow.`,
    });
  }
  if (tagCount > TAG_MAX) {
    flags.push({
      severity: "warn",
      code: "tags_too_many",
      message: `Tag count ${tagCount} > ${TAG_MAX}. Keyword-stuffing signal risk.`,
    });
  }
  if (!hasRef) {
    flags.push({
      severity: "warn",
      code: "missing_references",
      message: `No "## References" section found. E-E-A-T signal lost.`,
    });
  }
  if (!STRUCTURED_REQUIRED_CATEGORIES.has(category) && structuredRichness < 2) {
    flags.push({
      severity: "warn",
      code: "structured_fields_thin",
      message: `Only ${structuredRichness}/5 structured fields populated. Thin scorecard reduces downstream value.`,
    });
  }

  const partial = {
    slug,
    locale,
    section,
    category,
    date: frontmatter.date ?? "",
    wordCount,
    wordCountFloor,
    belowFloor,
    structuredRichness,
    structuredFields,
    tagCount,
    hasReferences: hasRef,
    hedgingHits,
  };
  const headlineScore = computeHeadlineScore(partial);

  return { ...partial, flags, headlineScore };
}

/**
 * Aggregate a list of scores for the daily report. Pure.
 */
export interface QualitySummary {
  total: number;
  seriousCount: number;
  warnCount: number;
  okCount: number;
  avgHeadlineScore: number;
  avgWordCount: number;
  avgStructuredRichness: number;
  byCategory: Record<
    string,
    { count: number; avgScore: number; serious: number }
  >;
  byLocale: Record<string, { count: number; avgScore: number }>;
  topFlagCodes: Array<{ code: string; count: number }>;
}

export function summarize(scores: QualityScore[]): QualitySummary {
  const total = scores.length;
  if (total === 0) {
    return {
      total: 0,
      seriousCount: 0,
      warnCount: 0,
      okCount: 0,
      avgHeadlineScore: 0,
      avgWordCount: 0,
      avgStructuredRichness: 0,
      byCategory: {},
      byLocale: {},
      topFlagCodes: [],
    };
  }

  let seriousCount = 0;
  let warnCount = 0;
  let okCount = 0;
  let sumScore = 0;
  let sumWords = 0;
  let sumStructured = 0;
  const byCategory: QualitySummary["byCategory"] = {};
  const byLocale: QualitySummary["byLocale"] = {};
  const flagCounts: Record<string, number> = {};

  for (const s of scores) {
    const hasSerious = s.flags.some((f) => f.severity === "serious");
    const hasWarn = s.flags.some((f) => f.severity === "warn");
    if (hasSerious) seriousCount++;
    else if (hasWarn) warnCount++;
    else okCount++;

    sumScore += s.headlineScore;
    sumWords += s.wordCount;
    sumStructured += s.structuredRichness;

    const cat = s.category;
    if (!byCategory[cat]) {
      byCategory[cat] = { count: 0, avgScore: 0, serious: 0 };
    }
    byCategory[cat].count++;
    byCategory[cat].avgScore += s.headlineScore;
    if (hasSerious) byCategory[cat].serious++;

    if (!byLocale[s.locale]) {
      byLocale[s.locale] = { count: 0, avgScore: 0 };
    }
    byLocale[s.locale].count++;
    byLocale[s.locale].avgScore += s.headlineScore;

    for (const f of s.flags) {
      flagCounts[f.code] = (flagCounts[f.code] ?? 0) + 1;
    }
  }

  for (const c of Object.keys(byCategory)) {
    byCategory[c].avgScore =
      Math.round((byCategory[c].avgScore / byCategory[c].count) * 10) / 10;
  }
  for (const l of Object.keys(byLocale)) {
    byLocale[l].avgScore =
      Math.round((byLocale[l].avgScore / byLocale[l].count) * 10) / 10;
  }

  const topFlagCodes = Object.entries(flagCounts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    total,
    seriousCount,
    warnCount,
    okCount,
    avgHeadlineScore: Math.round((sumScore / total) * 10) / 10,
    avgWordCount: Math.round(sumWords / total),
    avgStructuredRichness: Math.round((sumStructured / total) * 10) / 10,
    byCategory,
    byLocale,
    topFlagCodes,
  };
}

export { WORD_COUNT_FLOOR, STRUCTURED_REQUIRED_CATEGORIES, TAG_MIN, TAG_MAX };

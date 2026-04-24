/**
 * Thin-excerpt filter — rejects feed items whose title + excerpt
 * combined carry no substantive content to reason about.
 *
 * Phase B post-audit (2026-04-24). SANS ISC Stormcast entries in the
 * RSS feed carry only boilerplate in the description:
 *
 *   <description>(c) SANS Internet Storm Center. https://isc.sans.edu
 *   Creative Commons Attribution-Noncommercial 3.0...</description>
 *
 * The actual topics are embedded in the PODCAST audio at
 * /podcastdetail/NNNN, not in the RSS item. When this reaches our
 * pipeline, the LLM gets ~150 chars of copyright notice + a generic
 * title and hallucinates a "nothing to report today" article to
 * satisfy the word-count target.
 *
 * The prompt's REJECT rule #5 (TOO-THIN) is shift-right at generation
 * time and proved unreliable — the LLM can construct plausible-looking
 * filler from thin air. This filter fires at INGEST, before any token
 * spend, and cannot be "reasoned around."
 *
 * Pure module — no fs, network, logging, state. Safe to unit-test
 * and call from both ingest-rss.ts and a batch-audit against
 * content/ (a future use).
 */

/**
 * Boilerplate patterns stripped from excerpts BEFORE counting
 * substantive chars. Extending this list is cheap; keep each entry
 * focused on a single recognizable shape so we don't over-strip
 * legitimate article prose.
 */
const BOILERPLATE_PATTERNS: RegExp[] = [
  // Copyright notices
  /\(c\)\s+[^.]+?(?:\.|$)/gi,
  /©\s+\d{4}[^.]*?\./g,
  /Copyright\s+[^.]+?\./gi,
  // Creative Commons attribution blocks
  /Creative\s+Commons\s+[A-Z][A-Za-z-]*(?:\s+\d(?:\.\d)?)?[^.]*?\./gi,
  // RSS boilerplate
  /This\s+(?:entry|post|article)\s+was\s+originally\s+published[^.]*?\./gi,
  /Read\s+(?:more|the\s+full\s+story)[^.]*?\./gi,
  /Source:\s+[A-Z][^.]*?\./g,
  /\[Read\s+More\]/gi,
  // Common tracking / analytics residue
  /feedburner\.(?:com|google)\S*/gi,
  /feedproxy\.google\.com\S*/gi,
  /utm_\w+=[^\s&]+/gi,
];

/** Minimum substantive chars required for a feed item to pass. */
const MIN_SUBSTANTIVE_CHARS = 120;

export interface ThinExcerptInput {
  title: string;
  excerpt: string;
}

export interface ThinExcerptVerdict {
  /** True if the item is too thin to feed to the LLM. */
  isThin: boolean;
  /** Remaining char count after boilerplate strip. Useful for tuning. */
  substantiveChars: number;
  /** Grep-friendly reason label when isThin is true. */
  reason?: "empty" | "boilerplate-only" | "below-threshold";
}

/**
 * Strip boilerplate from a single excerpt, then return the length of
 * what remains (collapsed whitespace).
 */
function substantiveCharCount(excerpt: string): number {
  let cleaned = excerpt;
  for (const re of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(re, " ");
  }
  // Collapse whitespace + strip common punctuation-only remnants
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.length;
}

/**
 * Decide whether a feed item's excerpt carries enough substance to
 * be worth generating against.
 *
 * The title is NOT counted toward the threshold — titles are routinely
 * keyword-stuffed / wrap-style ("ISC Stormcast For Friday, April 24th,
 * 2026 https://isc.sans.edu/podcastdetail/9906, (Fri, Apr 24th)") and
 * their length has no relationship to actual source richness.
 *
 * @example
 *   isThinExcerpt({
 *     title: "ISC Stormcast For Friday, April 24th, 2026",
 *     excerpt: "(c) SANS Internet Storm Center. https://isc.sans.edu Creative Commons ...",
 *   })
 *   // { isThin: true, substantiveChars: 0, reason: "boilerplate-only" }
 */
export function isThinExcerpt(input: ThinExcerptInput): ThinExcerptVerdict {
  const excerpt = (input.excerpt ?? "").trim();
  if (excerpt.length === 0) {
    return { isThin: true, substantiveChars: 0, reason: "empty" };
  }
  const substantiveChars = substantiveCharCount(excerpt);
  if (substantiveChars === 0) {
    return { isThin: true, substantiveChars: 0, reason: "boilerplate-only" };
  }
  if (substantiveChars < MIN_SUBSTANTIVE_CHARS) {
    return { isThin: true, substantiveChars, reason: "below-threshold" };
  }
  return { isThin: false, substantiveChars };
}

/** Exported for tests + tuning. */
export const THIN_EXCERPT_INTERNALS = {
  BOILERPLATE_PATTERNS,
  MIN_SUBSTANTIVE_CHARS,
  substantiveCharCount,
};

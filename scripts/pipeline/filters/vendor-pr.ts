/**
 * Vendor-PR filter — shift-left guard that catches marketing/press-
 * release content BEFORE it reaches the LLM, saving DeepSeek tokens
 * on content that would fail the fact-check gate downstream anyway.
 *
 * Phase B A2.3 (Raymond's Stage-2 audit, 2026-04-21). Designed per the
 * chain-audit doc regex; ships in LOG-ONLY mode first so we can
 * measure the false-positive rate on real traffic before turning on
 * enforcement. Flip `VENDOR_PR_ENFORCE=true` (env var) to drop flagged
 * stories at ingest.
 *
 * This module is PURE: no fs, network, console, state. It classifies
 * a single Story and returns the verdict. Logging + enforcement live
 * at the call site (ingest-rss.ts).
 *
 * Two signals, combined with OR:
 *   1. TITLE pattern — brand-led PR-shaped announcement verbs like
 *      "Acme Announces Q2 Results", "Vendor Launches AI Platform".
 *      High precision; false positives are rare because security-news
 *      headlines rarely match the `Brand Verb ...` structure.
 *   2. EXCERPT pattern — PR-marketing keywords ("webinar", "whitepaper",
 *      "register now", "download the report", "press release") AND
 *      NO CVE ID anywhere in title or excerpt. The AND-no-CVE clause
 *      is critical: an article mentioning "CVE-2026-1234 disclosed in
 *      a press release" should NOT be filtered.
 */

export interface VendorPrVerdict {
  /** True if the story is classified as vendor PR / marketing. */
  isVendor: boolean;
  /** Grep-friendly label describing which signal fired. Null when !isVendor. */
  reason?: "title-pattern" | "pr-keywords-no-cve";
}

/**
 * Title pattern — matches "Brand Announces/Launches/…" shapes.
 * - `^[A-Z][\w\.&\- ]+` captures the brand (1+ words starting with a
 *   capital letter; allows dots, ampersands, hyphens).
 * - ` (Announces|…)\b` is the PR verb list curated from real feeds.
 *
 * Kept as /i (case insensitive) but the leading `[A-Z]` anchor still
 * rejects all-lowercase headlines — those are almost never press
 * releases.
 */
const TITLE_PR_PATTERN =
  /^[A-Z][\w\.&\- ]+ (Announces|Launches|Unveils|Introduces|Releases|Expands|Partners|Achieves|Joins|Names|Appoints|Acquires|Wins|Recognized|Earns|Celebrates|Welcomes)\b/i;

const PR_KEYWORDS_PATTERN =
  /\b(?:webinar|whitepaper|register now|download the report|press release)\b/i;

/** Anchored CVE ID matcher used inside the haystack check. Stateless
 *  so the test loop can call repeatedly on the same string without
 *  the /g lastIndex trap. */
const CVE_ID_PATTERN = /CVE-\d{4}-\d{4,7}/i;

export interface VendorPrInput {
  title: string;
  excerpt?: string;
}

/**
 * Classify a story as vendor-PR or not.
 *
 * @example
 *   isVendorPR({ title: "Acme Announces Q2 Results", excerpt: "" })
 *   // { isVendor: true, reason: "title-pattern" }
 *
 *   isVendorPR({ title: "New RCE in Widget", excerpt: "Register now for webinar" })
 *   // { isVendor: true, reason: "pr-keywords-no-cve" }
 *
 *   isVendorPR({ title: "CVE-2026-1234 disclosed", excerpt: "Download the report" })
 *   // { isVendor: false }  ← CVE escape hatch
 */
export function isVendorPR(input: VendorPrInput): VendorPrVerdict {
  const title = input.title ?? "";
  const excerpt = input.excerpt ?? "";
  const haystack = `${title}\n${excerpt}`;

  if (TITLE_PR_PATTERN.test(title)) {
    return { isVendor: true, reason: "title-pattern" };
  }

  if (PR_KEYWORDS_PATTERN.test(excerpt) && !CVE_ID_PATTERN.test(haystack)) {
    return { isVendor: true, reason: "pr-keywords-no-cve" };
  }

  return { isVendor: false };
}

/**
 * Environment gate for enforcement. Default false (log-only). Flip via
 * `VENDOR_PR_ENFORCE=true` once the measured FP rate over ≥7 days of
 * real traffic is <2% (Raymond's A2.6 gate).
 */
export function vendorPrEnforceEnabled(): boolean {
  return process.env.VENDOR_PR_ENFORCE === "true";
}

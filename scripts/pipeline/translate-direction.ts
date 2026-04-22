/**
 * Translation direction routing — Single Source of Truth (SSoT) for the
 * §3.A routing matrix from docs/pipeline-contracts-2026-04-22.md.
 *
 * Producer (generate-article) MUST NOT decide translation direction.
 * Ingest MUST call getTranslationDirection() BEFORE write-mdx.
 *
 * This module is PURE: no fs, network, console, or state mutation.
 * All 8 cells (2 sourceLang × 4 seoIntent) are covered — see unit tests.
 *
 * First PR of Phase B per Vincent's §9 migration note. No consumer
 * wire-up in this PR; subsequent PRs refactor write sites to call this.
 */

// TODO: import from scripts/contracts/schemas.ts once that PR lands (Phase B step 1).
// Kept local for this standalone PR — shapes match v2 schema defaults.
export type SeoIntent = "rank-en" | "rank-zh" | "rank-both" | "ingest-only";
export type SourceLanguage = "en" | "zh";

export interface SourceMetadata {
  id: string;
  seoIntent?: SeoIntent; // default "rank-en" per v2 schema
  // Additional fields exist on the real SourceMetadata; we only read these two.
}

export interface ArticleDraft {
  sourceLanguage?: SourceLanguage; // default "en" per v2 schema
  // Additional fields exist on the real ArticleDraft; we only read this one.
}

export type TranslationDecision =
  | { action: "publish-en-only" }
  | { action: "publish-zh-only"; translate: false }
  | { action: "translate-and-publish-both"; direction: "en-to-zh" }
  | { action: "translate-and-publish-zh-only"; direction: "en-to-zh" }
  | { action: "ingest-signal-only" }
  | { action: "soft-block"; reason: string };

/** Stable soft-block reason strings. Grep-targets for operator tooling. */
export const SOFT_BLOCK_REASONS = {
  RANK_EN_REQUIRES_EN_SOURCE: "rank-en requires EN source",
  RANK_BOTH_ZH_NOT_SUPPORTED:
    "ZH→EN translation not supported until Cycle 2 — set seoIntent=rank-zh or wait",
} as const;

export function getTranslationDirection(
  source: SourceMetadata,
  article: ArticleDraft,
): TranslationDecision {
  const intent: SeoIntent = source.seoIntent ?? "rank-en";
  const lang: SourceLanguage = article.sourceLanguage ?? "en";

  if (intent === "ingest-only") {
    return { action: "ingest-signal-only" };
  }

  if (intent === "rank-en") {
    if (lang === "en") return { action: "publish-en-only" };
    return {
      action: "soft-block",
      reason: SOFT_BLOCK_REASONS.RANK_EN_REQUIRES_EN_SOURCE,
    };
  }

  if (intent === "rank-zh") {
    if (lang === "en") {
      return {
        action: "translate-and-publish-zh-only",
        direction: "en-to-zh",
      };
    }
    return { action: "publish-zh-only", translate: false };
  }

  // intent === "rank-both"
  if (lang === "en") {
    return { action: "translate-and-publish-both", direction: "en-to-zh" };
  }
  return {
    action: "soft-block",
    reason: SOFT_BLOCK_REASONS.RANK_BOTH_ZH_NOT_SUPPORTED,
  };
}

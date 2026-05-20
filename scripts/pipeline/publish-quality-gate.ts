import type { GeneratedArticle } from "../ai/schemas/article-schema.js";
import type { ArticleFrontmatter } from "../../lib/types.js";
import {
  scoreArticle,
  type QualityFlag,
  type QualityScore,
} from "./quality-scorer.js";

export interface PublishQualityDecision {
  allowed: boolean;
  score: QualityScore;
  blockingFlags: QualityFlag[];
}

const BLOCKING_WARN_CODES = new Set([
  "missing_references",
  "title_too_short",
  "title_too_long",
  "excerpt_too_short",
  "excerpt_too_long",
]);
const STRUCTURED_THIN_BLOCK_CATEGORIES = new Set([
  "threat-intel",
  "vulnerabilities",
]);

function buildFrontmatterForScoring(
  article: GeneratedArticle,
  sourceUrls: string[],
  date: string,
): ArticleFrontmatter {
  return {
    title: article.title,
    slug: article.slug,
    date,
    excerpt: article.excerpt,
    category: article.category,
    tags: article.tags,
    language: "en",
    source_urls: sourceUrls,
    author: "ZCyberNews",
    draft: false,
    ...(article.severity ? { severity: article.severity } : {}),
    ...(article.cvss_score !== null ? { cvss_score: article.cvss_score } : {}),
    ...(article.cve_ids.length ? { cve_ids: article.cve_ids } : {}),
    ...(article.threat_actor ? { threat_actor: article.threat_actor } : {}),
    ...(article.threat_actor_origin
      ? { threat_actor_origin: article.threat_actor_origin }
      : {}),
    ...(article.affected_sectors.length
      ? { affected_sectors: article.affected_sectors }
      : {}),
    ...(article.affected_regions.length
      ? { affected_regions: article.affected_regions }
      : {}),
    ...(article.iocs.length ? { iocs: article.iocs } : {}),
    ...(article.ttp_matrix.length ? { ttp_matrix: article.ttp_matrix } : {}),
  };
}

function hasIncidentDepth(
  article: GeneratedArticle,
  sourceUrls: string[],
  score: QualityScore,
): boolean {
  return (
    article.category === "threat-intel" &&
    sourceUrls.length >= 2 &&
    score.wordCount >= score.wordCountFloor * 0.8 &&
    Boolean(
      article.threat_actor ||
      article.affected_sectors.length > 0 ||
      article.affected_regions.length > 0 ||
      article.cve_ids.length > 0,
    )
  );
}

function isBlockingFlag(
  flag: QualityFlag,
  article: GeneratedArticle,
  sourceUrls: string[],
  score: QualityScore,
): boolean {
  if (flag.severity === "serious") return true;
  if (BLOCKING_WARN_CODES.has(flag.code)) return true;
  if (
    flag.code === "structured_fields_thin" &&
    hasIncidentDepth(article, sourceUrls, score)
  ) {
    return false;
  }
  return (
    flag.code === "structured_fields_thin" &&
    STRUCTURED_THIN_BLOCK_CATEGORIES.has(article.category)
  );
}

export function evaluatePublishQuality(
  article: GeneratedArticle,
  sourceUrls: string[],
  date = new Date().toISOString().split("T")[0]!,
): PublishQualityDecision {
  const section =
    article.category === "threat-intel" ? "threat-intel" : "posts";
  const score = scoreArticle({
    slug: article.slug,
    locale: "en",
    section,
    frontmatter: buildFrontmatterForScoring(article, sourceUrls, date),
    body: article.body,
  });
  const blockingFlags = score.flags.filter((flag) =>
    isBlockingFlag(flag, article, sourceUrls, score),
  );

  return {
    allowed: blockingFlags.length === 0,
    score,
    blockingFlags,
  };
}

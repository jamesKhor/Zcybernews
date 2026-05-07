import type { Article, ArticleFrontmatter, PublishTier } from "./types";

export const PUBLIC_PUBLISH_TIERS = new Set<PublishTier>(["public", "report"]);
export const INDEXABLE_PUBLISH_TIERS = new Set<PublishTier>([
  "brief",
  "public",
  "report",
]);

const PRIMARY_AUTHORITY_HOSTS = new Set([
  "cisa.gov",
  "nvd.nist.gov",
  "cve.org",
  "mitre.org",
  "cert.europa.eu",
  "ncsc.gov.uk",
  "cert.gov.ua",
  "us-cert.cisa.gov",
  "msrc.microsoft.com",
  "security.microsoft.com",
  "support.microsoft.com",
  "security.googleblog.com",
  "project-zero.issues.chromium.org",
]);

const PRIMARY_AUTHORITY_PATH_RE =
  /(?:advisory|advisories|bulletin|security-update|security-advisory|psirt|vulnerability|kev|cve|notice|breach|incident|research)/i;

export interface PublicGateResult {
  pass: boolean;
  tier: PublishTier;
  reasons: string[];
}

export interface PublicGateOptions {
  wordCount?: number;
  wordCountFloor?: number;
  hasReferences?: boolean;
  hedgingHits?: string[];
}

const MIN_INDEXABLE_WORD_RATIO = 0.6;

function normalizeHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function hasTwoIndependentSources(sourceUrls: string[]): boolean {
  const hosts = new Set(
    sourceUrls.map(normalizeHost).filter((host): host is string => !!host),
  );
  return hosts.size >= 2;
}

function isPrimaryAuthorityUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^(www|m)\./, "").toLowerCase();
    return (
      PRIMARY_AUTHORITY_HOSTS.has(host) ||
      host.endsWith(".gov") ||
      PRIMARY_AUTHORITY_PATH_RE.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function hasConcreteExcerptSignal(frontmatter: ArticleFrontmatter): boolean {
  const haystack = `${frontmatter.title} ${frontmatter.excerpt}`;
  return (
    /(CVE-\d{4}-\d{4,}|KB\d{6,}|APT\d{1,3}|[A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)+|\d[\d,.]*\s*(?:million|billion|users|records|systems|devices|%|\$))/i.test(
      haystack,
    ) || /[\u4e00-\u9fff]/.test(haystack)
  );
}

function hasThreatIntelStructuredValue(
  frontmatter: ArticleFrontmatter,
): boolean {
  return Boolean(
    frontmatter.threat_actor ||
    (frontmatter.iocs?.length ?? 0) > 0 ||
    (frontmatter.ttp_matrix?.length ?? 0) > 0 ||
    (frontmatter.affected_sectors?.length ?? 0) > 0 ||
    (frontmatter.affected_regions?.length ?? 0) > 0 ||
    (frontmatter.cve_ids?.length ?? 0) > 0,
  );
}

function hasStrongSingleSourceEvidence(
  frontmatter: ArticleFrontmatter,
): boolean {
  return Boolean(
    (frontmatter.cve_ids?.length ?? 0) > 0 ||
    typeof frontmatter.cvss_score === "number" ||
    frontmatter.threat_actor ||
    (frontmatter.iocs?.length ?? 0) > 0 ||
    (frontmatter.ttp_matrix?.length ?? 0) > 0 ||
    ((frontmatter.affected_sectors?.length ?? 0) > 0 &&
      (frontmatter.affected_regions?.length ?? 0) > 0),
  );
}

export function getPublishTier(frontmatter: ArticleFrontmatter): PublishTier {
  return frontmatter.publish_tier ?? "brief";
}

export function getEffectivePublishTier(
  frontmatter: ArticleFrontmatter,
): PublishTier {
  const storedTier = getPublishTier(frontmatter);
  if (storedTier === "brief" && evaluatePublicGate(frontmatter).pass) {
    return "public";
  }
  return storedTier;
}

export function isPublicFrontmatter(frontmatter: ArticleFrontmatter): boolean {
  return PUBLIC_PUBLISH_TIERS.has(getEffectivePublishTier(frontmatter));
}

function isFutureScheduled(frontmatter: ArticleFrontmatter): boolean {
  if (!frontmatter.scheduled_publish) return false;
  const scheduled = new Date(frontmatter.scheduled_publish).getTime();
  return Number.isFinite(scheduled) && scheduled > Date.now();
}

/**
 * Page-level indexability is wider than public promotion.
 *
 * `brief` pages are intentionally omitted from high-signal surfaces like the
 * sitemap, feed, and search index, but they should not emit `noindex` once
 * Google already knows their URLs. Only private, draft, and future-scheduled
 * content is explicitly blocked from indexing.
 */
export function isIndexableFrontmatter(
  frontmatter: ArticleFrontmatter,
): boolean {
  return (
    !frontmatter.draft &&
    !isFutureScheduled(frontmatter) &&
    INDEXABLE_PUBLISH_TIERS.has(getPublishTier(frontmatter))
  );
}

export function isPublicArticle(article: Article): boolean {
  return isPublicFrontmatter(article.frontmatter);
}

export function evaluatePublicGate(
  frontmatter: ArticleFrontmatter,
  options: PublicGateOptions = {},
): PublicGateResult {
  const reasons: string[] = [];
  const sourceUrls = frontmatter.source_urls ?? [];

  if (
    !hasTwoIndependentSources(sourceUrls) &&
    !sourceUrls.some(isPrimaryAuthorityUrl) &&
    !hasStrongSingleSourceEvidence(frontmatter)
  ) {
    reasons.push("source_depth");
  }

  if (
    typeof options.wordCount === "number" &&
    typeof options.wordCountFloor === "number" &&
    options.wordCount < options.wordCountFloor * MIN_INDEXABLE_WORD_RATIO
  ) {
    reasons.push("body_too_thin");
  }

  if (options.hasReferences === false) {
    reasons.push("missing_references");
  }

  if ((options.hedgingHits?.length ?? 0) > 0) {
    reasons.push("hedging_phrase");
  }

  if (!hasConcreteExcerptSignal(frontmatter)) {
    reasons.push("excerpt_lacks_concrete_signal");
  }

  if (
    frontmatter.category === "vulnerabilities" &&
    (frontmatter.cve_ids?.length ?? 0) === 0
  ) {
    reasons.push("vulnerability_missing_cve");
  }

  if (
    frontmatter.category === "threat-intel" &&
    !hasThreatIntelStructuredValue(frontmatter)
  ) {
    reasons.push("threat_intel_missing_structured_value");
  }

  const pass = reasons.length === 0;
  return { pass, tier: pass ? "public" : "brief", reasons };
}

export function classifyPublishTier(
  frontmatter: ArticleFrontmatter,
): PublishTier {
  return evaluatePublicGate(frontmatter).tier;
}

import { z } from "zod";

// ─── IOC ────────────────────────────────────────────────────────────────────

export const IOCTypeEnum = z.enum([
  "ip",
  "domain",
  "hash_md5",
  "hash_sha1",
  "hash_sha256",
  "url",
  "email",
  "registry_key",
  "file_path",
]);

export const IOCEntrySchema = z.object({
  type: IOCTypeEnum,
  value: z.string(),
  description: z.string().optional(),
  first_seen: z.string().optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
});

export type IOCEntry = z.infer<typeof IOCEntrySchema>;

// ─── TTP (MITRE ATT&CK) ─────────────────────────────────────────────────────

export const TTPEntrySchema = z.object({
  tactic: z.string(),
  technique_id: z.string(),
  technique_name: z.string(),
  description: z.string().optional(),
});

export type TTPEntry = z.infer<typeof TTPEntrySchema>;

// ─── Article Frontmatter ─────────────────────────────────────────────────────

export const CategoryEnum = z.enum([
  "threat-intel",
  "vulnerabilities",
  "malware",
  "industry",
  "tools",
  "ai",
]);

export const SeverityEnum = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "informational",
]);

export const PublishTierEnum = z.enum(["private", "brief", "public", "report"]);

export const ArticleFrontmatterSchema = z.object({
  title: z.string(),
  slug: z.string(),
  date: z.string(),
  updated: z.string().optional(),
  excerpt: z.string(),
  category: CategoryEnum,
  tags: z.array(z.string()).default([]),
  language: z.enum(["en", "zh"]),
  locale_pair: z.string().optional(),
  source_urls: z.array(z.string()).default([]),
  author: z.string().default("AI-generated"),
  featured_image: z.string().optional(),
  featured_image_alt: z.string().optional(),
  draft: z.boolean().default(false),
  // Missing tier means legacy public content. New pipeline/admin writes set
  // this explicitly via the publication gate in lib/publication.ts.
  publish_tier: PublishTierEnum.optional(),
  public_gate_reasons: z.array(z.string()).optional(),
  cluster_key: z.string().optional(),
  source_count: z.number().int().positive().optional(),
  seo_query_target: z.string().optional(),
  seo_intent: z.string().optional(),
  seo_title_promise: z.string().optional(),
  seo_meta_promise: z.string().optional(),
  target_hub: z.string().optional(),
  internal_link_targets: z.array(z.string()).optional(),
  news_sitemap_eligible: z.boolean().optional(),
  editorial_candidate_id: z.string().optional(),
  editorial_review_status: z.enum(["approved"]).optional(),
  editorial_reviewer: z.string().optional(),
  editorial_reviewed_at: z.string().optional(),
  editorial_decision_reason: z.string().optional(),
  editorial_taste_rating: z.number().min(0.01).max(1).optional(),
  editorial_taste_reason: z.string().optional(),
  editorial_positive_signals: z.array(z.string()).optional(),
  editorial_negative_signals: z.array(z.string()).optional(),
  editorial_reason_tags: z.array(z.string()).optional(),
  editorial_site_fit_notes: z.string().optional(),
  editorial_reader_fit_notes: z.string().optional(),
  editorial_operator_notes: z.string().optional(),
  editorial_calibration_round: z.string().optional(),
  scheduled_publish: z.string().optional(),
  /**
   * 1-2 sentence ultra-condensed summary (B-022, 2026-04-23). Optional
   * — when present, renders as an editorial callout above Executive
   * Summary on the article page and used in social-share previews.
   * Different from `excerpt` (which is the meta description / SERP
   * snippet, ~155 chars). TLDR is for the IN-PAGE skim reader and may
   * be longer (up to ~280 chars).
   */
  tldr: z.string().max(280).optional(),
  // Threat intel fields (optional on regular posts)
  threat_actor: z.string().optional(),
  threat_actor_origin: z.string().optional(),
  campaign: z.string().optional(),
  ttp_matrix: z.array(TTPEntrySchema).optional(),
  iocs: z.array(IOCEntrySchema).optional(),
  severity: SeverityEnum.optional(),
  cvss_score: z.number().min(0).max(10).optional(),
  cve_ids: z.array(z.string()).optional(),
  affected_sectors: z.array(z.string()).optional(),
  affected_regions: z.array(z.string()).optional(),
});

export type ArticleFrontmatter = z.infer<typeof ArticleFrontmatterSchema>;

// ─── Article (frontmatter + content) ────────────────────────────────────────

export interface Article {
  frontmatter: ArticleFrontmatter;
  content: string;
  readingTime: number; // minutes
}

// ─── Category / Severity display helpers ────────────────────────────────────

export type Category = z.infer<typeof CategoryEnum>;
export type Severity = z.infer<typeof SeverityEnum>;
export type PublishTier = z.infer<typeof PublishTierEnum>;

export const CATEGORY_IMAGE_POOLS = {
  "threat-intel": [
    "/images/defaults/threat-intel.png",
    "/images/defaults/threat-intel-ops-room.png",
    "/images/defaults/threat-intel-network-map.png",
  ],
  vulnerabilities: [
    "/images/defaults/vulnerabilities.png",
    "/images/defaults/vulnerabilities-patch-grid.png",
    "/images/defaults/vulnerabilities-research-lab.png",
  ],
  malware: [
    "/images/defaults/malware.png",
    "/images/defaults/malware-analysis-lab.png",
    "/images/defaults/malware-c2-disruption.png",
  ],
  industry: [
    "/images/defaults/industry.png",
    "/images/defaults/industry-newsroom.png",
    "/images/defaults/industry-supply-chain.png",
  ],
  tools: ["/images/defaults/tools.png"],
  ai: ["/images/defaults/ai.png"],
} as const satisfies Record<Category, readonly string[]>;

export const CATEGORY_DEFAULT_IMAGES: Record<Category, string> = {
  "threat-intel": CATEGORY_IMAGE_POOLS["threat-intel"][0],
  vulnerabilities: CATEGORY_IMAGE_POOLS.vulnerabilities[0],
  malware: CATEGORY_IMAGE_POOLS.malware[0],
  industry: CATEGORY_IMAGE_POOLS.industry[0],
  tools: CATEGORY_IMAGE_POOLS.tools[0],
  ai: CATEGORY_IMAGE_POOLS.ai[0],
};

function stableImageSeedHash(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return hash >>> 0;
}

export function getCategoryDefaultImage(
  category: unknown,
  seed?: string | null,
): string | undefined {
  const parsed = CategoryEnum.safeParse(category);
  if (!parsed.success) return undefined;

  const pool = CATEGORY_IMAGE_POOLS[parsed.data];
  if (pool.length === 1 || !seed) return pool[0];

  const index = stableImageSeedHash(`${parsed.data}:${seed}`) % pool.length;
  return pool[index] ?? pool[0];
}

export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30",
  medium:
    "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  low: "bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30",
  informational:
    "bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30",
};

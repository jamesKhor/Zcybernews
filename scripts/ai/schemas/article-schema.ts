import { z } from "zod";

export const IOCEntrySchema = z.object({
  type: z.enum([
    "ip",
    "domain",
    "hash_md5",
    "hash_sha1",
    "hash_sha256",
    "url",
    "email",
    "registry_key",
    "file_path",
  ]),
  value: z.string(),
  description: z.string().optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  first_seen: z.string().optional(),
});

export const TTPEntrySchema = z.object({
  tactic: z.string(),
  technique_id: z.string(),
  technique_name: z.string(),
  description: z.string().optional(),
});

/**
 * What the AI must return as JSON.
 *
 * Bounds tightened 2026-04-21 (Raymond's audit). Schema rejection forces
 * the LLM to regenerate via withRetry, which is observable in logs.
 * Previous loose bounds (title.max=120, excerpt.max=300) let bad output
 * through to silent post-process truncation — operator never knew.
 */
export const GeneratedArticleSchema = z.object({
  // title: 30-80 chars. Hard reject if shorter (broken generation) or longer
  // (post-process truncation hides the LLM's failure to follow length rule).
  title: z.string().min(30).max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(8)
    .max(80),
  // excerpt: 100-200 chars. Aligns with fact-check gates (rejects >200, <100).
  excerpt: z.string().min(100).max(200),
  category: z.enum([
    "threat-intel",
    "vulnerabilities",
    "malware",
    "industry",
    "tools",
    "ai",
  ]),
  // tags: 3-8. Empty arrays previously slipped past schema → post-process
  // had to derive from title. Tighter min forces LLM to think about taxonomy.
  tags: z.array(z.string()).min(3).max(8),
  severity: z
    .enum(["critical", "high", "medium", "low", "informational"])
    .nullable(),
  cvss_score: z.number().nullable(),
  cve_ids: z.array(z.string()).transform((ids) => {
    const validCvePattern = /^CVE-\d{4}-\d{4,}$/;
    const filtered = ids.filter((id) => validCvePattern.test(id));
    const rejected = ids.filter((id) => !validCvePattern.test(id));
    if (rejected.length > 0) {
      console.warn(
        `[schema] Stripped invalid/placeholder CVE IDs: ${rejected.join(", ")}`,
      );
    }
    return filtered;
  }),
  threat_actor: z.string().nullable(),
  threat_actor_origin: z.string().nullable(),
  affected_sectors: z.array(z.string()),
  affected_regions: z.array(z.string()),
  iocs: z.array(IOCEntrySchema),
  ttp_matrix: z.array(TTPEntrySchema),
  // body: minimum 400 chars. Even "advisory" tier targets 400-700 words
  // (~2400-4200 chars). <400 chars = broken generation, force regen.
  // Cap at 25000 chars (~3500 words) — beyond that is padding/hedging.
  body: z.string().min(400).max(25000),
});

export type GeneratedArticle = z.infer<typeof GeneratedArticleSchema>;

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

/** What the AI must return as JSON */
export const GeneratedArticleSchema = z.object({
  title: z.string().max(120),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  excerpt: z.string().max(300),
  category: z.enum([
    "threat-intel",
    "vulnerabilities",
    "malware",
    "industry",
    "tools",
    "ai",
  ]),
  tags: z.array(z.string()).max(8),
  severity: z
    .enum(["critical", "high", "medium", "low", "informational"])
    .nullable(),
  cvss_score: z.number().nullable(),
  cve_ids: z.array(z.string()),
  threat_actor: z.string().nullable(),
  threat_actor_origin: z.string().nullable(),
  affected_sectors: z.array(z.string()),
  affected_regions: z.array(z.string()),
  iocs: z.array(IOCEntrySchema),
  ttp_matrix: z.array(TTPEntrySchema),
  body: z.string().min(200),
});

export type GeneratedArticle = z.infer<typeof GeneratedArticleSchema>;

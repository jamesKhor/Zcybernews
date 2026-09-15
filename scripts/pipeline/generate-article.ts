import { generateArticleText } from "../ai/provider.js";
import { buildArticlePrompt } from "../ai/prompts/article.js";
import {
  GeneratedArticleSchema,
  type GeneratedArticle,
} from "../ai/schemas/article-schema.js";
import { withRetry } from "../utils/rate-limit.js";
import type { Story } from "../utils/dedup.js";
import { storySourceText } from "./source-corpus.js";
import type { SeoBrief } from "./seo-brief.js";

export type GenerationFailureReason =
  | "empty_output"
  | "json_parse_failed"
  | "provider_error"
  | "schema_validation_failed";

export type GenerationFailure = {
  kind: "generation_failure";
  reason: GenerationFailureReason;
  detail: string;
  fieldErrors?: Record<string, string[]>;
  rawPreview?: string;
};

export function isGenerationFailure(
  result: GeneratedArticle | "reject" | GenerationFailure,
): result is GenerationFailure {
  return (
    typeof result === "object" &&
    result !== null &&
    "kind" in result &&
    result.kind === "generation_failure"
  );
}

/**
 * Classify "source richness" → target article length.
 *
 * Rationale: letting the prompt statically demand 1500+ words produces
 * hallucinated filler when the source is a two-line CVE note. Letting
 * it demand 600 words wastes depth when sources have pages of detail.
 * Adapt target to what the source actually supports.
 *
 * Classify source richness by INFO DENSITY, not char length (2026-04-21
 * rewrite after Fortinet quality incident). Char-length was the wrong
 * signal — a 2500-char vendor advisory can have ZERO substantive info
 * (no CVE, no IOCs, no actors). Forcing 2000+ word articles from info-
 * poor sources pressured the LLM to pad with hedging phrases like
 * "CVE ID not yet assigned" — which shipped publicly for 6 articles.
 *
 * New signal: count concrete info tokens in source material:
 *   • CVE IDs (real, not placeholders)
 *   • CVSS scores
 *   • IOC hashes / IPs
 *   • Named threat actors (cross-referenced with known-actors list)
 * If 0 tokens present → "advisory" mode (650-900 words, reframe away
 *   from specific-vulnerability framing).
 * 1-2 tokens → medium (1000-1400 words).
 * 3+ tokens → long (1400-2000 words).
 * 5+ tokens AND ≥2 sources → extended (1800-2600 words).
 */
const CVE_REGEX = /CVE-\d{4}-\d{4,}/gi;
// CVSS regex (updated 2026-04-22, B-010 fix).
//
// Previous form was `...(?:score|of|:|=)?\s*\d+...`. The alternation
// grouped keyword AND separator together, so after consuming `score`
// a following `:` could not be matched — and "CVSS score: 9.8" is the
// phrasing most vendor advisories use. Under-counted info tokens
// pushed some articles to shorter tiers than warranted.
//
// New structure splits keyword from separator:
//   keyword group : `(?:(?:base\s+)?score(?:\s+of)?|of)?`
//   separator    : `[:=]?`
// Both independently optional. Captures:
//   "CVSS 9.8"                    (neither)
//   "CVSS: 9.8"                   (sep only)
//   "CVSS score 9.8"              (keyword only)
//   "CVSS score: 9.8"             (both)        ← was missing
//   "CVSS Base Score: 9.8"        (both)        ← was missing
//   "CVSS score of 9.8"           (keyword)     ← was missing
//   "CVSSv3.1 base score of 9.8"  (version + keyword) ← was missing
const CVSS_REGEX =
  /CVSS(?:\s*v?[234]\.?[01]?)?\s*(?:(?:base\s+)?score(?:\s+of)?|of)?\s*[:=]?\s*\d+(?:\.\d+)?/gi;
const MD5_SHA_REGEX = /\b[a-fA-F0-9]{32,64}\b/g;

function countInfoTokens(stories: Story[]): number {
  let tokens = 0;
  for (const s of stories) {
    const text = storySourceText(s);
    tokens += (text.match(CVE_REGEX) ?? []).length;
    tokens += (text.match(CVSS_REGEX) ?? []).length;
    tokens += (text.match(MD5_SHA_REGEX) ?? []).length;
    // Simple heuristic: count proper-noun sequences (capitalized consecutive
    // words) as potential actor/org mentions. Not perfect but directionally
    // correct — an article with "ShinyHunters" + "BlackCat" + "APT28" gets
    // 3 tokens here without needing the full known-actors list at this layer.
    tokens += (text.match(/\b(?:APT|FIN|TA)\d{1,3}\b/g) ?? []).length;
  }
  return tokens;
}

export function classifySourceRichness(stories: Story[]): {
  label: "advisory" | "medium" | "long" | "extended";
  targetRange: string;
  maxOutputTokens: number;
  infoTokens: number;
} {
  const infoTokens = countInfoTokens(stories);
  const multiSource = stories.length >= 2;

  if (infoTokens === 0) {
    // No concrete info — force advisory/summary framing. Short article
    // means LLM can't pad with hedging phrases to meet length.
    return {
      label: "advisory",
      targetRange: "650-900 words",
      maxOutputTokens: 3000,
      infoTokens,
    };
  }
  if (infoTokens <= 2) {
    return {
      label: "medium",
      targetRange: "1000-1400 words",
      maxOutputTokens: 3400,
      infoTokens,
    };
  }
  if (infoTokens <= 5 || !multiSource) {
    return {
      label: "long",
      targetRange: "1400-2000 words",
      maxOutputTokens: 4000,
      infoTokens,
    };
  }
  return {
    label: "extended",
    targetRange: "1800-2600 words",
    maxOutputTokens: 5000,
    infoTokens,
  };
}

const TITLE_MAX = 70;
const EXCERPT_MAX = 180;

function truncateTitle(title: string): string {
  if (title.length <= TITLE_MAX) return title;
  const cut = title.slice(0, TITLE_MAX).replace(/\s+\S*$/, "");
  return (cut || title.slice(0, TITLE_MAX)).trim();
}

function truncateExcerpt(excerpt: string): string {
  if (excerpt.length <= EXCERPT_MAX) return excerpt;
  let cut = excerpt.slice(0, EXCERPT_MAX);
  const lastSentenceEnd = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? "),
  );
  if (lastSentenceEnd > 100) {
    return cut.slice(0, lastSentenceEnd + 1).trim();
  }
  cut = cut.replace(/\s+\S*$/, "").trim();
  if (/[.!?]$/.test(cut)) return cut.slice(0, EXCERPT_MAX);

  const suffix = "...";
  const base = cut
    .slice(0, EXCERPT_MAX - suffix.length)
    .replace(/\s+\S*$/, "")
    .trim();
  const fallback = excerpt.slice(0, EXCERPT_MAX - suffix.length).trim();
  return `${base || fallback}${suffix}`.slice(0, EXCERPT_MAX);
}

function normalizeIocType(
  type: unknown,
): GeneratedArticle["iocs"][number]["type"] | null {
  if (typeof type !== "string") return null;
  const key = type
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  const aliases: Record<string, GeneratedArticle["iocs"][number]["type"]> = {
    ip: "ip",
    ipv4: "ip",
    ipv6: "ip",
    ip_address: "ip",
    domain: "domain",
    hostname: "domain",
    host: "domain",
    md5: "hash_md5",
    hash_md5: "hash_md5",
    sha1: "hash_sha1",
    hash_sha1: "hash_sha1",
    sha_1: "hash_sha1",
    sha256: "hash_sha256",
    hash_sha256: "hash_sha256",
    sha_256: "hash_sha256",
    url: "url",
    uri: "url",
    email: "email",
    email_address: "email",
    registry: "registry_key",
    registry_key: "registry_key",
    file: "file_path",
    filepath: "file_path",
    file_path: "file_path",
    path: "file_path",
  };
  return aliases[key] ?? null;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIocEntry(
  value: unknown,
): GeneratedArticle["iocs"][number] | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  const type = normalizeIocType(rec.type);
  const iocValue = stringValue(rec.value ?? rec.indicator ?? rec.ioc);
  if (!type || !iocValue) return null;

  const confidence = stringValue(rec.confidence);
  return {
    type,
    value: iocValue,
    ...(stringValue(rec.description)
      ? { description: stringValue(rec.description)! }
      : {}),
    ...(confidence === "high" || confidence === "medium" || confidence === "low"
      ? { confidence }
      : {}),
    ...(stringValue(rec.first_seen)
      ? { first_seen: stringValue(rec.first_seen)! }
      : {}),
  };
}

function normalizeTtpEntry(
  value: unknown,
): GeneratedArticle["ttp_matrix"][number] | null {
  if (typeof value !== "object" || value === null) return null;
  const rec = value as Record<string, unknown>;
  const tactic = stringValue(rec.tactic);
  const techniqueId =
    stringValue(rec.technique_id) ??
    stringValue(rec.techniqueId) ??
    stringValue(rec.id);
  const techniqueName =
    stringValue(rec.technique_name) ??
    stringValue(rec.techniqueName) ??
    stringValue(rec.name);

  if (!tactic || !techniqueId || !techniqueName) return null;
  return {
    tactic,
    technique_id: techniqueId,
    technique_name: techniqueName,
    ...(stringValue(rec.description)
      ? { description: stringValue(rec.description)! }
      : {}),
  };
}

function normalizeGeneratedArticleCandidate(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return parsed;
  }
  const candidate = { ...(parsed as Record<string, unknown>) };

  if (typeof candidate.title === "string") {
    candidate.title = truncateTitle(candidate.title.trim());
  }
  if (typeof candidate.excerpt === "string") {
    candidate.excerpt = truncateExcerpt(candidate.excerpt.trim());
  }
  if (Array.isArray(candidate.iocs)) {
    candidate.iocs = candidate.iocs
      .map(normalizeIocEntry)
      .filter((entry): entry is GeneratedArticle["iocs"][number] => !!entry);
  }
  if (Array.isArray(candidate.ttp_matrix)) {
    candidate.ttp_matrix = candidate.ttp_matrix
      .map(normalizeTtpEntry)
      .filter(
        (entry): entry is GeneratedArticle["ttp_matrix"][number] => !!entry,
      );
  }

  return candidate;
}

function applySeoBriefFallback(parsed: unknown, seoBrief?: SeoBrief): unknown {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return parsed;
  }
  const candidate = { ...(parsed as Record<string, unknown>) };
  if (!seoBrief) return candidate;

  candidate.seo_query_target ??= seoBrief.primaryQueryTarget;
  candidate.seo_intent ??= seoBrief.searchIntent;
  candidate.seo_title_promise ??= seoBrief.titlePromise;
  candidate.seo_meta_promise ??= seoBrief.metaPromise;
  candidate.target_hub ??= seoBrief.targetHub;
  candidate.internal_link_targets ??= seoBrief.internalLinkTargets;
  candidate.featured_image_alt ??= null;
  candidate.news_sitemap_eligible ??= seoBrief.sitemapEligible;

  return candidate;
}

function cleanModelJson(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

function parseModelJson(text: string): { parsed?: unknown; error?: Error } {
  const cleaned = cleanModelJson(text);
  try {
    return { parsed: JSON.parse(cleaned) };
  } catch (err) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return { parsed: JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) };
      } catch {
        // Return the original parse error; it points at the actual model output.
      }
    }
    return {
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

function schemaFailureDetail(
  result: ReturnType<typeof GeneratedArticleSchema.safeParse>,
): {
  detail: string;
  fieldErrors: Record<string, string[]>;
} {
  if (result.success) return { detail: "", fieldErrors: {} };
  const flattened = result.error.flatten();
  return {
    detail: Object.entries(flattened.fieldErrors)
      .map(([field, errors]) => `${field}: ${errors?.join("; ")}`)
      .join(" | "),
    fieldErrors: Object.fromEntries(
      Object.entries(flattened.fieldErrors).map(([field, errors]) => [
        field,
        errors ?? [],
      ]),
    ),
  };
}

async function repairModelJson(
  rawText: string,
  failureDetail: string,
  maxOutputTokens: number,
): Promise<Awaited<ReturnType<typeof generateArticleText>> | null> {
  const repairPrompt = [
    "Return only valid JSON matching the ZCyberNews GeneratedArticle schema.",
    "Do not add markdown fences, comments, prose, or explanations.",
    "Preserve the factual claims and source-grounded details from the draft.",
    `Previous failure: ${failureDetail}`,
    "",
    "Draft to repair:",
    rawText.slice(0, 12000),
  ].join("\n");

  try {
    return await withRetry(() =>
      generateArticleText(repairPrompt, {
        maxOutputTokens,
        temperature: 0.1,
      }),
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[generate] JSON repair provider failed:", detail);
    return null;
  }
}

/**
 * Generate a single article from 1-5 source stories.
 *
 * Returns:
 *   GeneratedArticle — success
 *   "reject"         — AI determined the story is off-topic or already covered
 *   GenerationFailure — parse/schema failure
 */
export async function generateArticle(
  stories: Story[],
  recentTitles: string[] = [],
  options: { seoBrief?: SeoBrief } = {},
): Promise<GeneratedArticle | "reject" | GenerationFailure> {
  const richness = classifySourceRichness(stories);
  console.log(
    `[generate] Source richness: ${richness.label} (${richness.infoTokens} info tokens) → target ${richness.targetRange} (maxTokens=${richness.maxOutputTokens})`,
  );
  const prompt = buildArticlePrompt(stories, recentTitles, {
    targetRange: richness.targetRange,
    seoBrief: options.seoBrief,
  });

  let generated: Awaited<ReturnType<typeof generateArticleText>>;
  try {
    generated = await withRetry(() =>
      generateArticleText(prompt, {
        maxOutputTokens: richness.maxOutputTokens,
        temperature: 0.55,
      }),
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[generate] Provider failed:", detail);
    return {
      kind: "generation_failure",
      reason: "provider_error",
      detail,
    };
  }

  const { text, modelUsed, paid } = generated;

  console.log(
    `[generate] Article generated by ${modelUsed}${paid ? " (PAID)" : " (FREE)"}`,
  );

  if (!text.trim()) {
    console.error("[generate] Empty model output.");
    return {
      kind: "generation_failure",
      reason: "empty_output",
      detail: "LLM returned an empty response",
    };
  }

  let candidateText = text;
  let { parsed, error } = parseModelJson(candidateText);
  if (error) {
    console.error(
      "[generate] JSON parse failed. Attempting one repair. Raw output:\n",
      candidateText.slice(0, 500),
    );
    const repaired = await repairModelJson(
      candidateText,
      error.message,
      richness.maxOutputTokens,
    );
    if (repaired) {
      candidateText = repaired.text;
      console.log(
        `[generate] JSON repair generated by ${repaired.modelUsed}${repaired.paid ? " (PAID)" : " (FREE)"}`,
      );
      ({ parsed, error } = parseModelJson(candidateText));
    }
    if (error) {
      return {
        kind: "generation_failure",
        reason: "json_parse_failed",
        detail: error.message,
        rawPreview: candidateText.slice(0, 500),
      };
    }
  }

  // Handle AI-level reject signal — off-topic or already-covered story
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as Record<string, unknown>).reject === true
  ) {
    const reason = (parsed as Record<string, unknown>).reason ?? "unspecified";
    console.log(`[generate] AI rejected story: ${reason}`);
    return "reject";
  }

  const normalized = normalizeGeneratedArticleCandidate(
    applySeoBriefFallback(parsed, options.seoBrief),
  );
  let result = GeneratedArticleSchema.safeParse(normalized);
  if (!result.success) {
    const firstFailure = schemaFailureDetail(result);
    console.error(
      "[generate] Schema validation failed. Attempting one repair:",
      firstFailure.fieldErrors,
    );
    const repaired = await repairModelJson(
      candidateText,
      firstFailure.detail,
      richness.maxOutputTokens,
    );
    if (repaired) {
      candidateText = repaired.text;
      console.log(
        `[generate] Schema repair generated by ${repaired.modelUsed}${repaired.paid ? " (PAID)" : " (FREE)"}`,
      );
      const repairParse = parseModelJson(candidateText);
      if (repairParse.error) {
        return {
          kind: "generation_failure",
          reason: "json_parse_failed",
          detail: repairParse.error.message,
          rawPreview: candidateText.slice(0, 500),
        };
      }
      result = GeneratedArticleSchema.safeParse(
        normalizeGeneratedArticleCandidate(
          applySeoBriefFallback(repairParse.parsed, options.seoBrief),
        ),
      );
    }
    if (!result.success) {
      const failure = schemaFailureDetail(result);
      return {
        kind: "generation_failure",
        reason: "schema_validation_failed",
        detail: failure.detail,
        fieldErrors: failure.fieldErrors,
        rawPreview: candidateText.slice(0, 500),
      };
    }
  }

  return result.data;
}

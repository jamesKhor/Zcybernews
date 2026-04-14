import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { GeneratedArticle } from "../ai/schemas/article-schema.js";
import type { TranslatedMeta } from "./translate-article.js";
import {
  findDuplicateOnDisk,
  claimInFlight,
  releaseInFlight,
  type DuplicateMatch,
} from "../utils/dedup.js";

const CONTENT_DIR = path.join(process.cwd(), "content");

/** Thrown by writeArticlePair when a duplicate is detected on disk. */
export class DuplicateArticleError extends Error {
  public readonly duplicate: DuplicateMatch;
  public readonly attemptedTitle: string;
  public readonly attemptedSlug: string;

  constructor(
    attemptedTitle: string,
    attemptedSlug: string,
    duplicate: DuplicateMatch,
  ) {
    const sim =
      duplicate.similarity !== undefined
        ? ` (similarity ${duplicate.similarity.toFixed(2)})`
        : "";
    super(
      `Duplicate detected by ${duplicate.matchType}${sim}: ` +
        `attempted "${attemptedTitle}" matches existing "${duplicate.matchedTitle}" ` +
        `(${duplicate.matchedSlug}, ${duplicate.matchedDate})`,
    );
    this.name = "DuplicateArticleError";
    this.duplicate = duplicate;
    this.attemptedTitle = attemptedTitle;
    this.attemptedSlug = attemptedSlug;
  }
}

/** Detect CJK characters (Chinese/Japanese/Korean) in text */
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/;

/**
 * Valid CVE format: CVE-YYYY-NNNNN (year + at least 4 digits).
 * Anything with x's, X's, or fewer than 4 trailing digits is a placeholder.
 */
const VALID_CVE_RE = /^CVE-\d{4}-\d{4,}$/;
const PLACEHOLDER_CVE_RE = /CVE-\d{4}-[xX]{2,}[xX\d]*/g;

/**
 * Strip placeholder/hallucinated CVE IDs from article body text.
 * Replaces patterns like "CVE-2026-xxxxx" with "a zero-day vulnerability".
 */
function sanitizePlaceholderCVEs(body: string): string {
  if (!PLACEHOLDER_CVE_RE.test(body)) return body;
  console.warn(
    `[write] WARNING: Placeholder CVE IDs found in article body — stripping`,
  );
  // Reset regex lastIndex after .test()
  PLACEHOLDER_CVE_RE.lastIndex = 0;
  return body.replace(PLACEHOLDER_CVE_RE, "a zero-day vulnerability");
}

/**
 * Filter cve_ids array to only valid CVE format, stripping placeholders.
 */
function filterValidCVEs(cveIds: string[]): string[] {
  const valid = cveIds.filter((id) => VALID_CVE_RE.test(id));
  const rejected = cveIds.filter((id) => !VALID_CVE_RE.test(id));
  if (rejected.length > 0) {
    console.warn(
      `[write] Stripped invalid CVE IDs from frontmatter: ${rejected.join(", ")}`,
    );
  }
  return valid;
}

/**
 * Validate that EN content doesn't contain Chinese characters
 * and ZH content has Chinese in the body (not just English).
 * Logs a warning and strips CJK from EN articles to prevent contamination.
 */
function validateLanguage(locale: "en" | "zh", body: string): string {
  if (locale === "en" && CJK_RE.test(body)) {
    console.warn(
      `[write] WARNING: Chinese characters detected in EN article — stripping CJK characters`,
    );
    // Replace runs of CJK characters (and adjacent Chinese punctuation) with empty string
    return body
      .replace(
        /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]+/g,
        " ",
      )
      .replace(/ {2,}/g, " ");
  }
  return body;
}

function buildFrontmatter(
  article: GeneratedArticle,
  locale: "en" | "zh",
  date: string,
  datedSlug: string,
  sourceUrls: string[],
  overrides?: Partial<{ title: string; excerpt: string; locale_pair: string }>,
): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    title: overrides?.title ?? article.title,
    slug: datedSlug,
    date,
    excerpt: overrides?.excerpt ?? article.excerpt,
    category: article.category,
    tags: article.tags,
    language: locale,
    source_urls: sourceUrls,
    author: "ZCyberNews",
    draft: false,
  };

  if (overrides?.locale_pair) fm.locale_pair = overrides.locale_pair;
  if (article.severity) fm.severity = article.severity;
  if (article.cvss_score !== null) fm.cvss_score = article.cvss_score;
  const validCves = filterValidCVEs(article.cve_ids);
  if (validCves.length) fm.cve_ids = validCves;
  if (article.threat_actor) fm.threat_actor = article.threat_actor;
  if (article.threat_actor_origin)
    fm.threat_actor_origin = article.threat_actor_origin;
  if (article.affected_sectors.length)
    fm.affected_sectors = article.affected_sectors;
  if (article.affected_regions.length)
    fm.affected_regions = article.affected_regions;
  if (article.iocs.length) fm.iocs = article.iocs;
  if (article.ttp_matrix.length) fm.ttp_matrix = article.ttp_matrix;

  return fm;
}

function writeMdx(
  locale: "en" | "zh",
  type: "posts" | "threat-intel",
  datedSlug: string,
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const dir = path.join(CONTENT_DIR, locale, type);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${datedSlug}.mdx`);
  const langCleanBody = validateLanguage(locale, body);
  const cleanBody = sanitizePlaceholderCVEs(langCleanBody);
  const file = matter.stringify(cleanBody, frontmatter);
  fs.writeFileSync(filePath, file, "utf-8");
  console.log(`[write] ${filePath}`);
  return filePath;
}

/**
 * Write both EN and ZH MDX files for a generated article.
 *
 * SHIFT-RIGHT SAFETY: Before writing, calls findDuplicateOnDisk() to check
 * the freshly-generated EN article against ALL published articles. If a
 * duplicate is found (by exact slug, title similarity ≥ threshold, slug
 * prefix overlap, or shared CVE), throws DuplicateArticleError. The pipeline
 * orchestrator catches this and skips the write — no file written, no commit
 * needed, no Telegram for the skipped article. The stale .pipeline-cache
 * still records the source URL as processed so the next run doesn't re-fetch
 * it.
 *
 * This is the LAST line of defense after the shift-left filters in
 * ingest-rss.ts. Even if a duplicate slips past the RSS-side dedup (e.g.,
 * because the AI rewrote the title in a way that scored below the
 * similarity threshold), this catches it.
 */
export function writeArticlePair(
  article: GeneratedArticle,
  zhMeta: TranslatedMeta | null,
  sourceUrls: string[] = [],
): { en: string; zh: string | null } {
  const date = new Date().toISOString().split("T")[0]!;
  // Add date prefix to slug for unique filenames and consistent naming with manual articles
  const datedSlug = `${date}-${article.slug}`;
  const type: "posts" | "threat-intel" =
    article.category === "threat-intel" ? "threat-intel" : "posts";

  // ── SHIFT-RIGHT step 1: in-flight registry check ────────────────────────
  // The pipeline runs 3 article generations concurrently. findDuplicateOnDisk
  // alone only catches duplicates against files ALREADY ON DISK; it can't
  // catch the case where two parallel generations are about to write
  // duplicates of EACH OTHER (neither has written yet, so neither sees the
  // other on disk). The in-flight registry covers that gap.
  const claim = claimInFlight({ title: article.title, slug: datedSlug });
  if (!claim.claimed) {
    throw new DuplicateArticleError(article.title, datedSlug, {
      matchType: "exact-slug",
      matchedTitle: article.title,
      matchedSlug: datedSlug,
      matchedDate: date,
    });
  }

  try {
    // ── SHIFT-RIGHT step 2: disk check ────────────────────────────────────
    // Check the GENERATED title + slug + body against everything on disk.
    // If we find a match, abort cleanly instead of writing a duplicate.
    const duplicate = findDuplicateOnDisk({
      title: article.title,
      slug: datedSlug,
      body: article.body,
    });
    if (duplicate) {
      throw new DuplicateArticleError(article.title, datedSlug, duplicate);
    }

    // English
    const enFm = buildFrontmatter(article, "en", date, datedSlug, sourceUrls, {
      locale_pair: zhMeta ? datedSlug : undefined,
    });
    const enPath = writeMdx("en", type, datedSlug, enFm, article.body);

    // Chinese (if translation succeeded)
    let zhPath: string | null = null;
    if (zhMeta) {
      const zhFm = buildFrontmatter(
        article,
        "zh",
        date,
        datedSlug,
        sourceUrls,
        {
          title: zhMeta.title,
          excerpt: zhMeta.excerpt,
          locale_pair: datedSlug,
        },
      );
      zhPath = writeMdx("zh", type, datedSlug, zhFm, zhMeta.body);
    }

    return { en: enPath, zh: zhPath };
  } finally {
    // Always release the claim, success or failure. Otherwise a thrown
    // duplicate-error would block any future writes with the same title
    // for the lifetime of the process.
    releaseInFlight({ title: article.title, slug: datedSlug });
  }
}

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { GeneratedArticle } from "../ai/schemas/article-schema.js";
import type { TranslatedMeta } from "./translate-article.js";

const CONTENT_DIR = path.join(process.cwd(), "content");

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
  if (article.cve_ids.length) fm.cve_ids = article.cve_ids;
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
  const file = matter.stringify(body, frontmatter);
  fs.writeFileSync(filePath, file, "utf-8");
  console.log(`[write] ${filePath}`);
  return filePath;
}

/** Write both EN and ZH MDX files for a generated article. */
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

  // English
  const enFm = buildFrontmatter(article, "en", date, datedSlug, sourceUrls, {
    locale_pair: zhMeta ? datedSlug : undefined,
  });
  const enPath = writeMdx("en", type, datedSlug, enFm, article.body);

  // Chinese (if translation succeeded)
  let zhPath: string | null = null;
  if (zhMeta) {
    const zhFm = buildFrontmatter(article, "zh", date, datedSlug, sourceUrls, {
      title: zhMeta.title,
      excerpt: zhMeta.excerpt,
      locale_pair: datedSlug,
    });
    zhPath = writeMdx("zh", type, datedSlug, zhFm, zhMeta.body);
  }

  return { en: enPath, zh: zhPath };
}

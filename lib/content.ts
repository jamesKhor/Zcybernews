import fs from "fs";
import path from "path";
import matter from "gray-matter";
import readingTime from "reading-time";
import {
  ArticleFrontmatterSchema,
  type Article,
  type ArticleFrontmatter,
} from "./types";
export type { Article };

const CONTENT_DIR = path.join(process.cwd(), "content");

type ContentType = "posts" | "threat-intel";

function getContentDir(locale: string, type: ContentType): string {
  return path.join(CONTENT_DIR, locale, type);
}

function parseArticleFile(filePath: string): Article | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = matter(raw);

    const result = ArticleFrontmatterSchema.safeParse(data);
    if (!result.success) {
      console.warn(
        `[content] Invalid frontmatter in ${filePath}:`,
        result.error.flatten(),
      );
      return null;
    }

    const frontmatter = result.data;

    // Skip drafts in production
    if (frontmatter.draft && process.env.NODE_ENV === "production") {
      return null;
    }

    // Skip scheduled articles that haven't published yet
    if (frontmatter.scheduled_publish) {
      const publishAt = new Date(frontmatter.scheduled_publish);
      if (publishAt > new Date()) return null;
    }

    const { minutes } = readingTime(content);

    return { frontmatter, content, readingTime: Math.ceil(minutes) };
  } catch (err) {
    console.warn(`[content] Failed to parse ${filePath}:`, err);
    return null;
  }
}

// Module-level memo cache for parsed articles.
//
// WHY: Building the site previously took ~7 minutes because routes like
// /sitemap.xml, /robots.txt, /page, /favicon.ico all call getAllPosts()
// during static generation and Next.js runs them in parallel on a 1vCPU
// VPS. Each call reparses all 262 MDX files (readFileSync + gray-matter +
// Zod) — 4 parallel callers thrashing disk I/O and CPU hit the 60-second
// per-route build timeout.
//
// With this memo, the FIRST call parses the directory; subsequent calls
// are O(1) map lookups. The cache auto-invalidates when a new MDX file
// lands (directory mtime changes), so ISR correctness is preserved: when
// admin publish writes a new article to disk, the next revalidation reads
// it fresh.
interface CacheEntry {
  mtimeMs: number;
  articles: Article[];
}
const postsCache = new Map<string, CacheEntry>();

function getDirMtime(dir: string): number {
  try {
    return fs.statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

export function getAllPosts(
  locale: string,
  type: ContentType = "posts",
): Article[] {
  const dir = getContentDir(locale, type);

  // Fall back to English content if the locale directory is empty or missing
  const effectiveDir =
    fs.existsSync(dir) &&
    fs.readdirSync(dir).some((f) => f.endsWith(".mdx") || f.endsWith(".md"))
      ? dir
      : getContentDir("en", type);

  if (!fs.existsSync(effectiveDir)) return [];

  const cacheKey = `${locale}:${type}:${effectiveDir}`;
  const mtime = getDirMtime(effectiveDir);
  const cached = postsCache.get(cacheKey);
  if (cached && cached.mtimeMs === mtime) {
    return cached.articles;
  }

  const files = fs
    .readdirSync(effectiveDir)
    .filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));

  const articles = files
    .map((file) => parseArticleFile(path.join(effectiveDir, file)))
    .filter((a): a is Article => a !== null)
    // Sort by date descending
    .sort(
      (a, b) =>
        new Date(b.frontmatter.date).getTime() -
        new Date(a.frontmatter.date).getTime(),
    );

  postsCache.set(cacheKey, { mtimeMs: mtime, articles });
  return articles;
}

export function getPostBySlug(
  locale: string,
  type: ContentType,
  slug: string,
): Article | null {
  // Try requested locale first, then fall back to English
  const localesToTry = locale === "en" ? ["en"] : [locale, "en"];

  for (const l of localesToTry) {
    const dir = getContentDir(l, type);
    if (!fs.existsSync(dir)) continue;

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".mdx") || f.endsWith(".md"));

    for (const file of files) {
      const article = parseArticleFile(path.join(dir, file));
      if (article && article.frontmatter.slug === slug) {
        return article;
      }
    }
  }

  return null;
}

export function getRelatedPosts(
  current: ArticleFrontmatter,
  locale: string,
  type: ContentType = "posts",
  count = 3,
): Article[] {
  const all = getAllPosts(locale, type).filter(
    (a) => a.frontmatter.slug !== current.slug,
  );

  // Score by tag overlap + same category
  const scored = all.map((article) => {
    const tagOverlap = article.frontmatter.tags.filter((t) =>
      current.tags.includes(t),
    ).length;
    const sameCategory =
      article.frontmatter.category === current.category ? 2 : 0;
    return { article, score: tagOverlap + sameCategory };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((s) => s.article);
}

export function getAllSlugs(locale: string, type: ContentType): string[] {
  return getAllPosts(locale, type).map((a) => a.frontmatter.slug);
}

/**
 * Return the N most recent slugs by date. Used by generateStaticParams to
 * pre-render only recent articles at build time — older ones render on
 * demand via ISR. Keeps build duration bounded as the archive grows.
 */
export function getRecentSlugs(
  locale: string,
  type: ContentType,
  limit: number,
): string[] {
  return getAllPosts(locale, type)
    .slice(0, limit)
    .map((a) => a.frontmatter.slug);
}

export function getAllTags(
  locale: string,
  type: ContentType = "posts",
): string[] {
  const all = getAllPosts(locale, type);
  const tags = new Set(all.flatMap((a) => a.frontmatter.tags));
  return Array.from(tags).sort();
}

export function getAllCategories(locale: string, type: ContentType = "posts") {
  const all = getAllPosts(locale, type);
  const map = new Map<string, number>();
  for (const a of all) {
    map.set(a.frontmatter.category, (map.get(a.frontmatter.category) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

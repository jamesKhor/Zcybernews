import {
  absoluteArticleUrl,
  type ArticleLocale,
  type ArticleSection,
} from "./article-url";
import { getAllPosts } from "./content";
import { isIndexableFrontmatter, isPublicArticle } from "./publication";
import { getSiteUrl } from "./site-url";
import { NEWS_SITEMAP_PATH } from "./sitemap-paths";
import type { Article } from "./types";

export { NEWS_SITEMAP_PATH };
export const NEWS_SITEMAP_MAX_ENTRIES = 1000;
export const NEWS_SITEMAP_FRESHNESS_MS = 2 * 24 * 60 * 60 * 1000;

const LOCALES: ArticleLocale[] = ["en", "zh"];
const SECTIONS: ArticleSection[] = ["posts", "threat-intel"];

const NEWS_LANGUAGE_BY_LOCALE: Record<ArticleLocale, string> = {
  en: "en",
  zh: "zh-cn",
};

export interface NewsSitemapCandidate {
  article: Article;
  locale: ArticleLocale;
  section: ArticleSection;
}

export interface NewsSitemapOptions {
  now?: Date;
  siteUrl?: string;
}

export interface NewsSitemapEntry {
  loc: string;
  publicationName: string;
  publicationLanguage: string;
  publicationDate: string;
  title: string;
}

function parsePublicationDate(article: Article): Date | null {
  const publishedAt = new Date(article.frontmatter.date);
  if (!Number.isFinite(publishedAt.getTime())) return null;
  return publishedAt;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function getNewsSitemapCandidates(): NewsSitemapCandidate[] {
  const candidates: NewsSitemapCandidate[] = [];

  for (const locale of LOCALES) {
    for (const section of SECTIONS) {
      for (const article of getAllPosts(locale, section)) {
        candidates.push({ article, locale, section });
      }
    }
  }

  return candidates;
}

export function isNewsSitemapEligible(
  candidate: NewsSitemapCandidate,
  options: NewsSitemapOptions = {},
): boolean {
  const { article, locale } = candidate;
  const frontmatter = article.frontmatter;
  const publishedAt = parsePublicationDate(article);
  const now = options.now ?? new Date();

  if (!publishedAt) return false;
  if (frontmatter.news_sitemap_eligible !== true) return false;
  if (frontmatter.language !== locale) return false;
  if (!isIndexableFrontmatter(frontmatter)) return false;
  if (!isPublicArticle(article)) return false;

  const ageMs = now.getTime() - publishedAt.getTime();
  return ageMs >= 0 && ageMs <= NEWS_SITEMAP_FRESHNESS_MS;
}

export function selectNewsSitemapEntries(
  candidates: NewsSitemapCandidate[],
  options: NewsSitemapOptions = {},
): NewsSitemapEntry[] {
  const siteUrl = getSiteUrl(options.siteUrl);

  return candidates
    .filter((candidate) => isNewsSitemapEligible(candidate, options))
    .sort((a, b) => {
      const aTime = parsePublicationDate(a.article)?.getTime() ?? 0;
      const bTime = parsePublicationDate(b.article)?.getTime() ?? 0;
      return bTime - aTime;
    })
    .slice(0, NEWS_SITEMAP_MAX_ENTRIES)
    .map((candidate) => {
      const publishedAt = parsePublicationDate(candidate.article);
      if (!publishedAt) {
        throw new Error(
          `Invalid news sitemap publication date for ${candidate.article.frontmatter.slug}`,
        );
      }

      return {
        loc: absoluteArticleUrl(
          { slug: candidate.article.frontmatter.slug },
          candidate.locale,
          candidate.section,
          siteUrl,
        ),
        publicationName: "ZCyberNews",
        publicationLanguage: NEWS_LANGUAGE_BY_LOCALE[candidate.locale],
        publicationDate: publishedAt.toISOString(),
        title: candidate.article.frontmatter.title,
      };
    });
}

export function buildNewsSitemapXml(
  candidates: NewsSitemapCandidate[],
  options: NewsSitemapOptions = {},
): string {
  const entries = selectNewsSitemapEntries(candidates, options);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
  ];

  for (const entry of entries) {
    lines.push(
      "  <url>",
      `    <loc>${escapeXml(entry.loc)}</loc>`,
      "    <news:news>",
      "      <news:publication>",
      `        <news:name>${escapeXml(entry.publicationName)}</news:name>`,
      `        <news:language>${escapeXml(entry.publicationLanguage)}</news:language>`,
      "      </news:publication>",
      `      <news:publication_date>${escapeXml(entry.publicationDate)}</news:publication_date>`,
      `      <news:title>${escapeXml(entry.title)}</news:title>`,
      "    </news:news>",
      "  </url>",
    );
  }

  lines.push("</urlset>", "");
  return lines.join("\n");
}

export function buildCurrentNewsSitemapXml(
  options: NewsSitemapOptions = {},
): string {
  return buildNewsSitemapXml(getNewsSitemapCandidates(), options);
}

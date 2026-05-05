import type { Article, Category, Severity } from "./types";
import type { ArticleLocale, ArticleSection } from "./article-url";

export interface FeedIndexArticle {
  locale: ArticleLocale;
  section: ArticleSection;
  title: string;
  slug: string;
  excerpt: string;
  date: string;
  category: Category;
  author: string;
  tags: string[];
  severity: Severity | null;
  threat_actor: string | null;
}

export interface FeedIndex {
  generatedAt: string;
  articles: FeedIndexArticle[];
}

export function buildFeedIndexArticle(
  article: Article,
  locale: ArticleLocale,
  section: ArticleSection,
): FeedIndexArticle {
  const { frontmatter } = article;
  return {
    locale,
    section,
    title: frontmatter.title,
    slug: frontmatter.slug,
    excerpt: frontmatter.excerpt,
    date: frontmatter.date,
    category: frontmatter.category,
    author: frontmatter.author,
    tags: frontmatter.tags,
    severity: frontmatter.severity ?? null,
    threat_actor: frontmatter.threat_actor ?? null,
  };
}

export function selectFeedArticles(
  articles: FeedIndexArticle[],
  locale: ArticleLocale,
  limit = 20,
): FeedIndexArticle[] {
  return articles
    .filter((article) => article.locale === locale)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}

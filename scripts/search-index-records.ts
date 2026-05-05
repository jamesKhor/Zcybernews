import type { CustomRecord } from "pagefind";
import {
  articleUrl,
  type ArticleLocale,
  type ArticleSection,
} from "../lib/article-url.js";
import type { ArticleFrontmatter } from "../lib/types.js";
import { stripMarkdown } from "../lib/utils.js";

export const SEARCH_TAG_SEPARATOR = "\u001f";

interface SearchIndexRecordInput {
  frontmatter: ArticleFrontmatter;
  content: string;
  locale: ArticleLocale;
  section: ArticleSection;
}

function cleanSearchText(text: string): string {
  return stripMarkdown(text)
    .replace(/[{}[\]<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSearchIndexRecord({
  frontmatter,
  content,
  locale,
  section,
}: SearchIndexRecordInput): CustomRecord {
  const tags = frontmatter.tags ?? [];
  const url = articleUrl({ slug: frontmatter.slug }, locale, section);
  const bodyText = cleanSearchText(content);

  return {
    url,
    language: locale,
    content: [
      frontmatter.title,
      frontmatter.excerpt,
      frontmatter.category,
      tags.join(" "),
      bodyText,
    ]
      .filter(Boolean)
      .join("\n\n"),
    meta: {
      title: frontmatter.title,
      excerpt: frontmatter.excerpt,
      slug: frontmatter.slug,
      category: frontmatter.category,
      date: frontmatter.date,
      tags: tags.join(SEARCH_TAG_SEPARATOR),
      type: section,
    },
    filters: {
      locale: [locale],
      type: [section],
      category: [frontmatter.category],
      tags,
    },
    sort: {
      date: frontmatter.date,
    },
  };
}

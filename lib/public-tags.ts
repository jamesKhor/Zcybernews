import { getAllPosts } from "./content";
import { isPublicArticle } from "./publication";

export const PUBLIC_TAG_THRESHOLD = 5;

export function getTagArticleCount(locale: string, tag: string): number {
  const posts = getAllPosts(locale, "posts").filter(
    (article) =>
      isPublicArticle(article) && article.frontmatter.tags.includes(tag),
  ).length;
  const threatIntel = getAllPosts(locale, "threat-intel").filter(
    (article) =>
      isPublicArticle(article) && article.frontmatter.tags.includes(tag),
  ).length;
  return posts + threatIntel;
}

export function isPublicTag(locale: string, tag: string): boolean {
  return getTagArticleCount(locale, tag) >= PUBLIC_TAG_THRESHOLD;
}

import { getAllPosts } from "./content";
import { isPublicArticle } from "./publication";
import { normalizeSeoSlug } from "./seo-url-normalization";

export const PUBLIC_TAG_THRESHOLD = 5;

export function tagUrlSlug(tag: string): string {
  return normalizeSeoSlug(tag) ?? tag;
}

export function getTagArticleCount(locale: string, tag: string): number {
  const target = tagUrlSlug(tag);
  const posts = getAllPosts(locale, "posts").filter(
    (article) =>
      isPublicArticle(article) &&
      article.frontmatter.tags.some((item) => tagUrlSlug(item) === target),
  ).length;
  const threatIntel = getAllPosts(locale, "threat-intel").filter(
    (article) =>
      isPublicArticle(article) &&
      article.frontmatter.tags.some((item) => tagUrlSlug(item) === target),
  ).length;
  return posts + threatIntel;
}

export function isPublicTag(locale: string, tag: string): boolean {
  return getTagArticleCount(locale, tag) >= PUBLIC_TAG_THRESHOLD;
}

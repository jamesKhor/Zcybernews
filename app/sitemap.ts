import type { MetadataRoute } from "next";
import { getAllPosts, getAllTags } from "@/lib/content";
import { CategoryEnum } from "@/lib/types";

// Don't prerender at build time — enumerating all ~262 articles was hitting
// Next.js's 60s per-route timeout on the 2GB VPS. Generate on first request
// instead and cache for 1 hour; admin publish fires revalidatePath to refresh.
export const dynamic = "force-dynamic";
export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://zcybernews.com";
const LOCALES = ["en", "zh"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  // Static routes
  for (const locale of LOCALES) {
    entries.push(
      {
        url: `${BASE_URL}/${locale}`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 1.0,
        alternates: {
          languages: { en: `${BASE_URL}/en`, "zh-Hans": `${BASE_URL}/zh` },
        },
      },
      {
        url: `${BASE_URL}/${locale}/articles`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 0.9,
        alternates: {
          languages: {
            en: `${BASE_URL}/en/articles`,
            "zh-Hans": `${BASE_URL}/zh/articles`,
          },
        },
      },
      {
        url: `${BASE_URL}/${locale}/threat-intel`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 0.9,
        alternates: {
          languages: {
            en: `${BASE_URL}/en/threat-intel`,
            "zh-Hans": `${BASE_URL}/zh/threat-intel`,
          },
        },
      },
    );

    // Category pages
    for (const category of CategoryEnum.options) {
      entries.push({
        url: `${BASE_URL}/${locale}/categories/${category}`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.7,
        alternates: {
          languages: {
            en: `${BASE_URL}/en/categories/${category}`,
            "zh-Hans": `${BASE_URL}/zh/categories/${category}`,
          },
        },
      });
    }

    // Tag pages — only include tags with 3+ articles to avoid thin content
    const postTags = getAllTags(locale, "posts");
    const tiTags = getAllTags(locale, "threat-intel");
    const allTags = [...new Set([...postTags, ...tiTags])];
    for (const tag of allTags) {
      const postCount = getAllPosts(locale, "posts").filter((p) =>
        p.frontmatter.tags.includes(tag),
      ).length;
      const tiCount = getAllPosts(locale, "threat-intel").filter((p) =>
        p.frontmatter.tags.includes(tag),
      ).length;
      if (postCount + tiCount < 3) continue;
      entries.push({
        url: `${BASE_URL}/${locale}/tags/${tag}`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.6,
        alternates: {
          languages: {
            en: `${BASE_URL}/en/tags/${tag}`,
            "zh-Hans": `${BASE_URL}/zh/tags/${tag}`,
          },
        },
      });
    }

    // Article pages
    const posts = getAllPosts(locale, "posts");
    for (const post of posts) {
      entries.push({
        url: `${BASE_URL}/${locale}/articles/${post.frontmatter.slug}`,
        lastModified: post.frontmatter.updated
          ? new Date(post.frontmatter.updated)
          : new Date(post.frontmatter.date),
        changeFrequency: "monthly",
        priority: 0.8,
        alternates: {
          languages: {
            en: `${BASE_URL}/en/articles/${post.frontmatter.locale_pair ?? post.frontmatter.slug}`,
            "zh-Hans": `${BASE_URL}/zh/articles/${post.frontmatter.locale_pair ?? post.frontmatter.slug}`,
          },
        },
      });
    }

    // Threat intel pages
    const tiPosts = getAllPosts(locale, "threat-intel");
    for (const post of tiPosts) {
      entries.push({
        url: `${BASE_URL}/${locale}/threat-intel/${post.frontmatter.slug}`,
        lastModified: post.frontmatter.updated
          ? new Date(post.frontmatter.updated)
          : new Date(post.frontmatter.date),
        changeFrequency: "monthly",
        priority: 0.8,
        alternates: {
          languages: {
            en: `${BASE_URL}/en/threat-intel/${post.frontmatter.locale_pair ?? post.frontmatter.slug}`,
            "zh-Hans": `${BASE_URL}/zh/threat-intel/${post.frontmatter.locale_pair ?? post.frontmatter.slug}`,
          },
        },
      });
    }
  }

  return entries;
}

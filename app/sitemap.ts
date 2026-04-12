import type { MetadataRoute } from "next";
import { getAllPosts, getAllTags } from "@/lib/content";
import { CategoryEnum } from "@/lib/types";

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
      },
      {
        url: `${BASE_URL}/${locale}/articles`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 0.9,
      },
      {
        url: `${BASE_URL}/${locale}/threat-intel`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 0.9,
      },
    );

    // Category pages
    for (const category of CategoryEnum.options) {
      entries.push({
        url: `${BASE_URL}/${locale}/categories/${category}`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }

    // Tag pages
    const postTags = getAllTags(locale, "posts");
    const tiTags = getAllTags(locale, "threat-intel");
    const allTags = [...new Set([...postTags, ...tiTags])];
    for (const tag of allTags) {
      entries.push({
        url: `${BASE_URL}/${locale}/tags/${tag}`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.6,
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
      });
    }
  }

  return entries;
}

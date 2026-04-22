import type { MetadataRoute } from "next";
import { getAllPosts, getAllTags } from "@/lib/content";
import { CategoryEnum } from "@/lib/types";
import { absoluteArticleUrl } from "@/lib/article-url";

// ISR: generate on first request, cache for 1 hour, regenerate on demand.
//
// WHY NOT `dynamic = 'force-dynamic'`: Google Search Console was reporting
// "Couldn't fetch" because force-dynamic means every Googlebot request
// re-enumerates all 262 articles + tags + categories. The memo cache in
// lib/content.ts makes this ~600ms once warm, but a cold hit (e.g. after
// a PM2 restart) paid the full parse cost (~2-3s) which exceeds some of
// Googlebot's stricter timeouts on large sitemap files.
//
// ISR gives us the best of both: the first request after deploy pays the
// cost, but it's written to .next/ISR cache. Subsequent requests serve
// from cache. Admin publish / pipeline pushes fire revalidatePath to
// refresh within seconds.
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
      {
        // /sources — editorial transparency page (2026-04-22).
        // Anchors the curation-layer positioning; we want crawlers to
        // surface this alongside the main section pages.
        url: `${BASE_URL}/${locale}/sources`,
        lastModified: new Date("2026-04-22"),
        changeFrequency: "monthly",
        priority: 0.7,
        alternates: {
          languages: {
            en: `${BASE_URL}/en/sources`,
            "zh-Hans": `${BASE_URL}/zh/sources`,
          },
        },
      },
      {
        // /salary — destination page for XHS career-content funnel.
        // High priority + weekly changefreq: dataset refreshes quarterly
        // but we want crawlers to recheck often during the launch window.
        url: `${BASE_URL}/${locale}/salary`,
        lastModified: new Date("2026-04-17"),
        changeFrequency: "weekly",
        priority: 0.95,
        alternates: {
          languages: {
            en: `${BASE_URL}/en/salary`,
            "zh-Hans": `${BASE_URL}/zh/salary`,
          },
        },
      },
    );

    // /salary?market=<key> — one canonical filter URL per market per
    // locale. Google treats each as a distinct indexable result because
    // generateMetadata emits a unique title/description/canonical for
    // each. Priority slightly lower than the bare /salary (0.85 vs 0.95)
    // but above most other section pages; changefreq matches the parent.
    const SALARY_MARKET_KEYS = [
      "sg",
      "my",
      "cn-t1",
      "cn-t2",
      "au",
      "hk",
    ] as const;
    for (const mk of SALARY_MARKET_KEYS) {
      entries.push({
        url: `${BASE_URL}/${locale}/salary?market=${mk}`,
        lastModified: new Date("2026-04-17"),
        changeFrequency: "weekly",
        priority: 0.85,
        alternates: {
          languages: {
            en: `${BASE_URL}/en/salary?market=${mk}`,
            "zh-Hans": `${BASE_URL}/zh/salary?market=${mk}`,
          },
        },
      });
    }

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

    // Tag pages — only include tags with 5+ articles to avoid thin content.
    // Bumped from 3 to 5 (2026-04-20) after GSC flagged 128 pages "Crawled -
    // currently not indexed"; thin tag pages were a primary driver. Tags
    // below threshold also emit `robots: noindex, follow` on the page itself
    // (see app/[locale]/tags/[tag]/page.tsx).
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
      if (postCount + tiCount < 5) continue;
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
      // NOTE: pre-existing hreflang bug preserved intentionally — both
      // `en` and `zh-Hans` alternates use `locale_pair ?? slug`, when
      // strictly only the OTHER-locale alternate should use locale_pair
      // and the current-locale alternate should use the post's own
      // slug. The detail pages handle this correctly. Fixing in the
      // sitemap is tracked as a separate item (flagged in the B.4 wire-
      // up commit). Not fixed here so the wire-up stays surgical and
      // reversible. `absoluteArticleUrl` reproduces the string shape
      // byte-for-byte with this input.
      const alternateSlug =
        post.frontmatter.locale_pair ?? post.frontmatter.slug;
      entries.push({
        url: absoluteArticleUrl(
          { slug: post.frontmatter.slug },
          locale,
          "posts",
          BASE_URL,
        ),
        lastModified: post.frontmatter.updated
          ? new Date(post.frontmatter.updated)
          : new Date(post.frontmatter.date),
        changeFrequency: "monthly",
        priority: 0.8,
        alternates: {
          languages: {
            en: absoluteArticleUrl(
              { slug: alternateSlug },
              "en",
              "posts",
              BASE_URL,
            ),
            "zh-Hans": absoluteArticleUrl(
              { slug: alternateSlug },
              "zh",
              "posts",
              BASE_URL,
            ),
          },
        },
      });
    }

    // Threat intel pages
    const tiPosts = getAllPosts(locale, "threat-intel");
    for (const post of tiPosts) {
      // Same pre-existing hreflang bug as the articles block above.
      const alternateSlug =
        post.frontmatter.locale_pair ?? post.frontmatter.slug;
      entries.push({
        url: absoluteArticleUrl(
          { slug: post.frontmatter.slug },
          locale,
          "threat-intel",
          BASE_URL,
        ),
        lastModified: post.frontmatter.updated
          ? new Date(post.frontmatter.updated)
          : new Date(post.frontmatter.date),
        changeFrequency: "monthly",
        priority: 0.8,
        alternates: {
          languages: {
            en: absoluteArticleUrl(
              { slug: alternateSlug },
              "en",
              "threat-intel",
              BASE_URL,
            ),
            "zh-Hans": absoluteArticleUrl(
              { slug: alternateSlug },
              "zh",
              "threat-intel",
              BASE_URL,
            ),
          },
        },
      });
    }
  }

  return entries;
}

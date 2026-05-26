import { describe, expect, it } from "vitest";
import {
  buildNewsSitemapXml,
  NEWS_SITEMAP_PATH,
  selectNewsSitemapEntries,
} from "../news-sitemap";
import type { Article, ArticleFrontmatter } from "../types";

function article(overrides: Partial<ArticleFrontmatter> = {}): Article {
  const frontmatter: ArticleFrontmatter = {
    title: "Ransomware Crew Claims Example Manufacturer",
    slug: "ransomware-crew-claims-example-manufacturer",
    date: "2026-05-26T03:00:00.000Z",
    excerpt:
      "A ransomware crew claimed an example manufacturer after publishing a fresh extortion listing.",
    category: "threat-intel",
    tags: ["ransomware", "extortion"],
    language: "en",
    source_urls: ["https://www.cisa.gov/news-events/alerts/example"],
    author: "ZCyberNews",
    draft: false,
    publish_tier: "public",
    news_sitemap_eligible: true,
    affected_sectors: ["manufacturing"],
    affected_regions: ["North America"],
    ...overrides,
  };

  return {
    frontmatter,
    content: "Example article body.",
    readingTime: 4,
  };
}

describe("news sitemap", () => {
  const now = new Date("2026-05-26T12:00:00.000Z");

  it("uses a stable public XML path", () => {
    expect(NEWS_SITEMAP_PATH).toBe("/sitemaps/news.xml");
  });

  it("selects only fresh, public, explicitly news-eligible article URLs", () => {
    const entries = selectNewsSitemapEntries(
      [
        {
          article: article({ slug: "fresh-news" }),
          locale: "en",
          section: "posts",
        },
        {
          article: article({
            slug: "old-news",
            date: "2026-05-23T11:59:59.000Z",
          }),
          locale: "en",
          section: "posts",
        },
        {
          article: article({
            slug: "evergreen-ai-explainer",
            news_sitemap_eligible: false,
          }),
          locale: "en",
          section: "posts",
        },
        {
          article: article({ slug: "draft-news", draft: true }),
          locale: "en",
          section: "posts",
        },
        {
          article: article({
            slug: "private-news",
            publish_tier: "private",
          }),
          locale: "en",
          section: "posts",
        },
        {
          article: article({
            slug: "future-news",
            date: "2026-05-27T00:00:00.000Z",
          }),
          locale: "en",
          section: "posts",
        },
      ],
      { now, siteUrl: "https://zcybernews.com" },
    );

    expect(entries.map((entry) => entry.loc)).toEqual([
      "https://zcybernews.com/en/articles/fresh-news",
    ]);
  });

  it("renders Google News required tags, canonical URLs, language, and escaped XML", () => {
    const xml = buildNewsSitemapXml(
      [
        {
          article: article({
            title: "AI & Ransomware <Claims> Against Manufacturer",
            slug: "ai-ransomware-claims",
          }),
          locale: "en",
          section: "posts",
        },
        {
          article: article({
            title: "勒索软件组织声称攻击制造商",
            slug: "ransomware-claim-zh",
            language: "zh",
            date: "2026-05-26T02:00:00.000Z",
          }),
          locale: "zh",
          section: "threat-intel",
        },
      ],
      { now, siteUrl: "https://zcybernews.com" },
    );

    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    );
    expect(xml).toContain(
      "<loc>https://zcybernews.com/en/articles/ai-ransomware-claims</loc>",
    );
    expect(xml).toContain(
      "<loc>https://zcybernews.com/zh/threat-intel/ransomware-claim-zh</loc>",
    );
    expect(xml).toContain("<news:name>ZCyberNews</news:name>");
    expect(xml).toContain("<news:language>en</news:language>");
    expect(xml).toContain("<news:language>zh-cn</news:language>");
    expect(xml).toContain(
      "<news:publication_date>2026-05-26T03:00:00.000Z</news:publication_date>",
    );
    expect(xml).toContain(
      "<news:title>AI &amp; Ransomware &lt;Claims&gt; Against Manufacturer</news:title>",
    );
  });
});

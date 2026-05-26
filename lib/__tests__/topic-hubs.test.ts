import { describe, expect, it } from "vitest";
import {
  getArticleTopicHubLinks,
  getTopicHubDefinition,
  isPublicTopicHub,
  PUBLIC_TOPIC_HUB_THRESHOLD,
  selectTopicHubArticles,
  topicHubUrl,
} from "../topic-hubs";
import type { Article, ArticleFrontmatter } from "../types";

function article(
  overrides: Partial<ArticleFrontmatter> = {},
  content = "Example article body.",
): Article {
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
    affected_sectors: ["manufacturing"],
    affected_regions: ["North America"],
    ...overrides,
  };

  return { frontmatter, content, readingTime: 4 };
}

describe("topic hubs", () => {
  it("exposes stable topic hub URLs and definitions", () => {
    expect(topicHubUrl("ransomware", "en")).toBe("/en/topics/ransomware");
    expect(topicHubUrl("ai-security", "zh")).toBe("/zh/topics/ai-security");
    expect(getTopicHubDefinition("apt")?.label.en).toBe("APT Groups");
  });

  it("selects public hub articles from explicit hub fields, tags, and threat signals", () => {
    const candidates = [
      {
        article: article({
          slug: "explicit-target",
          target_hub: "ransomware",
          date: "2026-05-26T04:00:00.000Z",
        }),
        section: "posts" as const,
      },
      {
        article: article({
          slug: "internal-link-target",
          tags: ["incident-response"],
          internal_link_targets: ["ransomware"],
          date: "2026-05-26T03:00:00.000Z",
        }),
        section: "threat-intel" as const,
      },
      {
        article: article({
          slug: "tag-match",
          tags: ["lockbit", "extortion"],
          date: "2026-05-26T02:00:00.000Z",
        }),
        section: "posts" as const,
      },
      {
        article: article({
          slug: "private-match",
          publish_tier: "private",
          target_hub: "ransomware",
          date: "2026-05-26T05:00:00.000Z",
        }),
        section: "posts" as const,
      },
      {
        article: article({
          slug: "unrelated",
          title: "Browser Patch Notes",
          excerpt: "A browser update fixes several issues.",
          category: "industry",
          tags: ["browser"],
          cve_ids: undefined,
        }),
        section: "posts" as const,
      },
    ];

    const selected = selectTopicHubArticles("ransomware", candidates);

    expect(selected.map((item) => item.article.frontmatter.slug)).toEqual([
      "explicit-target",
      "internal-link-target",
      "tag-match",
    ]);
  });

  it("requires enough public content before a hub is indexable", () => {
    const thin = Array.from(
      { length: PUBLIC_TOPIC_HUB_THRESHOLD - 1 },
      (_, i) => ({
        article: article({ slug: `ransomware-${i}` }),
        section: "posts" as const,
      }),
    );
    const enough = [
      ...thin,
      {
        article: article({ slug: "ransomware-final" }),
        section: "posts" as const,
      },
    ];

    expect(isPublicTopicHub("ransomware", thin)).toBe(false);
    expect(isPublicTopicHub("ransomware", enough)).toBe(true);
  });

  it("builds deduped article-to-hub links from target and internal-link fields", () => {
    const links = getArticleTopicHubLinks(
      article({
        target_hub: "ai-security",
        internal_link_targets: ["ai-security", "ransomware", "unknown-hub"],
      }).frontmatter,
    );

    expect(links.map((hub) => hub.slug)).toEqual(["ai-security", "ransomware"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildFeedIndexArticle,
  selectFeedArticles,
  type FeedIndexArticle,
} from "../feed-index";
import type { Article } from "../types";

function article(slug: string, date: string, title = slug): Article {
  return {
    frontmatter: {
      title,
      slug,
      date,
      excerpt: `${title} excerpt`,
      category: "industry",
      tags: [],
      language: "en",
      source_urls: [],
      author: "ZCyberNews",
      draft: false,
    },
    content: "",
    readingTime: 1,
  };
}

describe("feed index", () => {
  it("maps articles to the compact RSS manifest shape", () => {
    expect(
      buildFeedIndexArticle(article("alpha", "2026-05-05"), "en", "posts"),
    ).toMatchObject({
      locale: "en",
      section: "posts",
      title: "alpha",
      slug: "alpha",
      excerpt: "alpha excerpt",
      date: "2026-05-05",
      category: "industry",
      author: "ZCyberNews",
      tags: [],
      severity: null,
      threat_actor: null,
    });
  });

  it("selects latest articles for one locale", () => {
    const articles: FeedIndexArticle[] = [
      buildFeedIndexArticle(article("old-en", "2026-05-01"), "en", "posts"),
      buildFeedIndexArticle(article("new-zh", "2026-05-06"), "zh", "posts"),
      buildFeedIndexArticle(article("new-en", "2026-05-05"), "en", "posts"),
    ];

    expect(
      selectFeedArticles(articles, "en", 1).map((item) => item.slug),
    ).toEqual(["new-en"]);
  });
});

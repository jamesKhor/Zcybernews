import { describe, expect, it } from "vitest";
import { mapWordPressPostsToStories } from "../ingest-rss";
import type { FeedSource } from "../../sources/feeds";

const SOURCE: FeedSource = {
  id: "volexity",
  name: "Volexity Threat Research",
  url: "https://www.volexity.com/wp-json/wp/v2/posts?per_page=25",
  category: "cybersecurity",
  type: "wordpress-json",
  enabled: true,
  sourceLanguage: "en",
  seoIntent: "rank-both",
};

describe("mapWordPressPostsToStories", () => {
  it("maps WordPress REST posts to Story records", () => {
    const stories = mapWordPressPostsToStories(
      [
        {
          id: 4668,
          link: "https://www.volexity.com/blog/example/",
          date_gmt: "2026-05-04T10:00:00",
          title: { rendered: "Threat &amp; Research <em>Update</em>" },
          excerpt: {
            rendered: "<p>Useful threat research excerpt with HTML.</p>",
          },
        },
      ],
      SOURCE,
      "2026-05-05T00:00:00.000Z",
    );

    expect(stories).toHaveLength(1);
    expect(stories[0]).toMatchObject({
      id: "volexity-4668",
      title: "Threat & Research Update",
      url: "https://www.volexity.com/blog/example/",
      excerpt: "Useful threat research excerpt with HTML.",
      sourceId: "volexity",
      sourceType: "wordpress-json",
      sourceCategory: "cybersecurity",
      seoIntent: "rank-both",
    });
    expect(stories[0].publishedAt).toBe("2026-05-04T10:00:00.000Z");
  });

  it("skips posts without a title or link", () => {
    const stories = mapWordPressPostsToStories(
      [
        { id: 1, title: { rendered: "No link" } },
        { id: 2, link: "https://example.test/no-title" },
      ],
      SOURCE,
      "2026-05-05T00:00:00.000Z",
    );

    expect(stories).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { analyzeSourceStories } from "../audit-feed-sources";
import type { FeedSource } from "../sources/feeds";
import type { Story } from "../utils/dedup";

const SOURCE: FeedSource = {
  id: "test-source",
  name: "Test Source",
  url: "https://example.com/feed.xml",
  category: "cybersecurity",
  type: "rss",
  enabled: true,
};

function story(partial: Partial<Story> = {}): Story {
  return {
    id: "1",
    title: "Useful security update",
    url: "https://example.com/story",
    excerpt:
      "Researchers disclosed a vulnerability affecting enterprise appliances, including exploitation details, affected versions, mitigation guidance, and defender telemetry.",
    sourceName: SOURCE.name,
    publishedAt: new Date().toISOString(),
    tags: [],
    ...partial,
  };
}

describe("analyzeSourceStories", () => {
  it("fails feeds with no items", () => {
    const result = analyzeSourceStories(SOURCE, [], 10);

    expect(result.status).toBe("fail");
    expect(result.issues).toContain("no_items");
  });

  it("fails feeds where most items have empty or boilerplate excerpts", () => {
    const result = analyzeSourceStories(
      SOURCE,
      [
        story({ id: "1", excerpt: "" }),
        story({
          id: "2",
          excerpt:
            "(c) SANS Internet Storm Center. Creative Commons Attribution-Noncommercial 3.0 United States License.",
        }),
        story({ id: "3" }),
      ],
      10,
    );

    expect(result.status).toBe("fail");
    expect(result.issues).toContain("empty_or_boilerplate_excerpt_majority");
  });

  it("warns when most items are short but real prose", () => {
    const result = analyzeSourceStories(
      SOURCE,
      [
        story({ id: "1", excerpt: "A short but real security update." }),
        story({ id: "2", excerpt: "Another short but real security update." }),
        story(),
      ],
      10,
    );

    expect(result.status).toBe("warn");
    expect(result.issues).toContain("below_threshold_excerpt_majority");
  });

  it("warns on stale but otherwise usable feeds", () => {
    const result = analyzeSourceStories(
      SOURCE,
      [story({ publishedAt: "2025-01-01T00:00:00.000Z" })],
      10,
    );

    expect(result.status).toBe("warn");
    expect(
      result.issues.some((issue) => issue.startsWith("stale_newest_")),
    ).toBe(true);
  });
});

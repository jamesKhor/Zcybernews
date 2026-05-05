import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enrichStoriesForGeneration,
  enrichStorySource,
} from "../source-enrichment";
import { limit } from "../../utils/rate-limit";
import type { RoutedStory } from "../routing";
import type { Story } from "../../utils/dedup";

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: "s",
    title: "Security Story With Enough Detail",
    url: "https://example.com/story",
    excerpt: "RSS summary.",
    sourceName: "Example",
    publishedAt: "2026-05-05T00:00:00.000Z",
    tags: ["security"],
    sourceType: "rss",
    ...overrides,
  };
}

const articleText =
  "This is a long extracted article body about CVE-2026-1234 ".repeat(12);

describe("source enrichment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("attaches fetched article text for RSS sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          `<html><head><title>Fetched</title></head><body><article>${articleText}</article></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      }),
    );

    const enriched = await enrichStorySource(story());

    expect(enriched.rawText).toContain("CVE-2026-1234");
  });

  it("skips structured sources that already carry their source text", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const enriched = await enrichStorySource(
      story({ sourceType: "cisa-kev", url: "https://example.com/catalog" }),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(enriched.rawText).toBeUndefined();
  });

  it("falls back to the RSS excerpt when article fetching throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const enriched = await enrichStorySource(story());

    expect(enriched.rawText).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("network down"));
  });

  it("preserves routing metadata while enriching batches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(`<article>${articleText}</article>`, {
          headers: { "content-type": "text/html" },
        });
      }),
    );

    const routed: RoutedStory = {
      ...story(),
      translationDecision: {
        action: "translate-and-publish-both",
        direction: "en-to-zh",
      },
    };
    const [enriched] = await enrichStoriesForGeneration([routed]);

    expect(enriched.rawText).toContain("CVE-2026-1234");
    expect(enriched.translationDecision).toEqual(routed.translationDecision);
  });

  it("does not deadlock when called from the article-generation limiter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(`<article>${articleText}</article>`, {
          headers: { "content-type": "text/html" },
        });
      }),
    );

    const work = Promise.all(
      [1, 2, 3].map((i) =>
        limit(() =>
          enrichStoriesForGeneration([
            story({ id: `s-${i}`, title: `Security Story ${i}` }),
          ]),
        ),
      ),
    );

    const result = await Promise.race([
      work,
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 100),
      ),
    ]);

    expect(result).not.toBe("timeout");
  });
});

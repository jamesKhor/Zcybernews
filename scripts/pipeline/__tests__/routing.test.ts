import { afterEach, describe, expect, it } from "vitest";
import { routeStoriesForGeneration } from "../routing";
import type { Story } from "../../utils/dedup";

function story(overrides: Partial<Story>): Story {
  return {
    id: overrides.id ?? "s1",
    title: overrides.title ?? "Security Story With Enough Specific Detail",
    url: overrides.url ?? "https://example.com/story",
    excerpt:
      overrides.excerpt ??
      "Researchers disclosed a concrete cybersecurity issue with enough details to pass routing tests.",
    sourceName: overrides.sourceName ?? "Example Source",
    publishedAt: overrides.publishedAt ?? "2026-05-05T00:00:00.000Z",
    tags: overrides.tags ?? ["security"],
    ...overrides,
  };
}

describe("routeStoriesForGeneration", () => {
  afterEach(() => {
    delete process.env.SEO_RECOVERY_EN_ONLY;
  });

  it("skips explicit ingest-only stories before generation", () => {
    const result = routeStoriesForGeneration([
      story({
        sourceId: "freebuf",
        sourceLanguage: "zh",
        seoIntent: "ingest-only",
      }),
    ]);

    expect(result.publishable).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe("ingest-only");
  });

  it("keeps rank-both EN stories and marks them for EN-to-ZH translation", () => {
    const result = routeStoriesForGeneration([
      story({
        sourceId: "trusted-en",
        sourceLanguage: "en",
        seoIntent: "rank-both",
      }),
    ]);

    expect(result.skipped).toHaveLength(0);
    expect(result.publishable[0].translationDecision).toEqual({
      action: "translate-and-publish-both",
      direction: "en-to-zh",
    });
  });

  it("defaults legacy sources to rank-en and does not translate them", () => {
    const result = routeStoriesForGeneration([story({ sourceId: "legacy" })]);

    expect(result.skipped).toHaveLength(0);
    expect(result.publishable[0].translationDecision).toEqual({
      action: "publish-en-only",
    });
  });

  it("soft-blocks unsupported ZH to EN routing before token spend", () => {
    const result = routeStoriesForGeneration([
      story({
        sourceId: "zh-rank-both",
        sourceLanguage: "zh",
        seoIntent: "rank-both",
      }),
    ]);

    expect(result.publishable).toHaveLength(0);
    expect(result.skipped[0].decision.action).toBe("soft-block");
  });

  it("skips translation during English-only SEO recovery mode", () => {
    process.env.SEO_RECOVERY_EN_ONLY = "true";

    const result = routeStoriesForGeneration([
      story({
        sourceId: "trusted-en",
        sourceLanguage: "en",
        seoIntent: "rank-both",
      }),
      story({
        sourceId: "zh-source",
        sourceLanguage: "zh",
        seoIntent: "rank-both",
      }),
    ]);

    expect(result.publishable[0].translationDecision).toEqual({
      action: "publish-en-only",
    });
    expect(result.skipped[0].reason).toBe(
      "translation skipped: seo recovery en only",
    );
  });
});

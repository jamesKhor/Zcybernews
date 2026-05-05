import { describe, expect, it } from "vitest";
import { clusterStories, storyClusterKey } from "../story-clustering";
import type { Story } from "../../utils/dedup";

function story(overrides: Partial<Story>): Story {
  return {
    id: overrides.id ?? "s1",
    title: overrides.title ?? "Microsoft Patches CVE-2026-12345 in Windows",
    url: overrides.url ?? "https://example.com/story",
    excerpt:
      overrides.excerpt ??
      "Microsoft patched CVE-2026-12345 after exploitation attempts against Windows servers.",
    sourceName: overrides.sourceName ?? "Example Source",
    publishedAt: overrides.publishedAt ?? "2026-05-05T00:00:00.000Z",
    tags: overrides.tags ?? ["microsoft", "windows"],
    ...overrides,
  };
}

describe("story clustering", () => {
  it("uses CVE IDs as the strongest cluster key", () => {
    expect(storyClusterKey(story({}))).toBe("cve:CVE-2026-12345");
  });

  it("groups related stories inside the 72 hour window", () => {
    const clusters = clusterStories([
      story({
        id: "a",
        title: "Microsoft Patches CVE-2026-12345 in Windows",
        sourceName: "Vendor Advisory",
      }),
      story({
        id: "b",
        title: "CISA Warns CVE-2026-12345 Is Exploited in Windows",
        sourceName: "CISA",
        publishedAt: "2026-05-04T12:00:00.000Z",
      }),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].stories).toHaveLength(2);
    expect(clusters[0].sources).toEqual(["CISA", "Vendor Advisory"]);
  });

  it("does not group old follow-up stories beyond the window", () => {
    const clusters = clusterStories([
      story({ id: "a", publishedAt: "2026-05-05T00:00:00.000Z" }),
      story({
        id: "b",
        sourceName: "Older Source",
        publishedAt: "2026-04-28T00:00:00.000Z",
      }),
    ]);

    expect(clusters).toHaveLength(2);
  });

  it("prioritizes multi-source clusters over single-source items", () => {
    const clusters = clusterStories([
      story({
        id: "single",
        title: "Security Vendor Releases New Product Feature",
        excerpt: "A security vendor released a product feature.",
        sourceName: "Single",
        publishedAt: "2026-05-05T03:00:00.000Z",
      }),
      story({ id: "a", sourceName: "Vendor Advisory" }),
      story({
        id: "b",
        title: "CISA Warns CVE-2026-12345 Is Exploited in Windows",
        sourceName: "CISA",
      }),
    ]);

    expect(clusters[0].sources.length).toBeGreaterThan(1);
  });
});

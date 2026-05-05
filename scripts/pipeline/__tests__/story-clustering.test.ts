import { describe, expect, it } from "vitest";
import {
  clusterEditorialPriorityScore,
  clusterStories,
  storyClusterKey,
} from "../story-clustering";
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

  it("prioritizes named actor breach/extortion stories over generic coverage", () => {
    const clusters = clusterStories([
      story({
        id: "generic-a",
        title: "Security Vendor Releases New Product Feature",
        excerpt: "A security vendor released a product feature.",
        sourceName: "Vendor A",
        publishedAt: "2026-05-05T04:00:00.000Z",
      }),
      story({
        id: "generic-b",
        title: "Security Vendor Adds Product Feature for SOC Teams",
        excerpt: "A security vendor added a product feature for analysts.",
        sourceName: "Vendor B",
        publishedAt: "2026-05-05T03:00:00.000Z",
      }),
      story({
        id: "shinyhunters",
        title: "ShinyHunters Breaches Vimeo, Leaks 119K User Records",
        excerpt:
          "ShinyHunters leaked 119,000 Vimeo user records after claiming a data theft incident.",
        sourceName: "Breach Source",
        publishedAt: "2026-05-05T02:00:00.000Z",
        tags: ["data-breach", "extortion", "shinyhunters"],
      }),
    ]);

    expect(clusters[0].stories[0].id).toBe("shinyhunters");
    expect(clusterEditorialPriorityScore(clusters[0])).toBeGreaterThan(
      clusterEditorialPriorityScore(clusters[1]),
    );
  });

  it("prioritizes high-search privilege escalation stories", () => {
    const clusters = clusterStories([
      story({
        id: "generic-rce",
        title: "Enterprise Product Receives Routine Security Update",
        excerpt:
          "A vendor patched a moderate issue affecting an enterprise product in the monthly security bulletin.",
        sourceName: "Vendor Advisory",
        publishedAt: "2026-05-05T04:00:00.000Z",
        tags: ["enterprise", "patch"],
      }),
      story({
        id: "linux-lpe",
        title: "One-Line Linux Privilege Escalation PoC Draws Admin Attention",
        excerpt:
          "Researchers published a one-line Linux local privilege escalation exploit affecting common server builds.",
        sourceName: "Research Source",
        publishedAt: "2026-05-05T02:00:00.000Z",
        tags: ["linux", "privilege-escalation", "poc"],
      }),
    ]);

    expect(clusters[0].stories[0].id).toBe("linux-lpe");
  });

  it("prioritizes memorable Microsoft named-incident stories", () => {
    const clusters = clusterStories([
      story({
        id: "routine-cve",
        title: "Enterprise Product Receives Security Update",
        excerpt:
          "A vendor released a security update for a vulnerability in an enterprise product.",
        sourceName: "Vendor Advisory",
        publishedAt: "2026-05-05T04:00:00.000Z",
      }),
      story({
        id: "nightmare-eclipse",
        title: "Microsoft Nightmare Eclipse Bug Sparks Defender Debate",
        excerpt:
          "Security teams and researchers are discussing a Microsoft Windows flaw nicknamed Nightmare Eclipse after public exploit analysis.",
        sourceName: "Research Source",
        publishedAt: "2026-05-05T02:00:00.000Z",
        tags: ["microsoft", "windows", "exploit"],
      }),
    ]);

    expect(clusters[0].stories[0].id).toBe("nightmare-eclipse");
  });
});

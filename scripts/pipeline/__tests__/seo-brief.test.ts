import { describe, expect, it } from "vitest";
import { buildSeoBrief } from "../seo-brief";
import { buildArticlePrompt } from "../../ai/prompts/article";
import type { Story } from "../../utils/dedup";

const story: Story = {
  id: "s1",
  title: "Microsoft Exchange CVE-2026-12345 Actively Exploited",
  url: "https://example.com/story",
  excerpt: "CISA added CVE-2026-12345 to KEV after active exploitation.",
  sourceName: "CISA",
  publishedAt: "2026-05-17T00:00:00.000Z",
  tags: ["Microsoft", "Exchange"],
};

describe("SEO brief", () => {
  it("uses CVE as the primary query target before generic terms", () => {
    const brief = buildSeoBrief([story], {
      clusterKey: "cve:CVE-2026-12345",
      lane: "vulnerabilities",
    });

    expect(brief.primaryQueryTarget).toBe("CVE-2026-12345");
    expect(brief.searchIntent).toBe("patch-guidance");
    expect(brief.sitemapEligible).toBe(true);
  });

  it("injects SEO brief into the article prompt", () => {
    const prompt = buildArticlePrompt([story], [], {
      seoBrief: buildSeoBrief([story], {
        clusterKey: "cve:CVE-2026-12345",
        lane: "vulnerabilities",
      }),
    });

    expect(prompt).toContain("SEO BRIEF");
    expect(prompt).toContain("Primary query target: CVE-2026-12345");
  });
});

import { describe, expect, it } from "vitest";
import {
  evaluatePublicGate,
  getPublishTier,
  isPublicFrontmatter,
} from "../publication";
import type { ArticleFrontmatter } from "../types";

function frontmatter(
  overrides: Partial<ArticleFrontmatter> = {},
): ArticleFrontmatter {
  return {
    title: "CVE-2026-12345 Exploited in Enterprise VPN Appliances",
    slug: "cve-2026-12345-exploited-enterprise-vpn-appliances",
    date: "2026-05-05",
    excerpt:
      "CVE-2026-12345 is being exploited against enterprise VPN appliances after public proof-of-concept code appeared.",
    category: "vulnerabilities",
    tags: ["cve", "vpn", "exploitation"],
    language: "en",
    source_urls: ["https://www.cisa.gov/news-events/alerts/2026/05/05/example"],
    author: "ZCyberNews",
    draft: false,
    cve_ids: ["CVE-2026-12345"],
    ...overrides,
  };
}

describe("publication gate", () => {
  it("treats missing publish_tier as brief after corpus migration", () => {
    expect(getPublishTier(frontmatter())).toBe("brief");
    expect(isPublicFrontmatter(frontmatter())).toBe(false);
  });

  it("marks sourced vulnerability coverage as public", () => {
    const decision = evaluatePublicGate(frontmatter());

    expect(decision).toEqual({ pass: true, tier: "public", reasons: [] });
  });

  it("keeps thin single-source articles in brief tier", () => {
    const decision = evaluatePublicGate(
      frontmatter({
        title: "brief vendor note",
        excerpt: "A vendor shared a brief update with customers.",
        category: "industry",
        source_urls: ["https://example.com/story"],
        cve_ids: undefined,
      }),
    );

    expect(decision.pass).toBe(false);
    expect(decision.tier).toBe("brief");
    expect(decision.reasons).toContain("source_depth");
  });

  it("requires CVE IDs for vulnerability articles", () => {
    const decision = evaluatePublicGate(
      frontmatter({
        source_urls: ["https://example.com/a", "https://example.org/b"],
        cve_ids: [],
      }),
    );

    expect(decision.pass).toBe(false);
    expect(decision.reasons).toContain("vulnerability_missing_cve");
  });
});

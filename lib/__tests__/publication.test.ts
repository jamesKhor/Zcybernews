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

  it("allows concrete single-source reporting when structured evidence is present", () => {
    const decision = evaluatePublicGate(
      frontmatter({
        source_urls: ["https://example.com/story"],
        affected_sectors: ["education"],
        affected_regions: ["North America"],
      }),
    );

    expect(decision).toEqual({ pass: true, tier: "public", reasons: [] });
  });

  it("keeps articles in brief tier when scorer body signals are unsafe", () => {
    const decision = evaluatePublicGate(frontmatter(), {
      wordCount: 250,
      wordCountFloor: 800,
      hasReferences: false,
      hedgingHits: ["CVE ID not yet assigned"],
    });

    expect(decision.pass).toBe(false);
    expect(decision.tier).toBe("brief");
    expect(decision.reasons).toEqual(
      expect.arrayContaining([
        "body_too_thin",
        "missing_references",
        "hedging_phrase",
      ]),
    );
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

  it("does not demote sourced articles for SERP length warnings", () => {
    const decision = evaluatePublicGate(
      frontmatter({
        title:
          "CVE-2026-12345 Exploited in Enterprise VPN Appliances After Emergency Vendor Advisory",
        excerpt:
          "CVE-2026-12345 is being exploited against enterprise VPN appliances after public proof-of-concept code appeared, forcing administrators to apply the vendor emergency update immediately.",
      }),
    );

    expect(decision).toEqual({ pass: true, tier: "public", reasons: [] });
  });

  it("allows single-source articles with concrete structured evidence", () => {
    const decision = evaluatePublicGate(
      frontmatter({
        source_urls: ["https://example.com/story"],
        cvss_score: 9.8,
      }),
    );

    expect(decision.reasons).not.toContain("source_depth");
    expect(decision.tier).toBe("public");
  });

  it("keeps scorer-backed thin articles out of the public tier", () => {
    const decision = evaluatePublicGate(frontmatter(), {
      wordCount: 250,
      wordCountFloor: 800,
      hasReferences: true,
      hedgingHits: [],
    });

    expect(decision.pass).toBe(false);
    expect(decision.tier).toBe("brief");
    expect(decision.reasons).toContain("body_too_thin");
  });
});

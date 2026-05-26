import { describe, expect, it } from "vitest";
import { GeneratedArticleSchema } from "../article-schema";

function validArticle(overrides: Record<string, unknown> = {}) {
  return {
    title: "OceanLotus PyPI Malware Hits Developer Systems",
    slug: "oceanlotus-pypi-malware-hits-developer-systems",
    excerpt:
      "OceanLotus used PyPI packages to deliver ZiChatBot malware, giving security teams package names, campaign context, and Python detection leads.",
    category: "malware",
    tags: ["oceanlotus", "pypi", "zichatbot"],
    severity: "high",
    cvss_score: null,
    cve_ids: [],
    threat_actor: "OceanLotus",
    threat_actor_origin: null,
    affected_sectors: ["technology"],
    affected_regions: ["Asia"],
    iocs: [],
    ttp_matrix: [],
    seo_query_target: "OceanLotus ZiChatBot PyPI malware",
    seo_intent: "technical-analysis",
    seo_title_promise:
      "Lead with OceanLotus ZiChatBot and the developer supply-chain risk.",
    seo_meta_promise:
      "Start with OceanLotus ZiChatBot, name PyPI, and include concrete defender value.",
    target_hub: "malware-loaders",
    internal_link_targets: ["malware-loaders", "apt-state-actors"],
    featured_image_alt:
      "Security analyst reviewing Python package telemetry linked to malware delivery",
    news_sitemap_eligible: true,
    body:
      "## Executive Summary\n" +
      "OceanLotus-linked operators used the Python Package Index to distribute ZiChatBot malware. ".repeat(
        12,
      ) +
      "\n\n## Technical Analysis\n" +
      "The reporting describes package-based delivery, developer exposure, and malware staging through a software supply chain channel. ".repeat(
        12,
      ) +
      "\n\n## Mitigations & Recommendations\n" +
      "Security teams should audit package installation logs, review developer workstations, and monitor package repository usage. ".repeat(
        8,
      ) +
      "\n\n## References\n- https://example.com/oceanlotus-zichatbot",
    ...overrides,
  };
}

describe("GeneratedArticleSchema SEO metadata", () => {
  it("requires first-class SEO metadata from article generation", () => {
    const parsed = GeneratedArticleSchema.parse(validArticle());

    expect(parsed.seo_query_target).toBe("OceanLotus ZiChatBot PyPI malware");
    expect(parsed.seo_intent).toBe("technical-analysis");
    expect(parsed.seo_title_promise).toContain("developer supply-chain");
    expect(parsed.seo_meta_promise).toContain("defender value");
    expect(parsed.target_hub).toBe("malware-loaders");
    expect(parsed.internal_link_targets).toEqual([
      "malware-loaders",
      "apt-state-actors",
    ]);
    expect(parsed.featured_image_alt).toContain("Python package telemetry");
    expect(parsed.news_sitemap_eligible).toBe(true);
  });

  it("rejects generated articles missing SEO metadata", () => {
    const { seo_query_target: _removed, ...withoutQuery } = validArticle();

    const result = GeneratedArticleSchema.safeParse(withoutQuery);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.seo_query_target).toBeDefined();
    }
  });
});

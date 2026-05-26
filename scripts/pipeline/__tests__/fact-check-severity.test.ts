import { describe, expect, it } from "vitest";
import { factCheckArticle } from "../fact-check";
import type { GeneratedArticle } from "../../ai/schemas/article-schema";
import type { Story } from "../../utils/dedup";

function article(overrides: Partial<GeneratedArticle> = {}): GeneratedArticle {
  return {
    title: "CVE-2024-57728 SimpleHelp Path Traversal Exploited",
    slug: "cve-2024-57728-simplehelp-path-traversal-exploited",
    excerpt:
      "CVE-2024-57728 affects SimpleHelp remote support software and appears in CISA KEV after confirmed exploitation.",
    category: "vulnerabilities",
    tags: ["cve-2024-57728", "simplehelp", "cisa-kev"],
    severity: "high",
    cvss_score: 7.2,
    cve_ids: ["CVE-2024-57728"],
    threat_actor: null,
    threat_actor_origin: null,
    affected_sectors: [],
    affected_regions: [],
    iocs: [],
    ttp_matrix: [],
    seo_query_target: "CVE-2024-57728 SimpleHelp",
    seo_intent: "patch-guidance",
    seo_title_promise:
      "Lead with CVE-2024-57728 and the SimpleHelp exploitation risk.",
    seo_meta_promise:
      "Start with CVE-2024-57728, name SimpleHelp, and explain the supported severity.",
    target_hub: "active-cves",
    internal_link_targets: ["active-cves", "cisa-kev"],
    featured_image_alt:
      "Security analyst reviewing SimpleHelp vulnerability telemetry",
    news_sitemap_eligible: true,
    body: "CVE-2024-57728 affects SimpleHelp remote support software v5.5.7 and earlier. NVD lists CVSS 7.2.",
    ...overrides,
  };
}

function source(excerpt: string): Story {
  return {
    id: "nvd-cve-2024-57728",
    title: "CVE-2024-57728 SimpleHelp Path Traversal Vulnerability",
    url: "https://nvd.nist.gov/vuln/detail/CVE-2024-57728",
    excerpt,
    sourceName: "NVD",
    publishedAt: "2026-04-24T00:00:00.000Z",
    tags: ["CVE-2024-57728"],
  };
}

describe("factCheckArticle severity grounding", () => {
  it("rejects unsupported critical severity and invented CVSS ranges", async () => {
    const result = await factCheckArticle(
      article({
        severity: "critical",
        cvss_score: null,
        body: "CVE-2024-57728 affects SimpleHelp remote support software. The issue suggests a Critical severity rating of CVSS 9.0-10.0.",
      }),
      [
        source(
          "SimpleHelp remote support software v5.5.7 and before allows admin users to upload arbitrary files. CVSS 7.2.",
        ),
      ],
      { checkUrls: false },
    );

    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.type)).toContain(
      "severity_not_in_source",
    );
    expect(result.issues.map((issue) => issue.type)).toContain(
      "cvss_not_in_source",
    );
  });

  it("accepts high severity when the source supports CVSS below critical", async () => {
    const result = await factCheckArticle(
      article(),
      [
        source(
          "SimpleHelp remote support software v5.5.7 and before allows admin users to upload arbitrary files. CVSS 7.2.",
        ),
      ],
      { checkUrls: false },
    );

    expect(result.issues.map((issue) => issue.type)).not.toContain(
      "severity_not_in_source",
    );
    expect(result.issues.map((issue) => issue.type)).not.toContain(
      "cvss_not_in_source",
    );
  });
});

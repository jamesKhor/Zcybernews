import { describe, expect, it } from "vitest";
import { postProcessArticle } from "../post-process";
import type { GeneratedArticle } from "../../ai/schemas/article-schema";
import type { Story } from "../../utils/dedup";

function article(overrides: Partial<GeneratedArticle> = {}): GeneratedArticle {
  return {
    title: "Example Malware Uses Verified Command And Control",
    slug: "example-malware-uses-verified-command-and-control",
    excerpt:
      "Example malware used evil-update.xyz for command and control, according to source reporting on the campaign.",
    category: "malware",
    tags: ["malware", "c2", "example"],
    severity: "high",
    cvss_score: null,
    cve_ids: [],
    threat_actor: null,
    threat_actor_origin: null,
    affected_sectors: [],
    affected_regions: [],
    iocs: [],
    ttp_matrix: [],
    seo_query_target: "Example malware command and control",
    seo_intent: "technical-analysis",
    seo_title_promise: "Lead with the verified command-and-control evidence.",
    seo_meta_promise:
      "Start with the malware C2 domain and explain the defender signal.",
    target_hub: "malware-loaders",
    internal_link_targets: ["malware-loaders", "ioc-analysis"],
    featured_image_alt:
      "Security analyst reviewing malware command-and-control telemetry",
    news_sitemap_eligible: true,
    body: `## Executive Summary

Example malware contacted evil-update.xyz and https://evil-update.xyz/login.php during the intrusion.
The actor also claimed to use invented-only.example and C:\\Windows\\System32\\evil.dll.

## Technical Analysis

The source material supports the C2 domain but not the invented-only.example domain or local file path.

## Mitigations & Recommendations

Monitor DNS requests to evil-update.xyz.

## References

- https://example.com/report`,
    ...overrides,
  };
}

const source: Story = {
  id: "s",
  title: "Example Malware Campaign",
  url: "https://example.com/report",
  excerpt: "Researchers linked the campaign to evil-update.xyz.",
  rawText:
    "Researchers linked the campaign to evil-update.xyz and https://evil-update.xyz/login.php after observing command-and-control traffic.",
  sourceName: "Example",
  publishedAt: "2026-05-05T00:00:00.000Z",
  tags: ["malware"],
};

describe("postProcessArticle — IOC verification", () => {
  it("keeps rediscovered domain/URL IOCs and strips LLM-only non-regex IOCs", () => {
    const draft = article({
      iocs: [
        {
          type: "file_path",
          value: "C:\\Windows\\System32\\evil.dll",
          confidence: "high",
        },
        {
          type: "domain",
          value: "invented-only.example",
          confidence: "high",
        },
      ],
    });

    const processed = postProcessArticle(draft, [source]);
    const values = processed.iocs.map((ioc) => `${ioc.type}:${ioc.value}`);

    expect(values).toContain("domain:evil-update.xyz");
    expect(values).toContain("url:https://evil-update.xyz/login.php");
    expect(values).not.toContain("domain:invented-only.example");
    expect(values).not.toContain("file_path:C:\\Windows\\System32\\evil.dll");
  });
});

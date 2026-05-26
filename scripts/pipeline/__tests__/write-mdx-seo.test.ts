import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import matter from "gray-matter";
import os from "node:os";
import path from "node:path";
import type { GeneratedArticle } from "../../ai/schemas/article-schema";
import type { SeoBrief } from "../seo-brief";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  vi.resetModules();
});

function article(): GeneratedArticle {
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
  };
}

const seoBrief: SeoBrief = {
  primaryQueryTarget: "fallback query target",
  searchIntent: "breaking-news",
  titlePromise: "Fallback title promise.",
  metaPromise: "Fallback meta promise.",
  articleType: "malware",
  requiredEntities: ["fallback query target"],
  internalLinkTargets: ["fallback-hub"],
  targetHub: "fallback-hub",
  sitemapEligible: false,
};

describe("writeArticlePair SEO metadata", () => {
  it("persists generated SEO fields into MDX frontmatter", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "write-mdx-seo-"));
    process.chdir(tmpRoot);

    try {
      const { writeArticlePair } = await import("../write-mdx");
      const paths = writeArticlePair(
        article(),
        null,
        ["https://example.com/oceanlotus-zichatbot"],
        { seoBrief },
      );
      const parsed = matter(fs.readFileSync(paths.en, "utf8"));

      expect(parsed.data.seo_query_target).toBe(
        "OceanLotus ZiChatBot PyPI malware",
      );
      expect(parsed.data.seo_intent).toBe("technical-analysis");
      expect(parsed.data.seo_title_promise).toContain("developer supply-chain");
      expect(parsed.data.seo_meta_promise).toContain("defender value");
      expect(parsed.data.target_hub).toBe("malware-loaders");
      expect(parsed.data.internal_link_targets).toEqual([
        "malware-loaders",
        "apt-state-actors",
      ]);
      expect(parsed.data.featured_image_alt).toContain(
        "Python package telemetry",
      );
      expect(parsed.data.news_sitemap_eligible).toBe(true);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

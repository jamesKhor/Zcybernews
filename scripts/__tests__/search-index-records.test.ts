import { describe, expect, it } from "vitest";
import {
  buildSearchIndexRecord,
  SEARCH_TAG_SEPARATOR,
} from "../search-index-records";
import type { ArticleFrontmatter } from "../../lib/types";

const frontmatter: ArticleFrontmatter = {
  title: "Security Team Blocks Credential Theft Campaign",
  slug: "credential-theft-campaign",
  date: "2026-05-05",
  excerpt:
    "Security teams blocked credential theft targeting enterprise accounts.",
  category: "threat-intel",
  tags: ["phishing", "credential-theft"],
  language: "en",
  source_urls: ["https://example.com"],
  author: "ZCyberNews",
  draft: false,
};

describe("buildSearchIndexRecord", () => {
  it("maps article frontmatter into the Pagefind search contract", () => {
    const record = buildSearchIndexRecord({
      frontmatter,
      content:
        "## Executive Summary\n\nAttackers used **phishing** and [token replay](https://example.com).",
      locale: "en",
      section: "threat-intel",
    });

    expect(record.url).toBe("/en/threat-intel/credential-theft-campaign");
    expect(record.language).toBe("en");
    expect(record.meta).toMatchObject({
      title: frontmatter.title,
      excerpt: frontmatter.excerpt,
      slug: frontmatter.slug,
      category: "threat-intel",
      date: "2026-05-05",
      type: "threat-intel",
      tags: ["phishing", "credential-theft"].join(SEARCH_TAG_SEPARATOR),
    });
    expect(record.filters).toMatchObject({
      locale: ["en"],
      type: ["threat-intel"],
      category: ["threat-intel"],
      tags: ["phishing", "credential-theft"],
    });
    expect(record.content).toContain("token replay");
  });
});

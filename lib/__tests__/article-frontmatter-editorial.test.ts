import { describe, expect, it } from "vitest";
import { ArticleFrontmatterSchema } from "../types";

describe("ArticleFrontmatterSchema editorial review metadata", () => {
  it("preserves approved review fields from pipeline frontmatter", () => {
    const parsed = ArticleFrontmatterSchema.parse({
      title: "Approved AI security story",
      slug: "2026-05-26-approved-ai-security-story",
      date: "2026-05-26",
      excerpt: "A short approved story excerpt.",
      category: "ai",
      tags: ["ai-security"],
      language: "en",
      source_urls: ["https://example.com/story"],
      draft: false,
      editorial_candidate_id: "001-ai-story",
      editorial_review_status: "approved",
      editorial_reviewer: "alex",
      editorial_reviewed_at: "2026-05-26T09:00:00.000Z",
      editorial_decision_reason: "Hot topic with reader value.",
      editorial_taste_rating: 0.92,
      editorial_taste_reason: "Good non-CVE portfolio fit.",
      editorial_positive_signals: ["hot-topic", "reader-likely-cares"],
      editorial_negative_signals: [],
      editorial_reason_tags: ["ai-security"],
      editorial_calibration_round: "day-3",
    });

    expect(parsed.editorial_candidate_id).toBe("001-ai-story");
    expect(parsed.editorial_taste_rating).toBe(0.92);
    expect(parsed.editorial_positive_signals).toEqual([
      "hot-topic",
      "reader-likely-cares",
    ]);
  });

  it("preserves SEO metadata fields from generated articles", () => {
    const parsed = ArticleFrontmatterSchema.parse({
      title: "Approved AI security story",
      slug: "2026-05-26-approved-ai-security-story",
      date: "2026-05-26",
      excerpt: "A short approved story excerpt.",
      category: "ai",
      tags: ["ai-security"],
      language: "en",
      source_urls: ["https://example.com/story"],
      draft: false,
      seo_query_target: "AI identity attacks",
      seo_intent: "breaking-news",
      seo_title_promise:
        "Lead with AI identity attacks and concrete defender impact.",
      seo_meta_promise:
        "Start with AI identity attacks and name the operational risk.",
      target_hub: "ai-security",
      internal_link_targets: ["ai-security", "identity-security"],
      featured_image_alt:
        "Security analyst reviewing AI identity attack telemetry",
      news_sitemap_eligible: true,
    });

    expect(parsed.seo_query_target).toBe("AI identity attacks");
    expect(parsed.seo_title_promise).toContain("defender impact");
    expect(parsed.internal_link_targets).toEqual([
      "ai-security",
      "identity-security",
    ]);
    expect(parsed.featured_image_alt).toContain("attack telemetry");
    expect(parsed.news_sitemap_eligible).toBe(true);
  });
});

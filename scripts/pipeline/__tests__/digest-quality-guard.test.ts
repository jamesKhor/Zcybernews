/**
 * Digest quality-guard tests — B-017 (2026-04-23).
 *
 * Pins the SERIOUS-flag drop behavior at the digest boundary. With
 * paying (well, subscribed) readers, the digest is the single most
 * retention-sensitive surface we own. Regressions here cause real
 * unsubscribes, so the contract is locked down by tests.
 *
 * We import `scoreArticle` directly (same function the digest calls
 * internally via `isSeriousQualityArticle`) and assert that each
 * flag class that should trigger a drop, does.
 */
import { describe, it, expect } from "vitest";
import { scoreArticle } from "../quality-scorer";
import type { ArticleFrontmatter } from "../../../lib/types";

function fm(overrides: Partial<ArticleFrontmatter> = {}): ArticleFrontmatter {
  return {
    title: "Test Article",
    slug: "test-article",
    date: "2026-04-23",
    excerpt: "A test excerpt.",
    category: "industry",
    tags: ["security", "test", "news"],
    language: "en",
    source_urls: ["https://example.com/x"],
    author: "AI-generated",
    draft: false,
    ...overrides,
  } as ArticleFrontmatter;
}

const hasSerious = (flags: Array<{ severity: string }>) =>
  flags.some((f) => f.severity === "serious");

describe("digest quality-guard — article classes that MUST be dropped", () => {
  it("drops articles with CVE_HEDGING phrases", () => {
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "posts",
      frontmatter: fm(),
      body:
        "## Executive Summary\n\n" +
        "A threat actor was observed. CVE ID not yet assigned at this time. " +
        Array(800).fill("word").join(" "),
    });
    expect(hasSerious(s.flags)).toBe(true);
    expect(s.flags.some((f) => f.code === "hedging_phrase")).toBe(true);
  });

  it("drops vulnerabilities articles with no CVE IDs", () => {
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "posts",
      frontmatter: fm({ category: "vulnerabilities", cve_ids: [] }),
      body: "## Executive Summary\n\n" + Array(800).fill("word").join(" "),
    });
    expect(hasSerious(s.flags)).toBe(true);
    expect(s.flags.some((f) => f.code === "vuln_no_cve_ids")).toBe(true);
  });

  it("drops articles with word count <60% of category floor", () => {
    // threat-intel floor = 700; <420 triggers SERIOUS
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "posts",
      frontmatter: fm({ category: "threat-intel" }),
      body: "## Executive Summary\n\n" + Array(200).fill("word").join(" "),
    });
    expect(hasSerious(s.flags)).toBe(true);
    expect(s.flags.some((f) => f.code === "word_count_way_below_floor")).toBe(
      true,
    );
  });
});

describe("digest quality-guard — articles that must NOT be dropped", () => {
  it("does NOT drop clean well-structured articles", () => {
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "threat-intel",
      frontmatter: fm({
        category: "threat-intel",
        tags: ["ransomware", "healthcare", "breach", "us"],
        cve_ids: ["CVE-2026-1234"],
        cvss_score: 9.8,
        threat_actor: "The Gentlemen",
        iocs: [{ type: "ip", value: "1.2.3.4", confidence: "high" }],
        ttp_matrix: [
          {
            tactic: "Initial Access",
            technique_id: "T1190",
            technique_name: "Exploit Public-Facing Application",
          },
        ],
      }),
      body:
        "## Executive Summary\n\n" +
        Array(1200).fill("word").join(" ") +
        "\n\n## References\n- https://bleepingcomputer.com/x",
    });
    expect(hasSerious(s.flags)).toBe(false);
  });

  it("does NOT drop merely WARN-level articles (below floor but not <60%)", () => {
    // threat-intel floor = 700; 500 is WARN not SERIOUS
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "posts",
      frontmatter: fm({ category: "threat-intel" }),
      body:
        "## Executive Summary\n\n" +
        Array(500).fill("word").join(" ") +
        "\n\n## References\n- https://example.com",
    });
    expect(hasSerious(s.flags)).toBe(false);
  });
});

describe("digest quality-guard — CJK SERIOUS handling (post B-014)", () => {
  it("does NOT falsely flag a normal-length ZH article as SERIOUS", () => {
    // 2026-04-22 false-positive crisis regression guard. A ZH article
    // with 2000+ CJK chars should NOT be flagged word_count_way_below_floor.
    const cjkParagraph =
      "勒索软件组织的攻击活动系统性地瓦解了全球受害企业的安全防护体系。".repeat(
        40,
      );
    const s = scoreArticle({
      slug: "x",
      locale: "zh",
      section: "posts",
      frontmatter: fm({ category: "threat-intel", language: "zh" }),
      body:
        "## 执行摘要\n\n" +
        cjkParagraph +
        "\n\n## 参考资料\n- https://example.com",
    });
    expect(s.flags.some((f) => f.code === "word_count_way_below_floor")).toBe(
      false,
    );
  });
});

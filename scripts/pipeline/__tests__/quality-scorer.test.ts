/**
 * Quality scorer tests — pins the flag conditions that matter most.
 *
 * Hedging-phrase detection is the single most-important SERIOUS flag
 * (the 6-article trust killer we fixed in April). Tests cover the
 * stateless regex usage via findHedgingHits, plus the full scoreArticle
 * path that composes the flag into the output.
 */
import { describe, it, expect } from "vitest";
import {
  countWords,
  hasReferencesSection,
  findHedgingHits,
  scoreArticle,
  summarize,
} from "../quality-scorer";
import type { ArticleFrontmatter } from "../../../lib/types";

// ─── Fixtures ─────────────────────────────────────────────────────────

function fm(partial: Partial<ArticleFrontmatter> = {}): ArticleFrontmatter {
  return {
    title: "Test Article",
    slug: "test-article",
    date: "2026-04-22",
    excerpt: "A test excerpt.",
    category: "industry",
    tags: ["security", "test", "news"],
    language: "en",
    source_urls: ["https://example.com/x"],
    author: "AI-generated",
    draft: false,
    ...partial,
  } as ArticleFrontmatter;
}

function longBody(words: number, extras = ""): string {
  const filler = Array(words).fill("word").join(" ");
  return `## Executive Summary\n\n${filler}\n\n${extras}`;
}

// ─── Pure helpers ─────────────────────────────────────────────────────

describe("countWords", () => {
  it("counts plain prose", () => {
    expect(countWords("one two three four five")).toBe(5);
  });

  it("drops fenced code blocks", () => {
    expect(countWords("pre\n```\ncode here more\n```\npost")).toBe(2);
  });

  it("drops markdown tables", () => {
    expect(countWords("pre\n| a | b |\n| 1 | 2 |\npost")).toBe(2);
  });

  it("keeps link text but drops URLs", () => {
    expect(countWords("See [the report](https://example.com/long/url)")).toBe(
      3,
    );
  });

  it("returns 0 for empty body", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n  \n")).toBe(0);
  });
});

describe("hasReferencesSection", () => {
  it("matches ## References", () => {
    expect(hasReferencesSection("## References\n- foo")).toBe(true);
  });
  it("matches case-insensitively", () => {
    expect(hasReferencesSection("## references\n")).toBe(true);
  });
  it("does NOT match inline mention", () => {
    expect(hasReferencesSection("In the References at the bottom,")).toBe(
      false,
    );
  });
});

describe("findHedgingHits", () => {
  it("catches hedging phrases in body", () => {
    const hits = findHedgingHits(
      "ok title",
      "ok excerpt",
      "Details: CVE ID not yet assigned at the time of disclosure.",
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("returns empty for clean prose", () => {
    expect(
      findHedgingHits("Breach at Acme", "x", "CVE-2026-1234 fixes this."),
    ).toEqual([]);
  });

  it("searches title + excerpt + body", () => {
    // Hedging phrase in title only
    expect(
      findHedgingHits("CVE ID not yet assigned", "x", "clean body").length,
    ).toBeGreaterThan(0);
  });
});

// ─── scoreArticle — SERIOUS flag paths ────────────────────────────────

describe("scoreArticle — SERIOUS flags", () => {
  it("flags hedging phrase in body (most important case)", () => {
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "posts",
      frontmatter: fm(),
      body: longBody(800, "No CVE ID has been assigned to this issue yet."),
    });
    expect(s.flags.some((f) => f.code === "hedging_phrase")).toBe(true);
    expect(s.flags.find((f) => f.code === "hedging_phrase")?.severity).toBe(
      "serious",
    );
    expect(s.hedgingHits.length).toBeGreaterThan(0);
    // Headline score is heavily penalised by hedging (-3).
    expect(s.headlineScore).toBeLessThan(7);
  });

  it("flags vuln article with zero cve_ids as SERIOUS", () => {
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "posts",
      frontmatter: fm({ category: "vulnerabilities", cve_ids: [] }),
      body: longBody(800),
    });
    expect(s.flags.some((f) => f.code === "vuln_no_cve_ids")).toBe(true);
    expect(s.flags.some((f) => f.code === "vuln_no_structured_fields")).toBe(
      true,
    );
  });

  it("flags word count <60% of floor as SERIOUS", () => {
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "posts",
      frontmatter: fm({ category: "threat-intel" }), // floor 700
      body: longBody(300),
    });
    expect(s.flags.some((f) => f.code === "word_count_way_below_floor")).toBe(
      true,
    );
  });
});

// ─── scoreArticle — WARN paths ────────────────────────────────────────

describe("scoreArticle — WARN flags", () => {
  it("flags word count below floor but not catastrophically", () => {
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "posts",
      frontmatter: fm({ category: "threat-intel" }), // floor 700
      body: longBody(500), // 71% of floor → WARN not SERIOUS
    });
    expect(s.flags.some((f) => f.code === "word_count_below_floor")).toBe(true);
    expect(s.flags.some((f) => f.code === "word_count_way_below_floor")).toBe(
      false,
    );
  });

  it("flags missing References section", () => {
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "posts",
      frontmatter: fm(),
      body: "## Executive Summary\n\nSome content here without references.",
    });
    expect(s.flags.some((f) => f.code === "missing_references")).toBe(true);
  });

  it("flags tag count too low", () => {
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "posts",
      frontmatter: fm({ tags: ["one"] }),
      body: longBody(800, "## References\n- https://example.com"),
    });
    expect(s.flags.some((f) => f.code === "tags_too_few")).toBe(true);
  });

  it("flags tag count too many (keyword stuffing)", () => {
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "posts",
      frontmatter: fm({ tags: ["a", "b", "c", "d", "e", "f", "g", "h"] }),
      body: longBody(800, "## References\n- https://example.com"),
    });
    expect(s.flags.some((f) => f.code === "tags_too_many")).toBe(true);
  });
});

// ─── scoreArticle — OK path ───────────────────────────────────────────

describe("scoreArticle — clean article", () => {
  it("emits zero flags + headline score near 10 for well-structured article", () => {
    const s = scoreArticle({
      slug: "x",
      locale: "en",
      section: "threat-intel",
      frontmatter: fm({
        category: "threat-intel",
        tags: ["ransomware", "healthcare", "lockbit", "breach"],
        cve_ids: ["CVE-2026-1234"],
        cvss_score: 9.8,
        threat_actor: "LockBit",
        iocs: [
          {
            type: "ip",
            value: "1.2.3.4",
            confidence: "high",
          },
        ],
        ttp_matrix: [
          {
            tactic: "Initial Access",
            technique_id: "T1190",
            technique_name: "Exploit Public-Facing Application",
          },
        ],
      }),
      body: longBody(
        1200,
        "## References\n- https://bleepingcomputer.com/x\n- https://krebs.com/y",
      ),
    });
    expect(s.flags).toHaveLength(0);
    expect(s.headlineScore).toBeGreaterThanOrEqual(9);
    expect(s.structuredRichness).toBe(5);
  });
});

// ─── summarize ────────────────────────────────────────────────────────

describe("summarize", () => {
  it("returns zeros for empty input", () => {
    const sum = summarize([]);
    expect(sum.total).toBe(0);
    expect(sum.seriousCount).toBe(0);
    expect(sum.topFlagCodes).toEqual([]);
  });

  it("aggregates counts + averages across mixed articles", () => {
    const clean = scoreArticle({
      slug: "a",
      locale: "en",
      section: "posts",
      frontmatter: fm({
        category: "industry",
        tags: ["t1", "t2", "t3"],
      }),
      body: longBody(800, "## References\n- https://example.com"),
    });
    const serious = scoreArticle({
      slug: "b",
      locale: "en",
      section: "posts",
      frontmatter: fm(),
      body: "No CVE has been assigned yet." + longBody(800),
    });
    const sum = summarize([clean, serious]);
    expect(sum.total).toBe(2);
    expect(sum.seriousCount).toBe(1);
    expect(
      sum.topFlagCodes.find((f) => f.code === "hedging_phrase")?.count,
    ).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Digest hero-selection tests (2026-04-23).
 *
 * Pins the quality-weighted hero selection rule. The pre-refactor
 * selector picked by frontmatter.severity alone, so an article marked
 * `severity: critical` with 0/5 structured fields + below-floor word
 * count would become the hero — the FIRST thing our 2 real subscribers
 * see. These tests guarantee the new rule:
 *
 *   HERO must have headlineScore ≥ 7.0 OR structuredRichness ≥ 3.
 *   If no candidate meets the bar, fall back to the highest-scoring
 *   article rather than emit no hero.
 */
import { describe, it, expect } from "vitest";
import { selectArticles } from "../digest-template";
import type { Article } from "../../content";
import type { ArticleFrontmatter } from "../../types";

function makeArticle(
  partial: Partial<ArticleFrontmatter>,
  contentWords = 800,
  contentExtras = "## References\n- https://example.com",
): Article {
  const fm: ArticleFrontmatter = {
    title: "Test Article",
    slug: "test",
    date: "2026-04-23",
    excerpt: "A test excerpt.",
    category: "industry",
    tags: ["t1", "t2", "t3"],
    language: "en",
    source_urls: ["https://example.com"],
    author: "AI-generated",
    draft: false,
    ...partial,
  } as ArticleFrontmatter;
  return {
    frontmatter: fm,
    content: `## Executive Summary\n\n${Array(contentWords).fill("word").join(" ")}\n\n${contentExtras}`,
    readingTime: Math.ceil(contentWords / 200),
  };
}

describe("selectArticles — hero MUST NOT be the thin-but-critical article", () => {
  it("rejects severity=critical hero with 0/5 structured fields + below floor", () => {
    const thinCritical = makeArticle(
      {
        title: "Thin Critical Article",
        category: "threat-intel",
        severity: "critical",
        cve_ids: [],
        cvss_score: undefined,
        threat_actor: undefined,
        iocs: [],
        ttp_matrix: [],
      },
      300,
    ); // below 700 floor — scores as WARN

    const cleanMedium = makeArticle(
      {
        title: "Clean Medium Article",
        category: "vulnerabilities",
        severity: "medium",
        cve_ids: ["CVE-2026-1234"],
        cvss_score: 6.5,
        threat_actor: "LockBit",
        iocs: [
          { type: "ip", value: "1.2.3.4", confidence: "high" },
        ] as ArticleFrontmatter["iocs"],
      },
      800,
    );

    const { hero } = selectArticles([thinCritical, cleanMedium], "en");
    // Hero must be the clean article despite lower severity
    expect(hero?.frontmatter.title).toBe("Clean Medium Article");
  });
});

describe("selectArticles — hero SHOULD be critical when critical is clean", () => {
  it("picks critical + well-structured over medium + well-structured", () => {
    const cleanCritical = makeArticle(
      {
        title: "Clean Critical",
        category: "threat-intel",
        severity: "critical",
        cve_ids: ["CVE-2026-1111"],
        cvss_score: 9.8,
        threat_actor: "The Gentlemen",
        iocs: [
          { type: "ip", value: "1.2.3.4", confidence: "high" },
        ] as ArticleFrontmatter["iocs"],
        ttp_matrix: [
          {
            tactic: "Initial Access",
            technique_id: "T1190",
            technique_name: "Exploit Public-Facing Application",
          },
        ] as ArticleFrontmatter["ttp_matrix"],
      },
      1500,
    );

    const cleanMedium = makeArticle(
      {
        title: "Clean Medium",
        category: "vulnerabilities",
        severity: "medium",
        cve_ids: ["CVE-2026-2222"],
        cvss_score: 6.5,
      },
      800,
    );

    const { hero } = selectArticles([cleanMedium, cleanCritical], "en");
    expect(hero?.frontmatter.title).toBe("Clean Critical");
  });
});

describe("selectArticles — fallback when no candidate meets bar", () => {
  it("picks a non-null hero even when no article meets quality bar", () => {
    // All three below the quality bar — pick any; fallback must NOT emit null.
    // (The ranking between three similarly-thin articles can tie, so we
    // only assert non-null + that SOME article was returned.)
    const a1 = makeArticle({ title: "Thin A", category: "industry" }, 250);
    const a2 = makeArticle({ title: "Thin B", category: "industry" }, 300);
    const a3 = makeArticle({ title: "Thin C", category: "industry" }, 350);
    const { hero } = selectArticles([a1, a2, a3], "en");
    expect(hero).not.toBeNull();
    expect([a1, a2, a3]).toContain(hero);
  });
});

describe("selectArticles — secondary slot populated correctly", () => {
  it("secondary excludes the hero + caps at MAX_ARTICLES-1", () => {
    const articles = Array.from({ length: 10 }, (_, i) =>
      makeArticle(
        {
          title: `Article ${i}`,
          slug: `a-${i}`,
          cve_ids: ["CVE-2026-0000"],
          severity: i === 0 ? "critical" : "medium",
        },
        800,
      ),
    );
    const { hero, secondary, remainingCount } = selectArticles(articles, "en");
    expect(hero).not.toBeNull();
    expect(secondary).not.toContain(hero);
    // MAX_ARTICLES = 7 → secondary = 6
    expect(secondary.length).toBeLessThanOrEqual(6);
    expect(remainingCount).toBe(Math.max(0, 10 - 7));
  });
});

describe("selectArticles — empty input", () => {
  it("returns nulls", () => {
    const { hero, secondary, remainingCount } = selectArticles([], "en");
    expect(hero).toBeNull();
    expect(secondary).toEqual([]);
    expect(remainingCount).toBe(0);
  });
});

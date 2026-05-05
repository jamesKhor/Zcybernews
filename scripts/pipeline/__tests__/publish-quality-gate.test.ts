import { describe, expect, it } from "vitest";
import { evaluatePublishQuality } from "../publish-quality-gate";
import type { GeneratedArticle } from "../../ai/schemas/article-schema";

function body(words: number, extras = "## References\n- https://example.com") {
  return `${Array(words).fill("word").join(" ")}\n\n${extras}`;
}

function article(partial: Partial<GeneratedArticle> = {}): GeneratedArticle {
  return {
    title: "Security Team Blocks Credential Theft Campaign",
    slug: "security-team-blocks-credential-theft-campaign",
    excerpt:
      "Security teams blocked a credential theft campaign targeting enterprise accounts with phishing infrastructure and token replay.",
    category: "industry",
    tags: ["phishing", "credential-theft", "enterprise-security"],
    severity: "medium",
    cvss_score: null,
    cve_ids: [],
    threat_actor: null,
    threat_actor_origin: null,
    affected_sectors: ["technology"],
    affected_regions: ["global"],
    iocs: [
      {
        type: "domain",
        value: "example-attacker.test",
        confidence: "medium",
      },
    ],
    ttp_matrix: [],
    body: body(500),
    ...partial,
  };
}

describe("evaluatePublishQuality", () => {
  it("allows a sourced article without blocking flags", () => {
    const decision = evaluatePublishQuality(article(), ["https://example.com"]);

    expect(decision.allowed).toBe(true);
    expect(decision.blockingFlags).toEqual([]);
  });

  it("blocks serious thin articles before publish", () => {
    const decision = evaluatePublishQuality(
      article({
        category: "threat-intel",
        body: body(250),
      }),
      ["https://example.com"],
    );

    expect(decision.allowed).toBe(false);
    expect(decision.blockingFlags.map((f) => f.code)).toContain(
      "word_count_way_below_floor",
    );
  });

  it("blocks articles with no references section", () => {
    const decision = evaluatePublishQuality(
      article({
        body: body(500, "## Key Takeaways\n- Defenders should review logs."),
      }),
      ["https://example.com"],
    );

    expect(decision.allowed).toBe(false);
    expect(decision.blockingFlags.map((f) => f.code)).toContain(
      "missing_references",
    );
  });

  it("blocks threat-intel articles with thin structured fields", () => {
    const decision = evaluatePublishQuality(
      article({
        category: "threat-intel",
        affected_sectors: [],
        affected_regions: [],
        iocs: [],
        body: body(800),
      }),
      ["https://example.com"],
    );

    expect(decision.allowed).toBe(false);
    expect(decision.blockingFlags.map((f) => f.code)).toContain(
      "structured_fields_thin",
    );
  });

  it("allows non-sensitive categories to publish with structured_fields_thin warning", () => {
    const decision = evaluatePublishQuality(
      article({
        category: "industry",
        affected_sectors: [],
        affected_regions: [],
        iocs: [],
        body: body(500),
      }),
      ["https://example.com"],
    );

    expect(decision.score.flags.map((f) => f.code)).toContain(
      "structured_fields_thin",
    );
    expect(decision.allowed).toBe(true);
  });
});

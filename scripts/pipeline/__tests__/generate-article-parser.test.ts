import { beforeEach, describe, expect, it, vi } from "vitest";

const generateArticleTextMock = vi.hoisted(() => vi.fn());

vi.mock("../../ai/provider", () => ({
  articleModel: null,
  translationModel: null,
  generateArticleText: generateArticleTextMock,
  translateText: vi.fn(),
}));

import { generateArticle, isGenerationFailure } from "../generate-article";
import { buildArticlePrompt } from "../../ai/prompts/article";
import type { GeneratedArticle } from "../../ai/schemas/article-schema";
import type { Story } from "../../utils/dedup";

function makeStory(): Story {
  return {
    id: "story-1",
    title: "OceanLotus uses PyPI to deliver ZiChatBot malware",
    url: "https://example.com/oceanlotus-zichatbot",
    excerpt:
      "Researchers reported a Python package campaign linked to OceanLotus activity and malware delivery.",
    sourceName: "Example Security",
    publishedAt: "2026-05-07",
    tags: ["malware"],
  };
}

function articleJson(partial: Partial<GeneratedArticle> = {}) {
  return JSON.stringify({
    title:
      "OceanLotus PyPI Malware Campaign Delivers ZiChatBot Payloads to Developers",
    slug: "oceanlotus-pypi-malware-campaign-delivers-zichatbot-payloads",
    excerpt:
      "OceanLotus-linked operators used PyPI packages to distribute ZiChatBot malware against developer systems, giving security teams package names, campaign context, and detection leads for Python environments.",
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
    ...partial,
  });
}

describe("generateArticle parser recovery", () => {
  beforeEach(() => {
    generateArticleTextMock.mockReset();
  });

  it("normalizes recoverable metadata and structured-field shape before schema validation", async () => {
    generateArticleTextMock.mockResolvedValue({
      text: articleJson({
        iocs: [
          {
            type: "sha256",
            value:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
          { type: "mutex", value: "unsupported-shape" },
        ] as unknown as GeneratedArticle["iocs"],
        ttp_matrix: [
          {
            tactic: "Execution",
            technique_id: "T1059",
            technique_name: "Command and Scripting Interpreter",
          },
          {
            technique_id: "T1105",
            technique_name: "Ingress Tool Transfer",
          },
        ] as unknown as GeneratedArticle["ttp_matrix"],
      }),
      modelUsed: "deepseek/deepseek-chat",
      paid: true,
      elapsedMs: 1,
    });

    const result = await generateArticle([makeStory()], []);

    expect(isGenerationFailure(result)).toBe(false);
    expect(result).not.toBe("reject");
    const article = result as GeneratedArticle;
    expect(article.title.length).toBeLessThanOrEqual(70);
    expect(article.excerpt.length).toBeLessThanOrEqual(180);
    expect(article.iocs).toEqual([
      {
        type: "hash_sha256",
        value:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      },
    ]);
    expect(article.ttp_matrix).toEqual([
      {
        tactic: "Execution",
        technique_id: "T1059",
        technique_name: "Command and Scripting Interpreter",
      },
    ]);
  });

  it("returns a typed schema failure instead of a generic null", async () => {
    generateArticleTextMock.mockResolvedValue({
      text: JSON.stringify({ title: "Too short" }),
      modelUsed: "deepseek/deepseek-chat",
      paid: true,
      elapsedMs: 1,
    });

    const result = await generateArticle([makeStory()], []);

    expect(isGenerationFailure(result)).toBe(true);
    if (isGenerationFailure(result)) {
      expect(result.reason).toBe("schema_validation_failed");
      expect(result.fieldErrors?.title).toBeDefined();
    }
  });
});

describe("article prompt JSON contract", () => {
  it("does not include JavaScript comments inside the JSON sample", () => {
    const prompt = buildArticlePrompt([makeStory()]);

    expect(prompt).not.toContain('"tags": ["tag1", "tag2", "tag3"],  //');
    expect(prompt).toContain("Do not include comments inside the JSON object.");
    expect(prompt).toContain("Do not copy the rule text below");
  });
});

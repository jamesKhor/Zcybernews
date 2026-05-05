import { describe, expect, it } from "vitest";
import {
  chunkTelegramMessage,
  renderTelegramSummary,
} from "../telegram-summary";
import type { buildSummaryData } from "../telegram-summary";

type SummaryData = ReturnType<typeof buildSummaryData>;

const baseSummary: SummaryData = {
  cadence: "daily",
  windowHours: 24,
  articles: [],
  recentEn: [],
  topCategories: [{ value: "threat-intel", count: 2 }],
  topTags: [{ value: "phishing", count: 3 }],
  topSectors: [{ value: "finance", count: 1 }],
  topRegions: [{ value: "global", count: 1 }],
  notable: [
    {
      locale: "en",
      section: "threat-intel",
      title: "Critical Phishing Campaign Targets Banks",
      slug: "critical-phishing-campaign-targets-banks",
      date: "2026-05-05",
      category: "threat-intel",
      tags: ["phishing"],
      excerpt: "Campaign targets banks.",
      severity: "critical",
      cveIds: [],
      affectedSectors: ["finance"],
      affectedRegions: ["global"],
      threatActor: "APT-Example",
    },
  ],
  quality: {
    seriousCount: 2,
    warnCount: 5,
    avgHeadlineScore: 7.1,
    avgWordCount: 620,
    topFlags: [{ value: "missing_references", count: 2 }],
  },
  feedProblems: ["vendor-feed: 3 consecutive failures"],
  analytics: {
    total: 100,
    published7d: 12,
    published30d: 40,
    parityRatio: "0.990",
    missingZh: 1,
  },
  budget: {
    projectedCost: 15.5,
    costPerArticle: 0.05,
    projectedArticles: 300,
  },
  actions: ["Check 1 unhealthy feed source(s)."],
};

describe("renderTelegramSummary", () => {
  it("renders concrete coverage, quality, ops, and action sections", () => {
    const message = renderTelegramSummary(baseSummary);

    expect(message).toContain("ZCyberNews Daily Intelligence Brief");
    expect(message).toContain("Critical Phishing Campaign Targets Banks");
    expect(message).toContain("Quality:");
    expect(message).toContain("vendor-feed");
    expect(message).toContain("Suggested Actions");
  });

  it("escapes HTML in article titles", () => {
    const message = renderTelegramSummary({
      ...baseSummary,
      notable: [{ ...baseSummary.notable[0], title: "A < B & C" }],
    });

    expect(message).toContain("A &lt; B &amp; C");
  });
});

describe("chunkTelegramMessage", () => {
  it("keeps all chunks under the Telegram limit", () => {
    const message = Array.from(
      { length: 80 },
      (_, index) => `Line ${index}: ${"x".repeat(80)}`,
    ).join("\n");

    const chunks = chunkTelegramMessage(message, 500);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 500)).toBe(true);
    expect(chunks.join("\n")).toBe(message);
  });
});

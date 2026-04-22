/**
 * classifySourceRichness regression tests — B-009b.
 *
 * The classifier decides article word-target + maxOutputTokens based on
 * info-density counted in source material (CVE IDs, CVSS scores, IOC
 * hashes, APT-N actor markers). Shipped in `18fadec` WITHOUT tests.
 *
 * Why coverage matters: tuning any threshold silently changes which
 * tier hundreds of generated articles land in. An article that should
 * be 400-700 words (advisory) could get pushed to 2000-3000 (extended)
 * and the LLM will pad with hedging phrases to hit the higher bound —
 * which is the exact failure mode this classifier was built to prevent.
 *
 * Tier boundaries (as of 2026-04-22):
 *   infoTokens === 0                       → advisory  (400-700 words,  1800 maxTok)
 *   infoTokens 1-2                         → medium    (800-1200 words, 2500 maxTok)
 *   infoTokens 3-5 OR <2 sources (long)    → long      (1500-2200 words,3500 maxTok)
 *   infoTokens 6+ AND ≥2 sources           → extended  (2000-3000 words,4500 maxTok)
 */
import { describe, it, expect, vi } from "vitest";

// Stub the AI provider module — generate-article transitively imports
// `scripts/ai/provider.ts`, which has top-level `const articleModel = ...`
// exports that THROW at module load if no provider env vars are set.
// Tests don't need the provider (classifier is pure), but the import
// chain still evaluates the provider module's top level. vi.mock runs
// before any import, so the thrower never fires.
//
// If this module grows other exports the tests need, extend the stub.
vi.mock("../../ai/provider", () => ({
  articleModel: null,
  translationModel: null,
  generateArticleText: vi.fn(),
  translateText: vi.fn(),
}));

import { classifySourceRichness } from "../generate-article";
import type { Story } from "../../utils/dedup";

/** Build a Story with just the fields the classifier reads. */
function makeStory(title: string, excerpt: string): Story {
  return {
    id: "test-id",
    title,
    url: "https://example.com/story",
    excerpt,
    sourceName: "test-source",
    publishedAt: "2026-04-22",
    tags: [],
  };
}

describe("classifySourceRichness — tier boundaries", () => {
  it("0 info tokens → advisory (400-700 words)", () => {
    const story = makeStory(
      "Generic advisory about patch updates",
      "The vendor has released an update. Customers should apply it.",
    );
    const r = classifySourceRichness([story]);
    expect(r.label).toBe("advisory");
    expect(r.targetRange).toBe("400-700 words");
    expect(r.maxOutputTokens).toBe(1800);
    expect(r.infoTokens).toBe(0);
  });

  it("1 CVE ID → medium (800-1200 words)", () => {
    const story = makeStory(
      "Critical vulnerability in FooProduct",
      "CVE-2026-1234 affects all versions prior to 3.2.1.",
    );
    const r = classifySourceRichness([story]);
    expect(r.label).toBe("medium");
    expect(r.targetRange).toBe("800-1200 words");
    expect(r.infoTokens).toBeGreaterThanOrEqual(1);
    expect(r.infoTokens).toBeLessThanOrEqual(2);
  });

  it("3 CVEs + single source → long (1500-2200 words, single-source clause)", () => {
    const story = makeStory(
      "Patch Tuesday roundup",
      "Fixes for CVE-2026-1111, CVE-2026-2222, and CVE-2026-3333 were issued.",
    );
    const r = classifySourceRichness([story]);
    expect(r.label).toBe("long");
    expect(r.targetRange).toBe("1500-2200 words");
    expect(r.maxOutputTokens).toBe(3500);
    expect(r.infoTokens).toBeGreaterThanOrEqual(3);
  });

  it("6+ info tokens AND ≥2 sources → extended (2000-3000 words)", () => {
    // 6 CVEs spread across 2 sources.
    const a = makeStory(
      "Multiple flaws patched",
      "CVE-2026-1001, CVE-2026-1002, and CVE-2026-1003 were addressed.",
    );
    const b = makeStory(
      "Follow-up disclosure",
      "CVE-2026-1004, CVE-2026-1005, and CVE-2026-1006 also fixed.",
    );
    const r = classifySourceRichness([a, b]);
    expect(r.label).toBe("extended");
    expect(r.targetRange).toBe("2000-3000 words");
    expect(r.maxOutputTokens).toBe(4500);
    expect(r.infoTokens).toBeGreaterThanOrEqual(6);
  });

  it("6+ info tokens but ONLY 1 source → long (multiSource gate blocks extended)", () => {
    // Same 6 CVEs packed into one story. Tier should stay long, not
    // extended — the single-source clause is the guard against one
    // overly-detailed feed item dominating the pipeline.
    const story = makeStory(
      "Huge patch roundup",
      "CVE-2026-2001, CVE-2026-2002, CVE-2026-2003, CVE-2026-2004, CVE-2026-2005, CVE-2026-2006.",
    );
    const r = classifySourceRichness([story]);
    expect(r.label).toBe("long");
  });
});

describe("classifySourceRichness — info-token signal sources", () => {
  // After B-010 (2026-04-22) the CVSS regex splits keyword + separator,
  // so all common vendor-advisory phrasings count. Before B-010 only
  // the first two forms below matched.
  const cvssPhrasings = [
    "CVSS 9.8 is critical.",
    "CVSS: 9.8 critical vulnerability.",
    "CVSS score 9.8 was assigned.",
    "CVSS score: 9.8 assigned by NVD.",
    "CVSS Base Score: 9.8 per the advisory.",
    "CVSS score of 9.8 reflects the impact.",
    "CVSSv3.1 base score of 9.8 was issued.",
    "CVSSv3.1: 9.8 critical.",
  ];

  for (const phrase of cvssPhrasings) {
    it(`CVSS phrasing counts as info token: "${phrase}"`, () => {
      const s = makeStory("Flaw disclosed", phrase);
      const r = classifySourceRichness([s]);
      expect(r.infoTokens).toBeGreaterThan(0);
    });
  }

  it("IOC hash (MD5/SHA) counts as an info token", () => {
    const s = makeStory(
      "Malware sample analyzed",
      "Sample hash: 44d88612fea8a8f36de82e1278abb02f",
    );
    const r = classifySourceRichness([s]);
    expect(r.infoTokens).toBeGreaterThan(0);
  });

  it("APT-N / FIN-N / TA-N actor marker counts as an info token", () => {
    const s = makeStory(
      "Espionage campaign",
      "The group tracked as APT28 and FIN7 conducted the intrusion.",
    );
    const r = classifySourceRichness([s]);
    // Expect 2 tokens from 2 APT markers; may be higher if other heuristics fire
    expect(r.infoTokens).toBeGreaterThanOrEqual(2);
  });

  it("Empty stories array → 0 info tokens → advisory", () => {
    const r = classifySourceRichness([]);
    expect(r.label).toBe("advisory");
    expect(r.infoTokens).toBe(0);
  });
});

describe("classifySourceRichness — return shape invariants", () => {
  it("every tier returns the 4 expected fields", () => {
    const r = classifySourceRichness([makeStory("x", "y")]);
    expect(r).toHaveProperty("label");
    expect(r).toHaveProperty("targetRange");
    expect(r).toHaveProperty("maxOutputTokens");
    expect(r).toHaveProperty("infoTokens");
    expect(typeof r.maxOutputTokens).toBe("number");
    expect(typeof r.infoTokens).toBe("number");
  });

  it("maxOutputTokens increases monotonically with tier", () => {
    // Pin the tier → maxTok mapping so a future tuning doesn't
    // accidentally make `medium` bigger than `long`.
    const advisory = classifySourceRichness([makeStory("a", "b")]);
    const medium = classifySourceRichness([makeStory("x", "CVE-2026-1234")]);
    const long = classifySourceRichness([
      makeStory("x", "CVE-2026-1001 CVE-2026-1002 CVE-2026-1003"),
    ]);
    const extended = classifySourceRichness([
      makeStory("x", "CVE-2026-1001 CVE-2026-1002 CVE-2026-1003 CVE-2026-1004"),
      makeStory("y", "CVE-2026-1005 CVE-2026-1006"),
    ]);
    expect(advisory.maxOutputTokens).toBeLessThan(medium.maxOutputTokens);
    expect(medium.maxOutputTokens).toBeLessThan(long.maxOutputTokens);
    expect(long.maxOutputTokens).toBeLessThan(extended.maxOutputTokens);
  });
});

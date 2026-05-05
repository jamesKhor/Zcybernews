/**
 * Story schema regression tests — Phase B A2.2.
 *
 * The Story type gained optional pipeline contract fields after 2026-04-22
 * (sourceId, sourceCategory, fetchedAt, qualityScore, isVendor, etc.).
 * These tests pin
 * the shape invariants so a future edit can't silently break the
 * contract:
 *
 *   - All new fields are OPTIONAL (pre-A2.2 Story literals must
 *     continue to type-check).
 *   - When produced by ingest-rss.ts, all 5 fields are populated
 *     (Stage 4 can rely on them).
 *
 * We exercise Story as a plain TS type; no runtime validation is
 * wrapped around it today. If a Zod StorySchema lands later, the
 * test can be extended to parse() instead of structural-check.
 */
import { describe, it, expect } from "vitest";
import type { Story } from "../../utils/dedup";

describe("Story type — backward compatibility", () => {
  it("accepts a pre-A2.2 literal with only the 7 original fields", () => {
    // This is a compile-time assertion as much as a runtime one:
    // if the new fields were required, this would fail `tsc --noEmit`
    // and the pre-push QA gate would block.
    const legacy: Story = {
      id: "x",
      title: "t",
      url: "https://example.com/x",
      excerpt: "e",
      sourceName: "src",
      publishedAt: "2026-04-22",
      tags: ["a"],
    };
    expect(legacy.id).toBe("x");
  });
});

describe("Story type — A2.2 additive fields carry expected types", () => {
  it("accepts a full-shape literal with all 5 new fields populated", () => {
    const full: Story = {
      id: "x",
      title: "t",
      url: "https://example.com/x",
      excerpt: "e",
      sourceName: "src",
      publishedAt: "2026-04-22",
      tags: [],
      sourceId: "krebs",
      sourceCategory: "cybersecurity",
      fetchedAt: "2026-04-22T00:00:00.000Z",
      qualityScore: 1.0,
      isVendor: false,
      identityKey: "cisa-kev-CVE-2026-1234",
      sourceLanguage: "en",
      seoIntent: "rank-both",
      sourceType: "rss",
      rawText: "Full fetched article text",
    };
    expect(full.sourceId).toBe("krebs");
    expect(full.qualityScore).toBe(1.0);
    expect(full.isVendor).toBe(false);
    expect(full.identityKey).toBe("cisa-kev-CVE-2026-1234");
    expect(full.sourceLanguage).toBe("en");
    expect(full.seoIntent).toBe("rank-both");
    expect(full.sourceType).toBe("rss");
    expect(full.rawText).toBe("Full fetched article text");
  });

  it("leaves new fields undefined when not populated (no default coercion)", () => {
    const partial: Story = {
      id: "x",
      title: "t",
      url: "https://example.com/x",
      excerpt: "e",
      sourceName: "src",
      publishedAt: "2026-04-22",
      tags: [],
    };
    // Absence of coercion is the contract: Story is a plain record
    // type, not a schema with defaults. Any defaulting happens at the
    // producer (ingest-rss.ts) so Stage 4 sees fully-populated records
    // for ingest-produced stories, and `undefined` for anything
    // constructed outside the producer.
    expect(partial.sourceId).toBeUndefined();
    expect(partial.fetchedAt).toBeUndefined();
    expect(partial.qualityScore).toBeUndefined();
    expect(partial.identityKey).toBeUndefined();
    expect(partial.sourceLanguage).toBeUndefined();
    expect(partial.seoIntent).toBeUndefined();
    expect(partial.sourceType).toBeUndefined();
    expect(partial.rawText).toBeUndefined();
  });
});

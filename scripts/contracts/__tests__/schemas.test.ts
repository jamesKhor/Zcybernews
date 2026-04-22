/**
 * SSoT schema tests — Phase B.2.
 *
 * Why these tests matter: the SSoT exists so every consumer reads the
 * same defaults. If `SeoIntentSchema.default("rank-en")` silently
 * regresses to `.default("rank-zh")`, hundreds of sources would flip
 * publishing targets without any other code change. These tests pin
 * the defaults so a drift fails CI immediately.
 */
import { describe, it, expect } from "vitest";
import {
  SourceLanguageSchema,
  SeoIntentSchema,
  SourceMetadataSchema,
  ArticleDraftSchema,
} from "../schemas";

describe("SourceLanguageSchema", () => {
  it("accepts en and zh", () => {
    expect(SourceLanguageSchema.parse("en")).toBe("en");
    expect(SourceLanguageSchema.parse("zh")).toBe("zh");
  });

  it("rejects other locales (Cycle-1 invariant)", () => {
    expect(() => SourceLanguageSchema.parse("ja")).toThrow();
    expect(() => SourceLanguageSchema.parse("")).toThrow();
  });
});

describe("SeoIntentSchema", () => {
  it("accepts all 4 matrix intents", () => {
    for (const v of ["rank-en", "rank-zh", "rank-both", "ingest-only"]) {
      expect(SeoIntentSchema.parse(v)).toBe(v);
    }
  });

  it("rejects typo'd intents", () => {
    expect(() => SeoIntentSchema.parse("rank-en-only")).toThrow();
    expect(() => SeoIntentSchema.parse("rankEn")).toThrow();
  });
});

describe("SourceMetadataSchema", () => {
  it("defaults seoIntent to rank-en when omitted (v2 invariant)", () => {
    // Protects the silent-default contract: an existing
    // data/rss-sources.json entry that was written before seoIntent
    // existed MUST parse as rank-en so its publishing target does
    // not flip after the SSoT lands.
    const parsed = SourceMetadataSchema.parse({ id: "krebs" });
    expect(parsed.seoIntent).toBe("rank-en");
  });

  it("preserves an explicit intent", () => {
    const parsed = SourceMetadataSchema.parse({
      id: "freebuf",
      seoIntent: "ingest-only",
    });
    expect(parsed.seoIntent).toBe("ingest-only");
  });

  it("rejects missing id", () => {
    expect(() => SourceMetadataSchema.parse({})).toThrow();
  });

  it("rejects empty id", () => {
    expect(() => SourceMetadataSchema.parse({ id: "" })).toThrow();
  });
});

describe("ArticleDraftSchema", () => {
  it("defaults sourceLanguage to en when omitted (v2 invariant)", () => {
    const parsed = ArticleDraftSchema.parse({});
    expect(parsed.sourceLanguage).toBe("en");
  });

  it("preserves an explicit language", () => {
    const parsed = ArticleDraftSchema.parse({ sourceLanguage: "zh" });
    expect(parsed.sourceLanguage).toBe("zh");
  });
});

describe("schema purity (no mutation, no side effects)", () => {
  it("parsing a frozen input does not throw and does not mutate", () => {
    const input = Object.freeze({ id: "krebs" });
    const parsed = SourceMetadataSchema.parse(input);
    // Parsed object is a NEW object — defaults layered without touching input.
    expect(parsed).not.toBe(input);
    expect("seoIntent" in input).toBe(false);
    expect(parsed.seoIntent).toBe("rank-en");
  });
});

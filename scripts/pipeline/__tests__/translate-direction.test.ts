import { describe, it, expect } from "vitest";
import {
  getTranslationDirection,
  SOFT_BLOCK_REASONS,
  type SourceMetadata,
  type ArticleDraft,
  type TranslationDecision,
} from "../translate-direction";

const src = (seoIntent: SourceMetadata["seoIntent"]): SourceMetadata => ({
  id: "test-source",
  seoIntent,
});
const art = (sourceLanguage: ArticleDraft["sourceLanguage"]): ArticleDraft => ({
  sourceLanguage,
});

describe("getTranslationDirection — §3.A routing matrix (8 cells)", () => {
  it("rank-en + EN → publish-en-only", () => {
    expect(getTranslationDirection(src("rank-en"), art("en"))).toEqual({
      action: "publish-en-only",
    } satisfies TranslationDecision);
  });

  it("rank-en + ZH → soft-block (stable reason)", () => {
    const d = getTranslationDirection(src("rank-en"), art("zh"));
    expect(d).toEqual({
      action: "soft-block",
      reason: SOFT_BLOCK_REASONS.RANK_EN_REQUIRES_EN_SOURCE,
    });
    expect(SOFT_BLOCK_REASONS.RANK_EN_REQUIRES_EN_SOURCE).toBe(
      "rank-en requires EN source",
    );
  });

  it("rank-zh + EN → translate-and-publish-zh-only (en-to-zh)", () => {
    expect(getTranslationDirection(src("rank-zh"), art("en"))).toEqual({
      action: "translate-and-publish-zh-only",
      direction: "en-to-zh",
    } satisfies TranslationDecision);
  });

  it("rank-zh + ZH → publish-zh-only (no translate)", () => {
    expect(getTranslationDirection(src("rank-zh"), art("zh"))).toEqual({
      action: "publish-zh-only",
      translate: false,
    } satisfies TranslationDecision);
  });

  it("rank-both + EN → translate-and-publish-both (en-to-zh)", () => {
    expect(getTranslationDirection(src("rank-both"), art("en"))).toEqual({
      action: "translate-and-publish-both",
      direction: "en-to-zh",
    } satisfies TranslationDecision);
  });

  it("rank-both + ZH → soft-block (Cycle 2 deferred, stable reason)", () => {
    const d = getTranslationDirection(src("rank-both"), art("zh"));
    expect(d).toEqual({
      action: "soft-block",
      reason: SOFT_BLOCK_REASONS.RANK_BOTH_ZH_NOT_SUPPORTED,
    });
    expect(SOFT_BLOCK_REASONS.RANK_BOTH_ZH_NOT_SUPPORTED).toBe(
      "ZH→EN translation not supported until Cycle 2 — set seoIntent=rank-zh or wait",
    );
  });

  it("ingest-only + EN → ingest-signal-only", () => {
    expect(getTranslationDirection(src("ingest-only"), art("en"))).toEqual({
      action: "ingest-signal-only",
    } satisfies TranslationDecision);
  });

  it("ingest-only + ZH → ingest-signal-only (FreeBuf driver case)", () => {
    expect(getTranslationDirection(src("ingest-only"), art("zh"))).toEqual({
      action: "ingest-signal-only",
    } satisfies TranslationDecision);
  });
});

describe("getTranslationDirection — edge cases", () => {
  it("defaults seoIntent=undefined to rank-en (v2 schema default)", () => {
    expect(
      getTranslationDirection({ id: "s" }, { sourceLanguage: "en" }),
    ).toEqual({ action: "publish-en-only" });
  });

  it("defaults sourceLanguage=undefined to en (v2 schema default)", () => {
    expect(getTranslationDirection(src("rank-en"), {})).toEqual({
      action: "publish-en-only",
    });
  });

  it("both defaults applied simultaneously → publish-en-only", () => {
    expect(getTranslationDirection({ id: "s" }, {})).toEqual({
      action: "publish-en-only",
    });
  });
});

describe("getTranslationDirection — purity", () => {
  it("is pure: no input mutation, deterministic across repeated calls", () => {
    const s: SourceMetadata = { id: "s", seoIntent: "rank-both" };
    const a: ArticleDraft = { sourceLanguage: "en" };
    const sClone = structuredClone(s);
    const aClone = structuredClone(a);
    const r1 = getTranslationDirection(s, a);
    const r2 = getTranslationDirection(s, a);
    expect(r1).toEqual(r2);
    expect(s).toEqual(sClone);
    expect(a).toEqual(aClone);
  });

  it("accepts minimum shape: source needs only {id, seoIntent}; article needs only {sourceLanguage}", () => {
    const d = getTranslationDirection(
      { id: "min", seoIntent: "rank-zh" },
      { sourceLanguage: "en" },
    );
    expect(d.action).toBe("translate-and-publish-zh-only");
  });
});

/**
 * Pins the legacy stub-stripper added 2026-04-23.
 *
 * The article-generation prompt was updated the same day to OMIT empty
 * conditional sections rather than stub them with "None identified...".
 * The vast majority of the existing corpus was generated under the OLD
 * prompt, so the render-time stripper gives those readers an immediate
 * visual lift without needing to backfill MDX files.
 *
 * The patterns below are taken verbatim from real published articles.
 */
import { describe, it, expect } from "vitest";
// Import from the pure helper module (no React / no @/ alias) so vitest
// can resolve without needing a path-alias config.
import { stripEmptyConditionalSections } from "../mdx-strip";

describe("stripEmptyConditionalSections — EN", () => {
  it("strips an empty IOC stub between two H2s", () => {
    const src = `## Technical Analysis

Some real analysis here.

## Indicators of Compromise

None identified in source material.

## Mitigations & Recommendations

Patch immediately.`;
    const out = stripEmptyConditionalSections(src);
    expect(out).not.toContain("Indicators of Compromise");
    expect(out).not.toContain("None identified");
    // Surrounding sections preserved
    expect(out).toContain("## Technical Analysis");
    expect(out).toContain("## Mitigations & Recommendations");
  });

  it("strips an empty TTP stub", () => {
    const src = `## Indicators of Compromise

real ioc data here

## Tactics, Techniques & Procedures

None identified at this time.

## Threat Actor Context

LockBit affiliate.`;
    const out = stripEmptyConditionalSections(src);
    expect(out).not.toContain("Tactics, Techniques");
    expect(out).toContain("## Indicators of Compromise");
    expect(out).toContain("## Threat Actor Context");
  });

  it("strips an empty Threat Actor Context stub", () => {
    const src = `## Indicators of Compromise

ioc here

## Threat Actor Context

None identified in source material.

## Mitigations & Recommendations

advice`;
    const out = stripEmptyConditionalSections(src);
    expect(out).not.toContain("Threat Actor Context");
    expect(out).toContain("## Mitigations");
  });

  it("does NOT strip a populated section even if 'None identified' appears later as prose", () => {
    const src = `## Indicators of Compromise

The campaign uses C2 server 1.2.3.4. Researchers note that none identified initially in the early reports were later confirmed by Mandiant.

## Mitigations`;
    const out = stripEmptyConditionalSections(src);
    expect(out).toContain("## Indicators of Compromise");
    expect(out).toContain("1.2.3.4");
  });
});

describe("stripEmptyConditionalSections — ZH (Kimi K2 translates the stub literally)", () => {
  it("strips ZH empty IOC stub", () => {
    const src = `## 技术分析

具体内容

## 入侵指标

未发现相关入侵指标。

## 缓解措施`;
    const out = stripEmptyConditionalSections(src);
    expect(out).not.toContain("入侵指标");
    expect(out).toContain("## 缓解措施");
  });

  it("strips ZH empty TTP stub", () => {
    const src = `## 入侵指标

真实数据

## 战术、技术与程序

未发现相关信息。

## 威胁行为者背景`;
    const out = stripEmptyConditionalSections(src);
    expect(out).not.toContain("战术、技术与程序");
    expect(out).toContain("## 威胁行为者背景");
  });
});

describe("stripEmptyConditionalSections — pure / no-op cases", () => {
  it("no-op when no stubs present", () => {
    const src = `## Executive Summary\n\nlede here\n\n## References\n- foo`;
    expect(stripEmptyConditionalSections(src)).toBe(src);
  });

  it("no-op on empty string", () => {
    expect(stripEmptyConditionalSections("")).toBe("");
  });

  it("strips MULTIPLE empty conditional sections in one pass", () => {
    const src = `## Executive Summary

lede

## Indicators of Compromise

None identified in source material.

## Tactics, Techniques & Procedures

None identified at this time.

## Threat Actor Context

None identified in source material.

## Mitigations & Recommendations

advice`;
    const out = stripEmptyConditionalSections(src);
    expect(out).not.toContain("Indicators of Compromise");
    expect(out).not.toContain("Tactics, Techniques");
    expect(out).not.toContain("Threat Actor Context");
    expect(out).not.toContain("None identified");
    expect(out).toContain("## Mitigations");
  });
});

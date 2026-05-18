import { describe, expect, it } from "vitest";

import { buildSourcesHash } from "../tag-intros/aggregate-facts.js";
import { checkTagIntro } from "../tag-intros/fact-check.js";
import {
  buildFallbackIntroEn,
  buildFallbackIntroZh,
} from "../tag-intros/sparse-template.js";
import type { TagFactSheet } from "../tag-intros/types.js";

const sheet: TagFactSheet = {
  tag: "active-exploitation",
  locale: "en",
  count: 12,
  date_range: {
    first: "2026-05-01",
    latest: "2026-05-18",
  },
  top_actors: ["LockBit"],
  top_cves: [{ id: "CVE-2025-2749" }, { id: "CVE-2024-57728", cvss: 7.2 }],
  top_sectors: ["enterprise", "government"],
  top_regions: ["United States", "Global"],
  severity_mix: { high: 9, medium: 3 },
  recent_excerpts: [],
  sources_hash: "abc123",
};

describe("tag intro fallback templates", () => {
  it("builds an audit-clean EN intro from only fact-sheet values", () => {
    const intro = buildFallbackIntroEn(sheet);
    const check = checkTagIntro(intro, sheet, { locale: "en" });

    expect(check.passed).toBe(true);
    expect(intro).toContain("CVE-2025-2749");
    expect(intro).toContain("CVE-2024-57728");
    expect(intro).not.toContain("CVE-2026-33626");
  });

  it("builds an audit-clean ZH intro while preserving CVE and actor tokens", () => {
    const intro = buildFallbackIntroZh({ ...sheet, locale: "zh" });
    const check = checkTagIntro(intro, sheet, { locale: "zh" });

    expect(check.passed).toBe(true);
    expect(intro).toContain("CVE-2025-2749");
    expect(intro).toContain("CVE-2024-57728");
    expect(intro).toContain("LockBit");
  });
});

describe("tag fact sources hash", () => {
  it("changes when intro-visible CVE metadata changes without slug/date churn", () => {
    const baseArticle = {
      frontmatter: {
        slug: "same-article",
        date: "2026-05-18",
        tags: ["cisa"],
        cve_ids: ["CVE-2025-2749"],
        cvss_score: 7.2,
        severity: "high",
        affected_sectors: ["enterprise"],
        affected_regions: ["Global"],
        excerpt: "A source-grounded vulnerability report.",
      },
      content: "",
    };

    const changedArticle = {
      ...baseArticle,
      frontmatter: {
        ...baseArticle.frontmatter,
        cve_ids: ["CVE-2024-57728"],
      },
    };

    expect(buildSourcesHash([baseArticle as never])).not.toEqual(
      buildSourcesHash([changedArticle as never]),
    );
  });
});

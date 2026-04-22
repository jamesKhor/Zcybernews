/**
 * NVD parser tests — pure mapping path only (network path has its own
 * runtime errors but nothing to unit-test beyond "calls fetch" which
 * is unhelpful).
 */
import { describe, it, expect } from "vitest";
import { mapNvdToStories, type NvdFeedPayload } from "../fetchers/nvd";
import type { FeedSource } from "../../sources/feeds";

const NVD_SOURCE: FeedSource = {
  id: "nvd-recent",
  name: "NVD — Recent CVEs",
  url: "https://nvd.nist.gov/feeds/json/cve/2.0/nvdcve-2.0-recent.json",
  category: "vulnerabilities",
  type: "nvd-json",
  enabled: true,
  qualityScore: 1.0,
};

const NOW = "2026-04-22T00:00:00.000Z";

// Minimal NVD-shaped fixture covering the fields the mapper reads.
const fixture: NvdFeedPayload = {
  vulnerabilities: [
    {
      cve: {
        id: "CVE-2026-1234",
        published: "2026-04-20T10:00:00.000",
        lastModified: "2026-04-21T10:00:00.000",
        descriptions: [
          {
            lang: "en",
            value:
              "A critical heap-overflow vulnerability in WidgetOS allows remote code execution via a crafted HTTP request. Affects versions 3.0 through 3.5.2.",
          },
          { lang: "es", value: "descripcion en espanol" },
        ],
        metrics: {
          cvssMetricV31: [
            {
              cvssData: {
                baseScore: 9.8,
                vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
                baseSeverity: "CRITICAL",
              },
              source: "nvd@nist.gov",
            },
          ],
          cvssMetricV2: [
            {
              cvssData: { baseScore: 7.5 },
            },
          ],
        },
        references: [
          {
            url: "https://vendor.com/advisory/1234",
            tags: ["Vendor Advisory"],
          },
          { url: "https://nvd.nist.gov/vuln/detail/CVE-2026-1234" },
        ],
        weaknesses: [
          { description: [{ lang: "en", value: "CWE-122" }] },
          { description: [{ lang: "en", value: "CWE-787" }] },
        ],
      },
    },
    {
      cve: {
        id: "CVE-2026-5678",
        published: "2026-04-18T00:00:00.000",
        descriptions: [
          {
            lang: "en",
            value:
              "SQL injection in FooBar admin portal allows an authenticated attacker to read arbitrary rows from other tenants.",
          },
        ],
        metrics: {
          cvssMetricV31: [{ cvssData: { baseScore: 6.5 } }],
        },
      },
    },
    {
      // Should be skipped — no English description
      cve: {
        id: "CVE-2026-9999",
        descriptions: [{ lang: "fr", value: "Uniquement en francais" }],
      },
    },
    {
      // Should be skipped — English description too short
      cve: {
        id: "CVE-2026-0001",
        descriptions: [{ lang: "en", value: "Short." }],
      },
    },
  ],
};

describe("mapNvdToStories", () => {
  it("maps valid CVEs to Story records", () => {
    const stories = mapNvdToStories(fixture, NVD_SOURCE, NOW);
    expect(stories).toHaveLength(2);
    expect(stories[0].id).toBe("nvd-CVE-2026-1234");
    expect(stories[1].id).toBe("nvd-CVE-2026-5678");
  });

  it("sorts newest-published first", () => {
    const stories = mapNvdToStories(fixture, NVD_SOURCE, NOW);
    // CVE-2026-1234 published 2026-04-20, CVE-2026-5678 on 2026-04-18
    expect(stories[0].id).toBe("nvd-CVE-2026-1234");
  });

  it("embeds CVE ID + highest CVSS score in title", () => {
    const stories = mapNvdToStories(fixture, NVD_SOURCE, NOW);
    expect(stories[0].title).toContain("CVE-2026-1234");
    expect(stories[0].title).toContain("CVSS 9.8");
    // Picks v3.1 (9.8) over v2 (7.5)
    expect(stories[0].title).not.toContain("7.5");
  });

  it("uses primary reference URL when available", () => {
    const stories = mapNvdToStories(fixture, NVD_SOURCE, NOW);
    expect(stories[0].url).toBe("https://vendor.com/advisory/1234");
  });

  it("falls back to NVD detail URL when no references", () => {
    const stories = mapNvdToStories(fixture, NVD_SOURCE, NOW);
    expect(stories[1].url).toBe(
      "https://nvd.nist.gov/vuln/detail/CVE-2026-5678",
    );
  });

  it("populates tags with CVE ID + NVD + CWE identifiers", () => {
    const stories = mapNvdToStories(fixture, NVD_SOURCE, NOW);
    expect(stories[0].tags).toContain("CVE-2026-1234");
    expect(stories[0].tags).toContain("NVD");
    expect(stories[0].tags).toContain("CWE-122");
    expect(stories[0].tags).toContain("CWE-787");
  });

  it("caps tags at 5 items", () => {
    const stories = mapNvdToStories(fixture, NVD_SOURCE, NOW);
    expect(stories[0].tags.length).toBeLessThanOrEqual(5);
  });

  it("skips CVEs with no English description", () => {
    const stories = mapNvdToStories(fixture, NVD_SOURCE, NOW);
    const ids = stories.map((s) => s.id);
    expect(ids).not.toContain("nvd-CVE-2026-9999");
  });

  it("skips CVEs with description too short to reason about", () => {
    const stories = mapNvdToStories(fixture, NVD_SOURCE, NOW);
    const ids = stories.map((s) => s.id);
    expect(ids).not.toContain("nvd-CVE-2026-0001");
  });

  it("sets A2.2 Story fields (sourceId, sourceCategory, fetchedAt, isVendor, qualityScore)", () => {
    const stories = mapNvdToStories(fixture, NVD_SOURCE, NOW);
    expect(stories[0].sourceId).toBe("nvd-recent");
    expect(stories[0].sourceCategory).toBe("vulnerabilities");
    expect(stories[0].fetchedAt).toBe(NOW);
    expect(stories[0].isVendor).toBe(false);
    expect(stories[0].qualityScore).toBe(1.0);
  });

  it("returns empty array on empty payload", () => {
    expect(mapNvdToStories({}, NVD_SOURCE, NOW)).toEqual([]);
    expect(mapNvdToStories({ vulnerabilities: [] }, NVD_SOURCE, NOW)).toEqual(
      [],
    );
  });

  it("handles CVEs missing metrics gracefully (no score in title)", () => {
    const fixtureNoMetrics: NvdFeedPayload = {
      vulnerabilities: [
        {
          cve: {
            id: "CVE-2026-7777",
            published: "2026-04-22T00:00:00.000",
            descriptions: [
              {
                lang: "en",
                value:
                  "An authentication bypass in ExampleApp permits unauthenticated access to privileged endpoints. No severity rating has been assigned yet.",
              },
            ],
          },
        },
      ],
    };
    const stories = mapNvdToStories(fixtureNoMetrics, NVD_SOURCE, NOW);
    expect(stories).toHaveLength(1);
    expect(stories[0].title).toContain("CVE-2026-7777");
    expect(stories[0].title).not.toContain("CVSS");
  });

  it("caps total stories at 20 even if feed has more", () => {
    const many: NvdFeedPayload = {
      vulnerabilities: Array.from({ length: 30 }, (_, i) => ({
        cve: {
          id: `CVE-2026-${String(9000 + i).padStart(5, "0")}`,
          published: `2026-04-${String(1 + (i % 20)).padStart(2, "0")}T00:00:00.000`,
          descriptions: [
            {
              lang: "en",
              value:
                "Sufficiently long description text so that the short-description skip gate does not fire on this synthetic entry.",
            },
          ],
        },
      })),
    };
    const stories = mapNvdToStories(many, NVD_SOURCE, NOW);
    expect(stories.length).toBeLessThanOrEqual(20);
  });
});

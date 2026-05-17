import { describe, expect, it } from "vitest";
import { selectEditorialCandidates } from "../editorial-selector";
import type { StoryCluster } from "../story-clustering";
import type { Story } from "../../utils/dedup";

function story(overrides: Partial<Story>): Story {
  return {
    id: overrides.id ?? "s1",
    title: overrides.title ?? "Security story",
    url: overrides.url ?? "https://example.com/story",
    excerpt: overrides.excerpt ?? "A concrete security story with details.",
    sourceName: overrides.sourceName ?? "Example Source",
    publishedAt: overrides.publishedAt ?? "2026-05-17T00:00:00.000Z",
    tags: overrides.tags ?? ["security"],
    ...overrides,
  };
}

function cluster(key: string, stories: Story[]): StoryCluster<Story> {
  return {
    key,
    stories,
    sources: [...new Set(stories.map((s) => s.sourceId ?? s.sourceName))],
    latestPublishedAt: stories[0]?.publishedAt ?? "2026-05-17T00:00:00.000Z",
  };
}

describe("selectEditorialCandidates", () => {
  it("publishes stronger multi-source ransomware coverage before low-value CVEs", () => {
    const ransomware = cluster("topic:lockbit-hospital", [
      story({
        id: "r1",
        title: "LockBit claims hospital data theft after ransomware attack",
        excerpt:
          "LockBit listed a hospital victim and claimed it stole patient records.",
        sourceName: "BleepingComputer",
        sourceClass: "reputable-media",
        authorityScore: 0.75,
        tags: ["ransomware", "breach"],
      }),
      story({
        id: "r2",
        title: "Hospital investigates ransomware data theft claim",
        excerpt:
          "The hospital confirmed an investigation after a ransomware group claimed data theft.",
        sourceName: "SecurityWeek",
        sourceClass: "reputable-media",
        authorityScore: 0.72,
        tags: ["ransomware"],
      }),
    ]);
    const staleCve = cluster("cve:CVE-2021-47980", [
      story({
        id: "c1",
        title:
          "CVE-2021-47980 Fuel CMS blind SQL injection vulnerability published",
        excerpt: "CVE-2021-47980 has CVSS 7.1 and affects Fuel CMS 1.4.13.",
        sourceName: "NVD",
        sourceClass: "structured-vulnerability",
        authorityScore: 0.9,
        sourceType: "nvd-json",
        tags: ["CVE-2021-47980"],
      }),
    ]);

    const result = selectEditorialCandidates([staleCve, ransomware], {
      maxArticles: 1,
    });

    expect(result.publishable[0].clusterKey).toBe("topic:lockbit-hospital");
    expect(
      result.decisions.find((d) => d.clusterKey === "cve:CVE-2021-47980")
        ?.decision,
    ).not.toBe("publish-now");
  });

  it("holds weak single-source items for research", () => {
    const result = selectEditorialCandidates(
      [
        cluster("topic:thin", [
          story({
            title: "Vendor says security update is available",
            excerpt: "The vendor says a security update is available.",
            sourceName: "Vendor Blog",
            tags: [],
          }),
        ]),
      ],
      { maxArticles: 1 },
    );

    expect(result.publishable).toHaveLength(0);
    expect(result.decisions[0].decision).toBe("research-more");
  });

  it("does not publish ordinary single-source NVD CVEs without exploit urgency", () => {
    const result = selectEditorialCandidates(
      [
        cluster("cve:CVE-2026-8736", [
          story({
            title:
              "CVE-2026-8736 Oinone Pamirs request parameter flaw gets CVSS 4.3",
            excerpt:
              "A security flaw has been found in Oinone Pamirs up to 7.2.0 with CVSS 4.3.",
            sourceName: "NVD",
            sourceClass: "structured-vulnerability",
            sourceType: "nvd-json",
            verificationRole: "primary-evidence",
            tags: ["CVE-2026-8736", "NVD"],
          }),
        ]),
      ],
      { maxArticles: 1 },
    );

    expect(result.publishable).toHaveLength(0);
    expect(result.decisions[0].decision).toBe("digest-only");
  });

  it("does not publish medium single-source vendor CVEs as full articles", () => {
    const result = selectEditorialCandidates(
      [
        cluster("cve:CVE-2026-0251", [
          story({
            title:
              "CVE-2026-0251 GlobalProtect App: Local Privilege Escalation Vulnerabilities (Severity: MEDIUM)",
            excerpt:
              "Palo Alto Networks published an advisory for local privilege escalation vulnerabilities in GlobalProtect App.",
            sourceName: "Palo Alto Networks Security Advisories",
            sourceClass: "primary",
            verificationRole: "primary-evidence",
            tags: ["CVE-2026-0251", "Palo Alto"],
          }),
        ]),
      ],
      { maxArticles: 1 },
    );

    expect(result.publishable).toHaveLength(0);
    expect(result.decisions[0].decision).toBe("digest-only");
  });

  it("caps CVE-style candidates so one run does not become all vulnerability notes", () => {
    const result = selectEditorialCandidates(
      [
        cluster("cve:CVE-2026-9001", [
          story({
            title: "CVE-2026-9001 critical product flaw actively exploited",
            excerpt: "CVE-2026-9001 has CVSS 9.8 and is actively exploited.",
            sourceName: "CISA",
            sourceClass: "government",
            sourceType: "cisa-kev",
            verificationRole: "primary-evidence",
            tags: ["CVE-2026-9001"],
          }),
        ]),
        cluster("cve:CVE-2026-9002", [
          story({
            title: "CVE-2026-9002 critical product flaw actively exploited",
            excerpt: "CVE-2026-9002 has CVSS 9.8 and is actively exploited.",
            sourceName: "CISA",
            sourceClass: "government",
            sourceType: "cisa-kev",
            verificationRole: "primary-evidence",
            tags: ["CVE-2026-9002"],
          }),
        ]),
        cluster("topic:apt29-diplomats", [
          story({
            title: "APT29 targets diplomats with malware campaign",
            excerpt: "The state-backed actor used malware against embassies.",
            sourceName: "SecurityWeek",
            sourceClass: "reputable-media",
            tags: ["APT29", "malware"],
          }),
          story({
            title: "Embassies targeted in APT29 malware campaign",
            excerpt: "Researchers linked the campaign to APT29.",
            sourceName: "BleepingComputer",
            sourceClass: "reputable-media",
            tags: ["APT29"],
          }),
        ]),
      ],
      { maxArticles: 3 },
    );

    expect(
      result.publishable.filter((item) => item.clusterKey.startsWith("cve:")),
    ).toHaveLength(1);
    expect(result.publishable.map((item) => item.clusterKey)).toContain(
      "topic:apt29-diplomats",
    );
    expect(
      result.decisions.find((item) => item.clusterKey === "cve:CVE-2026-9002")
        ?.reasons,
    ).toContain("cve-style daily cap");
  });
});

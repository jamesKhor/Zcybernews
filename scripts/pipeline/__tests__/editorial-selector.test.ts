import { describe, expect, it } from "vitest";
import { selectEditorialCandidates } from "../editorial-selector";
import { aggregateTasteProfile } from "../taste-profile";
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

  it("keeps research and digest candidates reviewable during taste calibration", () => {
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
    const researchMore = cluster("topic:vendor-update", [
      story({
        id: "v1",
        title: "Vendor says security update is available",
        excerpt: "The vendor says a security update is available.",
        sourceName: "Vendor Blog",
        tags: [],
      }),
    ]);
    const digestOnlyCve = cluster("cve:CVE-2026-8736", [
      story({
        id: "c1",
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
    ]);

    const result = selectEditorialCandidates(
      [ransomware, researchMore, digestOnlyCve],
      { maxArticles: 3 },
    );

    expect(result.publishable.map((item) => item.clusterKey)).toEqual([
      "topic:lockbit-hospital",
    ]);
    expect(result.reviewable.map((item) => item.clusterKey).sort()).toEqual([
      "cve:CVE-2026-8736",
      "topic:lockbit-hospital",
      "topic:vendor-update",
    ]);
  });

  it("caps ordinary CVE review candidates so other cyber lanes can surface", () => {
    const cveClusters = Array.from({ length: 5 }, (_, index) =>
      cluster(`cve:CVE-2026-90${index + 10}`, [
        story({
          id: `cve-${index}`,
          title: `CVE-2026-90${index + 10} WordPress plugin vulnerability gets CVSS 6.5`,
          excerpt:
            "NVD published a medium severity WordPress plugin vulnerability with authorization bypass impact.",
          sourceName: "NVD",
          sourceClass: "structured-vulnerability",
          sourceType: "nvd-json",
          verificationRole: "primary-evidence",
          tags: [`CVE-2026-90${index + 10}`, "NVD", "WordPress"],
        }),
      ]),
    );
    const aptStory = cluster("topic:apt-malware-campaign", [
      story({
        id: "apt-1",
        title: "Chinese APT deploys new malware to maintain network access",
        excerpt:
          "Researchers describe a Chinese APT campaign using new malware for persistence in compromised networks.",
        sourceName: "BleepingComputer",
        sourceClass: "reputable-media",
        authorityScore: 0.75,
        tags: ["APT", "malware", "China"],
      }),
    ]);
    const aiStory = cluster("topic:ai-threat-report", [
      story({
        id: "ai-1",
        title: "Anthropic maps AI-enabled cyber abuse trends",
        excerpt:
          "The report describes how attackers are using AI tools for phishing, malware development, and intrusion support.",
        sourceName: "SecurityWeek",
        sourceClass: "reputable-media",
        authorityScore: 0.72,
        tags: ["AI security", "threat intelligence"],
      }),
    ]);
    const genericAiPolicy = cluster("topic:openai-public-policy", [
      story({
        id: "policy-1",
        title: "A blueprint for democratic governance of frontier AI",
        excerpt:
          "OpenAI outlines public policy priorities for secure model development and democratic governance.",
        sourceName: "OpenAI News",
        sourceClass: "primary",
        authorityScore: 0.95,
        tags: ["OpenAI", "AI security"],
      }),
    ]);
    const roundup = cluster("topic:weekly-threat-roundup", [
      story({
        id: "roundup-1",
        title: "The Good, the Bad and the Ugly in Cybersecurity Week 23",
        excerpt:
          "A weekly cybersecurity roundup recaps vulnerabilities, breaches, malware, and security industry updates.",
        sourceName: "SentinelLabs",
        sourceClass: "reputable-media",
        authorityScore: 0.9,
        tags: ["security roundup"],
      }),
    ]);

    const result = selectEditorialCandidates(
      [...cveClusters, roundup, genericAiPolicy, aptStory, aiStory],
      { maxArticles: 6 },
    );
    const reviewableKeys = result.reviewable.map((item) => item.clusterKey);

    expect(reviewableKeys.filter((key) => key.startsWith("cve:"))).toHaveLength(
      2,
    );
    expect(reviewableKeys).toContain("topic:apt-malware-campaign");
    expect(reviewableKeys).toContain("topic:ai-threat-report");
    expect(reviewableKeys).not.toContain("topic:weekly-threat-roundup");
    expect(reviewableKeys).not.toContain("topic:openai-public-policy");
  });

  it("does not publish obscure critical NVD-only CVEs just because CVSS is high", () => {
    const result = selectEditorialCandidates(
      [
        cluster("cve:CVE-2026-45230", [
          story({
            title:
              "CVE-2026-45230 Unauthenticated Path Traversal in DumbAssets Lets Attackers Read Files",
            excerpt:
              "NVD published a CVE record for DumbAssets with CVSS 9.1 and path traversal impact.",
            sourceName: "NVD",
            sourceClass: "structured-vulnerability",
            sourceType: "nvd-json",
            verificationRole: "primary-evidence",
            tags: ["CVE-2026-45230", "NVD"],
          }),
        ]),
      ],
      { maxArticles: 1 },
    );

    expect(result.publishable).toHaveLength(0);
    expect(result.decisions[0].decision).toBe("digest-only");
    expect(result.decisions[0].reasons).toContain("nvd-only-obscure-cve");
  });

  it("does not publish no-CVSS high-severity CVEs without exploit or strategic context", () => {
    const result = selectEditorialCandidates(
      [
        cluster("cve:CVE-2026-46356", [
          story({
            title:
              "Fleet Patches API Rate-Limiting Bypass via IP Spoofing (Severity: HIGH)",
            excerpt:
              "A CVE-2026-46356 advisory says the issue affects Fleet API rate limiting, but no CVSS score is available.",
            sourceName: "NVD",
            sourceClass: "structured-vulnerability",
            sourceType: "nvd-json",
            verificationRole: "primary-evidence",
            tags: ["CVE-2026-46356", "NVD"],
          }),
        ]),
      ],
      { maxArticles: 1 },
    );

    expect(result.publishable).toHaveLength(0);
    expect(result.decisions[0].decision).toBe("digest-only");
    expect(result.decisions[0].reasons).toContain("missing-cvss");
  });

  it("can publish strategic-vendor critical CVEs from NVD", () => {
    const result = selectEditorialCandidates(
      [
        cluster("cve:CVE-2026-8959", [
          story({
            title:
              "CVE-2026-8959 Firefox Sandbox Escape via Win32 Boundary Flaw",
            excerpt:
              "NVD published CVE-2026-8959 with CVSS 9.6 affecting Mozilla Firefox sandbox isolation.",
            sourceName: "NVD",
            sourceClass: "structured-vulnerability",
            sourceType: "nvd-json",
            verificationRole: "primary-evidence",
            tags: ["CVE-2026-8959", "Mozilla", "Firefox"],
          }),
        ]),
      ],
      { maxArticles: 1 },
    );

    expect(result.publishable.map((item) => item.clusterKey)).toContain(
      "cve:CVE-2026-8959",
    );
  });

  it("publishes CISA KEV entries even when CVSS is not present in the feed item", () => {
    const result = selectEditorialCandidates(
      [
        cluster("cve:CVE-2026-41091", [
          story({
            title:
              "[CVE-2026-41091] Microsoft Defender Link Following Vulnerability",
            excerpt:
              "Microsoft Defender contains a link following vulnerability. Required action: Apply mitigations per vendor instructions.",
            sourceName: "CISA Known Exploited Vulnerabilities",
            sourceClass: "government",
            sourceType: "cisa-kev",
            sourceId: "cisa-kev",
            verificationRole: "primary-evidence",
            tags: ["CVE-2026-41091", "Microsoft", "Defender", "KEV", "CISA"],
          }),
        ]),
      ],
      { maxArticles: 1 },
    );

    expect(result.publishable.map((item) => item.clusterKey)).toContain(
      "cve:CVE-2026-41091",
    );
    expect(result.decisions[0].reasons).not.toContain("missing-cvss");
  });

  it("can publish critical AI infrastructure CVEs from strategic vendors", () => {
    const result = selectEditorialCandidates(
      [
        cluster("cve:CVE-2026-24163", [
          story({
            title:
              "CVE-2026-24163 NVIDIA TRT-LLM RPC Vulnerability Gets CVSS 9.8",
            excerpt:
              "NVIDIA TRT-LLM contains a vulnerability in RPC handling with CVSS 9.8 affecting AI inference infrastructure.",
            sourceName: "NVD",
            sourceClass: "structured-vulnerability",
            sourceType: "nvd-json",
            verificationRole: "primary-evidence",
            tags: ["CVE-2026-24163", "NVIDIA", "TRT-LLM", "AI security"],
          }),
        ]),
      ],
      { maxArticles: 1 },
    );

    expect(result.publishable.map((item) => item.clusterKey)).toContain(
      "cve:CVE-2026-24163",
    );
  });

  it("can publish official OpenAI cybersecurity releases in the AI security lane", () => {
    const result = selectEditorialCandidates(
      [
        cluster("topic:openai-daybreak", [
          story({
            title: "OpenAI Daybreak launches cybersecurity accelerator",
            excerpt:
              "OpenAI Daybreak is a cybersecurity accelerator for security startups building the next generation of cybersecurity tools.",
            sourceName: "OpenAI News",
            sourceClass: "primary",
            verificationRole: "primary-evidence",
            authorityScore: 0.9,
            tags: ["OpenAI", "AI security", "Daybreak"],
          }),
        ]),
      ],
      { maxArticles: 1 },
    );

    expect(result.publishable.map((item) => item.clusterKey)).toContain(
      "topic:openai-daybreak",
    );
    expect(result.decisions[0].lane).toBe("ai-security");
  });

  it("can publish single-source original APT research from trusted research teams", () => {
    const result = selectEditorialCandidates(
      [
        cluster("topic:cloud-atlas-kaspersky", [
          story({
            title:
              "Cloud Atlas activity in late 2025 and early 2026: new tools and payload",
            excerpt:
              "Kaspersky GReAT researchers detail a Cloud Atlas espionage campaign using a new backdoor against government targets.",
            sourceName: "Kaspersky Securelist",
            sourceClass: "security-research",
            verificationRole: "corroboration",
            authorityScore: 0.84,
            originalityScore: 0.86,
            noiseRisk: "none",
            tags: ["Cloud Atlas", "APT", "espionage", "government"],
          }),
        ]),
      ],
      { maxArticles: 1 },
    );

    expect(result.publishable.map((item) => item.clusterKey)).toContain(
      "topic:cloud-atlas-kaspersky",
    );
    expect(result.decisions[0].reasons).not.toContain("no-primary-source");
  });

  it("can publish original breach reporting from trusted investigative sources", () => {
    const result = selectEditorialCandidates(
      [
        cluster("topic:cisa-data-leak-krebs", [
          story({
            title:
              "Lawmakers Demand Answers as CISA Tries to Contain Data Leak",
            excerpt:
              "Krebs on Security reports that lawmakers asked CISA for answers after exposed records and credentials were found in a private repository.",
            sourceName: "Krebs on Security",
            sourceClass: "security-research",
            verificationRole: "corroboration",
            authorityScore: 0.9,
            originalityScore: 0.9,
            noiseRisk: "none",
            tags: ["CISA", "data breach", "credentials", "government"],
          }),
        ]),
      ],
      { maxArticles: 1 },
    );

    expect(result.publishable.map((item) => item.clusterKey)).toContain(
      "topic:cisa-data-leak-krebs",
    );
    expect(result.decisions[0].lane).toBe("breaches");
  });

  it("keeps weekly recap roundups out of publish slots when real incidents are available", () => {
    const result = selectEditorialCandidates(
      [
        cluster("topic:weekly-recap", [
          story({
            title: "The Good, the Bad and the Ugly in Cybersecurity - Week 21",
            excerpt:
              "A weekly recap of zero-days, ransomware, and several cybersecurity stories from the week.",
            sourceName: "SentinelLabs",
            sourceClass: "security-research",
            verificationRole: "corroboration",
            authorityScore: 0.78,
            originalityScore: 0.76,
            noiseRisk: "none",
            tags: ["weekly recap", "zero-day", "ransomware"],
          }),
        ]),
        cluster("topic:breach", [
          story({
            title:
              "Lawmakers Demand Answers as CISA Tries to Contain Data Leak",
            excerpt:
              "Krebs on Security reports that lawmakers asked CISA for answers after exposed records and credentials were found in a private repository.",
            sourceName: "Krebs on Security",
            sourceClass: "security-research",
            verificationRole: "corroboration",
            authorityScore: 0.9,
            originalityScore: 0.9,
            noiseRisk: "none",
            tags: ["CISA", "data breach", "credentials", "government"],
          }),
        ]),
      ],
      { maxArticles: 1 },
    );

    expect(result.publishable.map((item) => item.clusterKey)).toEqual([
      "topic:breach",
    ]);
    expect(
      result.decisions.find((item) => item.clusterKey === "topic:weekly-recap")
        ?.decision,
    ).toBe("digest-only");
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

  it("does not cap actively exploited strategic critical CVEs", () => {
    const result = selectEditorialCandidates(
      [
        cluster("cve:CVE-2026-41089", [
          story({
            title: "CVE-2026-41089 Windows Netlogon RCE actively exploited",
            excerpt:
              "Microsoft Windows Netlogon has CVSS 9.8 and is actively exploited in the wild against domain controllers.",
            sourceName: "CCB Belgium",
            sourceClass: "government",
            verificationRole: "primary-evidence",
            tags: ["CVE-2026-41089", "Microsoft", "Windows", "Netlogon"],
          }),
        ]),
        cluster("cve:CVE-2026-41096", [
          story({
            title: "CVE-2026-41096 Windows DNS Client RCE actively exploited",
            excerpt:
              "Microsoft Windows DNS Client has CVSS 9.8 and is actively exploited in the wild without user interaction.",
            sourceName: "Microsoft MSRC",
            sourceClass: "primary",
            verificationRole: "primary-evidence",
            tags: ["CVE-2026-41096", "Microsoft", "Windows", "DNS"],
          }),
        ]),
      ],
      { maxArticles: 2 },
    );

    expect(result.publishable.map((item) => item.clusterKey).sort()).toEqual([
      "cve:CVE-2026-41089",
      "cve:CVE-2026-41096",
    ]);
    expect(result.decisions.flatMap((item) => item.reasons)).not.toContain(
      "cve-style daily cap",
    );
  });

  it("nudges selection with reviewed taste signals without replacing safety gates", () => {
    const aiCluster = cluster("topic:openai-daybreak", [
      story({
        id: "ai1",
        title: "OpenAI Daybreak launches cybersecurity accelerator",
        excerpt:
          "OpenAI Daybreak is a cybersecurity accelerator for security startups building defensive tools.",
        sourceName: "OpenAI News",
        sourceClass: "primary",
        verificationRole: "primary-evidence",
        authorityScore: 0.9,
        tags: ["OpenAI", "AI security", "Daybreak"],
      }),
    ]);
    const baseline = selectEditorialCandidates([aiCluster], { maxArticles: 1 });
    const tasteProfile = aggregateTasteProfile(
      [
        {
          candidateId: "reviewed-ai",
          clusterKey: "topic:reviewed-ai",
          proposedTitle: "AI security item founder liked",
          lane: "ai-security",
          score: 0.7,
          decision: "publish-now",
          selectionReasons: ["trusted sources", "search demand"],
          sourceNames: ["OpenAI News"],
          reviewer: {
            status: "approved",
            tasteRating: 0.96,
            positiveSignals: ["hot-topic", "reader-likely-cares", "brand-fit"],
            negativeSignals: [],
            selectedReasonTags: ["search demand"],
          },
        },
      ],
      { now: new Date("2026-05-27T00:00:00.000Z") },
    );
    const tuned = selectEditorialCandidates([aiCluster], {
      maxArticles: 1,
      tasteProfile,
    });

    expect(tuned.decisions[0].score).toBeGreaterThan(
      baseline.decisions[0].score,
    );
    expect(tuned.decisions[0].tasteProfileScore).toBeGreaterThan(0);
    expect(
      tuned.decisions[0].reasons.some((reason) =>
        reason.startsWith("taste-boost:"),
      ),
    ).toBe(true);
  });
});

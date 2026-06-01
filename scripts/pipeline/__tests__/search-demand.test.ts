import { describe, expect, it } from "vitest";
import { classifyTopicLane, scoreSearchDemand } from "../search-demand";

describe("search demand scoring", () => {
  it("scores high-intent CVE and exploited phrasing", () => {
    const scored = scoreSearchDemand({
      title: "Microsoft Exchange CVE-2026-12345 Actively Exploited",
      excerpt: "CISA added the flaw to KEV after exploitation.",
      tags: ["Microsoft", "Exchange"],
      cves: ["CVE-2026-12345"],
    });

    expect(scored.score).toBeGreaterThan(0.75);
    expect(scored.matchedHints).toContain("pattern:CVE-");
    expect(scored.matchedHints).toContain("pattern:actively exploited");
  });

  it("classifies ransomware and APT outside the vulnerability lane", () => {
    expect(
      classifyTopicLane({
        title: "LockBit claims data theft from hospital network",
        excerpt: "Ransomware operators listed the victim on a leak site.",
        tags: ["ransomware"],
      }),
    ).toBe("ransomware");

    expect(
      classifyTopicLane({
        title: "APT29 targets diplomats with phishing campaign",
        excerpt: "The state-backed actor used malware against embassies.",
        tags: ["APT29"],
      }),
    ).toBe("apt-state-actors");
  });

  it("keeps CVEs in AI-named products in the vulnerability lane", () => {
    expect(
      classifyTopicLane({
        title:
          "CVE-2026-8719 AI Engine WordPress plugin flaw receives CVSS 8.8",
        excerpt:
          "NVD published a vulnerability record for the AI Engine WordPress plugin.",
        tags: ["CVE-2026-8719", "NVD"],
      }),
    ).toBe("vulnerabilities");
  });

  it("keeps explicit exploited CVE and KEV items in the vulnerability lane", () => {
    expect(
      classifyTopicLane({
        title:
          "CVE-2026-41089 Windows Netlogon RCE actively exploited in the wild",
        excerpt:
          "The critical CVSS 9.8 vulnerability can be abused remotely and may be used by ransomware operators against domain controllers.",
        tags: ["CVE-2026-41089", "Windows", "Netlogon", "malware"],
      }),
    ).toBe("vulnerabilities");

    expect(
      classifyTopicLane({
        title: "CISA KEV adds TanStack CVE exploited by attackers",
        excerpt:
          "Known Exploited Vulnerabilities catalog entry requires urgent patching even though follow-on reporting mentions malware activity.",
        tags: ["CISA", "KEV", "CVE-2026-9999", "malware"],
      }),
    ).toBe("vulnerabilities");
  });

  it("routes official OpenAI cybersecurity news to AI security", () => {
    const input = {
      title: "OpenAI Daybreak launches cybersecurity accelerator",
      excerpt:
        "Security startups can build the next generation of cybersecurity tools with OpenAI.",
      tags: ["OpenAI", "AI security", "Daybreak"],
    };

    expect(classifyTopicLane(input)).toBe("ai-security");
    expect(scoreSearchDemand(input).score).toBeGreaterThan(0.6);
  });

  it("does not force zero-day policy commentary into the vulnerability lane", () => {
    expect(
      classifyTopicLane({
        title:
          "Microsoft calls zero-day releases never justifiable after researcher backlash",
        excerpt:
          "The company discussed researcher conduct, disclosure norms, and release policy after public criticism.",
        tags: ["Microsoft", "GitHub", "research policy"],
      }),
    ).toBe("policy");
  });
});

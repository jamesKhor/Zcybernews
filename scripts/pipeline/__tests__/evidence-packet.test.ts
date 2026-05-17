import { describe, expect, it } from "vitest";
import { buildEvidencePacket } from "../evidence-packet";
import type { Story } from "../../utils/dedup";

function story(overrides: Partial<Story>): Story {
  return {
    id: overrides.id ?? "s1",
    title:
      overrides.title ??
      "Microsoft patches CVE-2026-12345 after active exploitation",
    url: overrides.url ?? "https://example.com/story",
    excerpt:
      overrides.excerpt ??
      "CVE-2026-12345 carries CVSS 9.8 and is actively exploited against Microsoft Exchange servers.",
    sourceName: overrides.sourceName ?? "CISA",
    publishedAt: overrides.publishedAt ?? "2026-05-17T00:00:00.000Z",
    tags: overrides.tags ?? ["Microsoft", "Exchange", "CISA"],
    ...overrides,
  };
}

describe("buildEvidencePacket", () => {
  it("extracts concrete vulnerability evidence from a cluster", () => {
    const packet = buildEvidencePacket({
      key: "cve:CVE-2026-12345",
      stories: [
        story({
          sourceClass: "government",
          verificationRole: "primary-evidence",
        }),
      ],
      sources: ["cisa-alerts"],
      latestPublishedAt: "2026-05-17T00:00:00.000Z",
    });

    expect(packet.entities.cves).toEqual(["CVE-2026-12345"]);
    expect(packet.entities.vendors).toContain("Microsoft");
    expect(packet.facts.cvssScores).toEqual([9.8]);
    expect(packet.facts.exploitStatus).toBe("exploited");
    expect(packet.hasPrimaryEvidence).toBe(true);
    expect(packet.uncertainty).not.toContain("single-source");
  });

  it("marks single-source low-detail clusters as uncertain", () => {
    const packet = buildEvidencePacket({
      key: "topic:vendor-says-security-update",
      stories: [
        story({
          title: "Vendor announces security update",
          excerpt: "The vendor says a security update is available.",
          sourceName: "Vendor Blog",
          tags: [],
        }),
      ],
      sources: ["vendor"],
      latestPublishedAt: "2026-05-17T00:00:00.000Z",
    });

    expect(packet.uncertainty).toContain("single-source");
    expect(packet.uncertainty).toContain("low-concrete-fact-density");
  });
});

import { describe, expect, it } from "vitest";
import { inferSourceTrust, scoreSourceTrust } from "../source-trust";

describe("source trust scoring", () => {
  it("prioritizes government sources over reputable media", () => {
    expect(
      scoreSourceTrust({ sourceClass: "government", authorityScore: 0.95 })
        .score,
    ).toBeGreaterThan(
      scoreSourceTrust({ sourceClass: "reputable-media", authorityScore: 0.7 })
        .score,
    );
  });

  it("penalizes marketing and webinar noise", () => {
    const scored = scoreSourceTrust({
      sourceClass: "vendor-advisory",
      authorityScore: 0.8,
      noiseRisk: "webinar",
    });

    expect(scored.penalties).toContain("noise:webinar");
  });

  it("infers structured vulnerability sources as primary evidence", () => {
    const trust = inferSourceTrust({
      id: "nvd-recent",
      name: "NVD",
      type: "nvd-json",
      category: "vulnerabilities",
      enabled: true,
    });

    expect(trust.sourceClass).toBe("structured-vulnerability");
    expect(trust.verificationRole).toBe("primary-evidence");
    expect(scoreSourceTrust(trust).score).toBeGreaterThan(0.8);
  });
});

import { describe, expect, it } from "vitest";
import { sharesIncidentSignature } from "../../utils/dedup";

describe("incident duplicate signatures", () => {
  it("matches same victim and count across paraphrased breach headlines", () => {
    expect(
      sharesIncidentSignature(
        "Vimeo data breach exposes personal information of 119,000 people",
        "ShinyHunters Breaches Vimeo, Leaks 119K User Records",
      ),
    ).toBe(true);
  });

  it("does not match unrelated incidents that only share breach wording", () => {
    expect(
      sharesIncidentSignature(
        "Vimeo data breach exposes personal information of 119,000 people",
        "Acme Hospital breach exposes personal information of 119K patients",
      ),
    ).toBe(false);
  });

  it("does not treat shared publication years as incident counts", () => {
    expect(
      sharesIncidentSignature(
        "Critical Remote Code Execution Vulnerability Patched in Android 2026",
        "GPT-5 Release: Security Implications for Enterprise Defenders in 2026",
      ),
    ).toBe(false);
  });

  it("does not match non-breach stories just because they share a user count", () => {
    expect(
      sharesIncidentSignature(
        "Microsoft Details Phishing Campaign Targeting 35,000 Users Across 26 Countries",
        "ClickFix Malware Campaign Evades macOS Defenses via Script Editor",
      ),
    ).toBe(false);
  });
});

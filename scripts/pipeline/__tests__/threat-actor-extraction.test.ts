/**
 * Threat-actor extraction tests — pins the B-015 list expansion
 * (2026-04-22: 67 → 94 canonical actors) AND pins the existing
 * ambiguous-alias + word-boundary discipline so a future edit to
 * known-threat-actors.json can't silently regress.
 */
import { describe, it, expect } from "vitest";
import { extractThreatActor } from "../post-process";

describe("extractThreatActor — existing canonical actors (regression guard)", () => {
  it("matches LockBit aliases to canonical form", () => {
    expect(
      extractThreatActor(
        "The LockBit 4.0 affiliate encrypted the file server.",
      ),
    ).toBe("LockBit");
  });

  it("matches BlackCat via ALPHV alias", () => {
    expect(
      extractThreatActor("ALPHV affiliates posted the leak on their blog."),
    ).toBe("BlackCat");
  });

  it("ambiguous alias 'Play' requires threat context", () => {
    // Without context — should NOT match
    expect(
      extractThreatActor("Users play video games on the device."),
    ).toBeNull();
    // With context — should match
    expect(
      extractThreatActor(
        "The Play ransomware group claimed responsibility for the attack.",
      ),
    ).toBe("Play");
  });
});

describe("extractThreatActor — B-015 new additions (2026-04-23)", () => {
  // Each new actor gets a positive test to prove it's reachable via the
  // post-process extractor, not just sitting in the JSON.

  it("extracts 'The Gentlemen' (the canonical B-015 example)", () => {
    const body =
      "The Gentlemen ransomware group breached Adaptavist in April 2026 according to Trend Micro's investigation.";
    expect(extractThreatActor(body)).toBe("The Gentlemen");
  });

  it("extracts NGate", () => {
    expect(
      extractThreatActor("The NGate malware relays NFC data to attackers."),
    ).toBe("NGate");
  });

  it("extracts JanelaRAT", () => {
    expect(
      extractThreatActor("JanelaRAT targets Latin American banking customers."),
    ).toBe("JanelaRAT");
  });

  it("extracts CanisterWiper", () => {
    expect(
      extractThreatActor(
        "Researchers analysed CanisterWiper, a new wiper targeting Iran.",
      ),
    ).toBe("CanisterWiper");
  });

  it("extracts Lumma Stealer via multiple aliases", () => {
    expect(
      extractThreatActor("LummaC2 was observed exfiltrating browser data."),
    ).toBe("Lumma Stealer");
    expect(
      extractThreatActor("Lumma Stealer samples were found in the campaign."),
    ).toBe("Lumma Stealer");
  });

  it("extracts Salt Typhoon via alias", () => {
    expect(
      extractThreatActor(
        "Ghost Emperor operators targeted telecom routers for espionage.",
      ),
    ).toBe("Salt Typhoon");
  });

  it("extracts Storm-0978 via RomCom alias", () => {
    expect(
      extractThreatActor(
        "RomCom backdoor was deployed after initial phishing access.",
      ),
    ).toBe("Storm-0978");
  });

  it("extracts Charming Kitten via APT35 alias", () => {
    expect(
      extractThreatActor("APT35 operators compromised the journalist's email."),
    ).toBe("Charming Kitten");
  });
});

describe("extractThreatActor — returns null on unknown actor", () => {
  it("returns null when no known actor is present", () => {
    expect(
      extractThreatActor("An unknown threat actor breached the network."),
    ).toBeNull();
  });
});

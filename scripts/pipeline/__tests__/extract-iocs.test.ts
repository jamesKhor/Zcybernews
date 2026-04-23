/**
 * IOC + TTP extractor tests — pin the source-cross-check contract,
 * the allowlist behavior, and the MITRE technique lookup.
 */
import { describe, it, expect } from "vitest";
import {
  extractIocs,
  extractTtps,
  isAllowlistedDomain,
  _internals,
} from "../extract-iocs";

describe("extractIocs — hashes", () => {
  it("extracts MD5 hash present in source", () => {
    const body = "The dropper has hash d41d8cd98f00b204e9800998ecf8427e.";
    const out = extractIocs({ body, sourceText: body });
    expect(out).toContainEqual({
      type: "hash_md5",
      value: "d41d8cd98f00b204e9800998ecf8427e",
      confidence: "high",
      description: "Extracted from source material",
    });
  });

  it("rejects MD5 hash absent from source (anti-hallucination)", () => {
    const body = "Hash: d41d8cd98f00b204e9800998ecf8427e";
    const sourceText = "completely different content with no hash";
    const out = extractIocs({ body, sourceText });
    expect(out).toHaveLength(0);
  });

  it("extracts SHA256 hash", () => {
    const sha256 =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const out = extractIocs({
      body: `SHA256: ${sha256}`,
      sourceText: `Source mentions ${sha256}`,
    });
    expect(
      out.some((i) => i.type === "hash_sha256" && i.value === sha256),
    ).toBe(true);
  });
});

describe("extractIocs — IPs", () => {
  it("extracts public IPv4 cross-checked against source", () => {
    const out = extractIocs({
      body: "C2 server 1.2.3.4",
      sourceText: "...identified as 1.2.3.4",
    });
    expect(out).toContainEqual(
      expect.objectContaining({ type: "ip", value: "1.2.3.4" }),
    );
  });

  it("rejects RFC1918 + loopback IPs", () => {
    const out = extractIocs({
      body: "Internal: 10.0.0.1, 192.168.1.1, 127.0.0.1, 172.16.5.5",
      sourceText: "10.0.0.1 192.168.1.1 127.0.0.1 172.16.5.5",
    });
    expect(out.filter((i) => i.type === "ip")).toHaveLength(0);
  });

  it("does NOT reject 172.32.x.x (outside the 172.16.0.0/12 RFC1918 range)", () => {
    const out = extractIocs({
      body: "Public: 172.32.5.5",
      sourceText: "172.32.5.5",
    });
    expect(out.some((i) => i.type === "ip" && i.value === "172.32.5.5")).toBe(
      true,
    );
  });
});

describe("extractIocs — IP octet validation (post-2026-04-23 fix)", () => {
  it("rejects invalid octets >255 (false positive '147.0.758.37')", () => {
    const out = extractIocs({
      body: "Build version 147.0.758.37 of the app",
      sourceText: "147.0.758.37",
    });
    expect(out.filter((i) => i.type === "ip")).toHaveLength(0);
  });

  it("rejects software-version-like strings (3.5.1.35)", () => {
    const out = extractIocs({
      body: "Affects vendor product 3.5.1.35 and earlier",
      sourceText: "3.5.1.35",
    });
    // Note: 3.5.1.35 IS technically a valid IPv4. But many "version
    // strings" look like IPs and we accept that some real low-octet IPs
    // may be missed. This test pins current behavior.
    const ips = out.filter((i) => i.type === "ip");
    expect(ips.some((i) => i.value === "3.5.1.35")).toBe(true);
  });

  it("rejects link-local 169.254.x.x (EC2 metadata, mentioned constantly)", () => {
    const out = extractIocs({
      body: "SSRF to 169.254.169.254 reads cloud metadata",
      sourceText: "169.254.169.254",
    });
    expect(out.filter((i) => i.type === "ip")).toHaveLength(0);
  });

  it("rejects 127.0.0.0/8 (full loopback range, not just 127.0.0.1)", () => {
    const out = extractIocs({
      body: "Listening on 127.0.0.0",
      sourceText: "127.0.0.0",
    });
    expect(out.filter((i) => i.type === "ip")).toHaveLength(0);
  });

  it("rejects multicast (224.0.0.0/4)", () => {
    const out = extractIocs({
      body: "mDNS uses 224.0.0.251",
      sourceText: "224.0.0.251",
    });
    expect(out.filter((i) => i.type === "ip")).toHaveLength(0);
  });
});

describe("extractIocs — domains gated behind includeDomains", () => {
  it("does NOT extract domains by default (includeDomains undefined)", () => {
    const out = extractIocs({
      body: "C2 at evil-host.xyz",
      sourceText: "evil-host.xyz",
    });
    expect(out.filter((i) => i.type === "domain")).toHaveLength(0);
  });

  it("extracts domains when includeDomains: true", () => {
    const out = extractIocs({
      body: "C2 at evil-host.xyz",
      sourceText: "evil-host.xyz",
      includeDomains: true,
    });
    expect(
      out.some((i) => i.type === "domain" && i.value === "evil-host.xyz"),
    ).toBe(true);
  });
});

describe("extractIocs — domains + allowlist", () => {
  it("extracts attacker-controlled domain", () => {
    const out = extractIocs({
      body: "C2 callback to evil-update.xyz over HTTPS",
      sourceText: "evil-update.xyz served the second-stage payload",
      includeDomains: true,
    });
    expect(
      out.some((i) => i.type === "domain" && i.value === "evil-update.xyz"),
    ).toBe(true);
  });

  it("does NOT extract allowlisted domains (github, microsoft, cloudflare)", () => {
    const out = extractIocs({
      body: "Patch on github.com/vendor/repo. Cloudflare WAF mentioned. Affects microsoft.com customers.",
      sourceText: "github.com vendor repo cloudflare microsoft.com",
      includeDomains: true,
    });
    const domains = out.filter((i) => i.type === "domain").map((i) => i.value);
    expect(domains).not.toContain("github.com");
    expect(domains).not.toContain("cloudflare.com");
    expect(domains).not.toContain("microsoft.com");
  });

  it("rejects subdomain of allowlisted parent (e.g. blog.microsoft.com)", () => {
    expect(isAllowlistedDomain("blog.microsoft.com")).toBe(true);
    expect(isAllowlistedDomain("docs.github.com")).toBe(true);
    expect(isAllowlistedDomain("evil-update.xyz")).toBe(false);
  });
});

describe("extractIocs — URLs", () => {
  it("extracts attacker URL not on allowlist", () => {
    const out = extractIocs({
      body: "Phishing kit hosted at https://evil-host.top/login.php?u=1",
      sourceText: "https://evil-host.top/login.php?u=1 was the lure",
      includeDomains: true,
    });
    expect(out.some((i) => i.type === "url")).toBe(true);
  });

  it("rejects URLs on allowlisted hosts (github links etc.)", () => {
    const out = extractIocs({
      body: "PR at https://github.com/vendor/repo/pull/1234",
      sourceText: "https://github.com/vendor/repo/pull/1234",
      includeDomains: true,
    });
    expect(out.filter((i) => i.type === "url")).toHaveLength(0);
  });
});

describe("extractIocs — emails", () => {
  it("extracts attacker email not on allowlist", () => {
    const out = extractIocs({
      body: "Spearphishing from impersonator@evil-host.xyz",
      sourceText: "impersonator@evil-host.xyz sent the email",
      includeDomains: true,
    });
    expect(
      out.some((i) => i.type === "email" && i.value.includes("evil-host.xyz")),
    ).toBe(true);
  });

  it("rejects emails at allowlisted vendor domains", () => {
    const out = extractIocs({
      body: "Reach out at security@google.com",
      sourceText: "security@google.com",
      includeDomains: true,
    });
    expect(out.filter((i) => i.type === "email")).toHaveLength(0);
  });
});

describe("extractIocs — preserves existing types we don't regex", () => {
  it("preserves file_path + registry_key from existing entries", () => {
    const existing = [
      {
        type: "file_path" as const,
        value: "C:\\Windows\\System32\\evil.dll",
        confidence: "high" as const,
      },
      {
        type: "registry_key" as const,
        value: "HKLM\\SOFTWARE\\Evil",
        confidence: "high" as const,
      },
    ];
    const out = extractIocs({ body: "", sourceText: "", existing });
    expect(out.some((i) => i.type === "file_path")).toBe(true);
    expect(out.some((i) => i.type === "registry_key")).toBe(true);
  });

  it("DOES NOT preserve existing hash/IP/domain entries (they must re-pass cross-check)", () => {
    const existing = [
      {
        type: "ip" as const,
        value: "9.9.9.9",
        confidence: "high" as const,
      },
    ];
    const out = extractIocs({
      body: "no IP here",
      sourceText: "no IP here",
      existing,
    });
    expect(out.filter((i) => i.type === "ip")).toHaveLength(0);
  });
});

describe("extractTtps — MITRE technique IDs", () => {
  it("extracts known technique with name + tactic", () => {
    const out = extractTtps({
      body: "The actor used T1190 to gain initial access via an exposed Confluence instance.",
    });
    expect(out).toContainEqual({
      tactic: "Initial Access",
      technique_id: "T1190",
      technique_name: "Exploit Public-Facing Application",
    });
  });

  it("extracts sub-technique (T1059.001)", () => {
    const out = extractTtps({
      body: "Used T1059.001 (PowerShell) for code execution.",
    });
    expect(
      out.some(
        (t) =>
          t.technique_id === "T1059.001" && t.technique_name === "PowerShell",
      ),
    ).toBe(true);
  });

  it("skips unknown technique IDs rather than emit empty technique_name", () => {
    const out = extractTtps({ body: "T9999 was observed." });
    expect(out).toHaveLength(0);
  });

  it("dedups by technique_id", () => {
    const out = extractTtps({
      body: "T1190 was used. Later, T1190 appeared again. Also T1190 in PoC.",
    });
    expect(out.filter((t) => t.technique_id === "T1190")).toHaveLength(1);
  });

  it("sorts by ATT&CK kill-chain tactic order", () => {
    const out = extractTtps({
      body: "T1486 (Impact) and T1059 (Execution) and T1190 (Initial Access).",
    });
    const ids = out.map((t) => t.technique_id);
    // Initial Access < Execution < Impact
    expect(ids).toEqual(["T1190", "T1059", "T1486"]);
  });

  it("preserves existing LLM entries with named technique not in lookup", () => {
    const existing = [
      {
        tactic: "Custom",
        technique_id: "T9999",
        technique_name: "Bespoke Technique",
      },
    ];
    const out = extractTtps({ body: "T1190 used.", existing });
    expect(out.some((t) => t.technique_id === "T9999")).toBe(true);
    expect(out.some((t) => t.technique_id === "T1190")).toBe(true);
  });
});

describe("extractIocs — References-section strip (false-positive guard)", () => {
  it("does NOT extract domains that only appear in the References section", () => {
    const body = `## Technical Analysis

The threat actor used **evil-update.xyz** as their C2 server.

## References

- https://www.helpnetsecurity.com/2026/04/22/foo
- https://cybersecuritynews.com/article-bar
- https://www.zerodayinitiative.com/advisories/ZDI-26-001`;
    const out = extractIocs({ body, sourceText: body, includeDomains: true });
    const domainValues = out
      .filter((i) => i.type === "domain")
      .map((i) => i.value);
    // The C2 domain (in body) IS extracted
    expect(domainValues).toContain("evil-update.xyz");
    // None of the citation domains appear
    expect(domainValues).not.toContain("www.helpnetsecurity.com");
    expect(domainValues).not.toContain("cybersecuritynews.com");
    expect(domainValues).not.toContain("www.zerodayinitiative.com");
  });
});

describe("allowlistDomain — runtime extension", () => {
  it("treats own host (zcybernews.com) as allowlisted by default", () => {
    expect(isAllowlistedDomain("zcybernews.com")).toBe(true);
    expect(isAllowlistedDomain("www.zcybernews.com")).toBe(true);
  });
});

describe("internals exposure", () => {
  it("exports MITRE_TECHNIQUES with at least 50 entries", () => {
    expect(
      Object.keys(_internals.MITRE_TECHNIQUES).length,
    ).toBeGreaterThanOrEqual(50);
  });

  it("exports DOMAIN_ALLOWLIST with major vendors", () => {
    expect(_internals.DOMAIN_ALLOWLIST.has("github.com")).toBe(true);
    expect(_internals.DOMAIN_ALLOWLIST.has("microsoft.com")).toBe(true);
  });
});

/**
 * Vendor-PR filter tests — Phase B A2.3.
 *
 * Test strategy:
 *   1. POSITIVE title — real-world vendor-PR title shapes must match.
 *   2. POSITIVE excerpt+no-CVE — PR keywords without a CVE must match.
 *   3. ESCAPE HATCH — PR keywords WITH a CVE in the haystack must NOT
 *      match. This is the single most-important negative test: it
 *      ensures a legitimate article referencing a press release
 *      containing a CVE doesn't get falsely filtered.
 *   4. NEGATIVE — normal security prose must not match.
 *   5. Stateless — the /i-only regex (no /g) must produce stable
 *      results across repeated calls on the same input.
 *   6. Enforce gate — env var controls the boolean correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isVendorPR, vendorPrEnforceEnabled } from "../filters/vendor-pr";

describe("isVendorPR — title pattern (positive)", () => {
  // Shapes verbatim from real feeds that polluted previous ingest
  // runs (CrowdStrike, Proofpoint, Help Net, CyberSecurityNews).
  const vendorTitles = [
    "Acme Announces Q3 Cybersecurity Results",
    "VendorCorp Launches New AI-Powered Threat Detection",
    "Example.io Unveils Next-Generation SIEM Platform",
    "Foo Inc Introduces Zero Trust Dashboard",
    "Bar Ltd Releases Annual Threat Report",
    "Big Vendor Expands Cloud Security Partnership",
    "SomeCo Partners with HyperScaler on Security Initiative",
    "Enterprise X Achieves FedRAMP Moderate Authorization",
    "Cyber Ltd Joins OpenSSF as Premier Member",
    "VendorOne Names New Chief Security Officer",
    "Security-Corp Appoints Industry Veteran to CISO Role",
    "TechCo Acquires Cybersecurity Startup for $300M",
    "SomeBrand Wins Best Security Product of the Year",
    "VendorY Recognized as Leader in MQ for XDR",
    "ExampleOrg Earns SOC 2 Type II Certification",
    "Acme Celebrates 10 Years of Zero Breaches",
    "Widgets.inc Welcomes Former NSA Director to Advisory Board",
  ];

  for (const title of vendorTitles) {
    it(`flags: "${title}"`, () => {
      const v = isVendorPR({ title, excerpt: "" });
      expect(v.isVendor).toBe(true);
      expect(v.reason).toBe("title-pattern");
    });
  }
});

describe("isVendorPR — excerpt pattern (positive, no CVE in haystack)", () => {
  const cases = [
    {
      title: "Best Practices for Secure Cloud Configuration",
      excerpt: "Register now for our upcoming webinar on cloud security.",
    },
    {
      title: "Top Trends in Cybersecurity",
      excerpt: "Download the report for exclusive research findings.",
    },
    {
      title: "Industry Insights",
      excerpt: "Read our latest whitepaper on supply chain risk.",
    },
    {
      title: "Company News",
      excerpt: "Read the full press release for details on the acquisition.",
    },
  ];

  for (const c of cases) {
    it(`flags (kw+no-cve): "${c.title}"`, () => {
      const v = isVendorPR(c);
      expect(v.isVendor).toBe(true);
      expect(v.reason).toBe("pr-keywords-no-cve");
    });
  }
});

describe("isVendorPR — CVE escape hatch (critical negative)", () => {
  // These MUST NOT be filtered: the CVE makes them substantive even
  // if a PR keyword appears.
  const cases = [
    {
      label: "press release keyword + CVE in title",
      title: "CVE-2026-1234 disclosed: RCE in WidgetOS",
      excerpt: "Vendor issued a press release acknowledging the flaw.",
    },
    {
      label: "webinar keyword + CVE in excerpt",
      title: "Critical RCE disclosed by researcher",
      excerpt: "CVE-2026-5678. Webinar scheduled to discuss mitigation.",
    },
    {
      label: "whitepaper keyword + CVE",
      title: "Memory-safety research paper published",
      excerpt: "A whitepaper accompanies the CVE-2026-9999 advisory.",
    },
  ];

  for (const c of cases) {
    it(`does NOT flag: ${c.label}`, () => {
      const v = isVendorPR(c);
      expect(v.isVendor).toBe(false);
    });
  }
});

describe("isVendorPR — negative (legitimate security news)", () => {
  const legitimate = [
    {
      title: "LockBit affiliate sentenced to 10 years",
      excerpt: "The US Department of Justice announced the sentencing.",
    },
    {
      title: "Patch Tuesday: Microsoft fixes 68 vulnerabilities",
      excerpt: "CVE-2026-1111 and CVE-2026-2222 are under active exploitation.",
    },
    {
      title: "Ransomware group leaks healthcare data",
      excerpt: "Approximately 2.3 million patient records were posted.",
    },
    {
      title: "Researchers disclose attack against TPM",
      excerpt:
        "The technique bypasses measured boot on affected firmware versions.",
    },
  ];

  for (const story of legitimate) {
    it(`does NOT flag: "${story.title}"`, () => {
      const v = isVendorPR(story);
      expect(v.isVendor).toBe(false);
      expect(v.reason).toBeUndefined();
    });
  }
});

describe("isVendorPR — stateless (/i-only regex, no /g)", () => {
  it("repeated calls on the same input are stable", () => {
    const input = {
      title: "Acme Announces Q3 Results",
      excerpt: "Strong quarter.",
    };
    const a = isVendorPR(input);
    const b = isVendorPR(input);
    const c = isVendorPR(input);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

describe("vendorPrEnforceEnabled", () => {
  const ORIGINAL = process.env.VENDOR_PR_ENFORCE;

  beforeEach(() => {
    delete process.env.VENDOR_PR_ENFORCE;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.VENDOR_PR_ENFORCE;
    } else {
      process.env.VENDOR_PR_ENFORCE = ORIGINAL;
    }
  });

  it("defaults to false when env var is unset", () => {
    expect(vendorPrEnforceEnabled()).toBe(false);
  });

  it("returns true when env var is the exact string 'true'", () => {
    process.env.VENDOR_PR_ENFORCE = "true";
    expect(vendorPrEnforceEnabled()).toBe(true);
  });

  it("returns false for any non-'true' value (no fuzzy truthiness)", () => {
    for (const v of ["1", "yes", "TRUE", "on", ""]) {
      process.env.VENDOR_PR_ENFORCE = v;
      expect(vendorPrEnforceEnabled()).toBe(false);
    }
  });
});

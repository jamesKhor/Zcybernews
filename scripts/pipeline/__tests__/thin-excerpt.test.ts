/**
 * Thin-excerpt filter tests — 2026-04-24.
 *
 * Canonical case: SANS ISC Stormcast RSS entries ship only a
 * copyright notice in the description. The real topics live in the
 * podcast audio at /podcastdetail/NNNN. When the pipeline generates
 * against a Stormcast item, the LLM hallucinates "No Major Incidents
 * Reported" filler — observed on 2026-04-24 and the trigger for this
 * filter. See thin-excerpt.ts header for full root-cause trace.
 */
import { describe, it, expect } from "vitest";
import { isThinExcerpt, THIN_EXCERPT_INTERNALS } from "../filters/thin-excerpt";

describe("isThinExcerpt — boilerplate-only (SANS Stormcast)", () => {
  it("drops the canonical SANS copyright-only excerpt", () => {
    const v = isThinExcerpt({
      title: "ISC Stormcast For Friday, April 24th, 2026",
      excerpt:
        "(c) SANS Internet Storm Center. https://isc.sans.edu Creative Commons Attribution-Noncommercial 3.0 United States License.",
    });
    expect(v.isThin).toBe(true);
    // The URL between the (c) and CC patterns leaves a short
    // non-zero residue; the key contract is isThin=true and the
    // reason is one of the two "nothing to generate from" verdicts.
    expect(["boilerplate-only", "below-threshold"]).toContain(v.reason);
    expect(v.substantiveChars).toBeLessThan(
      THIN_EXCERPT_INTERNALS.MIN_SUBSTANTIVE_CHARS,
    );
  });

  it("drops © unicode copyright + CC attribution mix", () => {
    const v = isThinExcerpt({
      title: "Daily Podcast",
      excerpt:
        "© 2026 SANS Institute. Creative Commons Attribution-Noncommercial 3.0 license.",
    });
    expect(v.isThin).toBe(true);
    expect(["boilerplate-only", "below-threshold"]).toContain(v.reason);
  });
});

describe("isThinExcerpt — empty", () => {
  it("empty string is thin (reason=empty)", () => {
    expect(isThinExcerpt({ title: "t", excerpt: "" })).toEqual({
      isThin: true,
      substantiveChars: 0,
      reason: "empty",
    });
  });

  it("whitespace-only is thin (reason=empty)", () => {
    expect(isThinExcerpt({ title: "t", excerpt: "   \n\t  " })).toEqual({
      isThin: true,
      substantiveChars: 0,
      reason: "empty",
    });
  });
});

describe("isThinExcerpt — below-threshold", () => {
  it("a short real excerpt (<120 substantive chars) is thin", () => {
    // ~80 substantive chars — real prose but too thin to be worth
    // generating against.
    const v = isThinExcerpt({
      title: "Short Update",
      excerpt: "A brief note about a bug that was fixed upstream yesterday.",
    });
    expect(v.isThin).toBe(true);
    expect(v.reason).toBe("below-threshold");
    expect(v.substantiveChars).toBeGreaterThan(0);
    expect(v.substantiveChars).toBeLessThan(
      THIN_EXCERPT_INTERNALS.MIN_SUBSTANTIVE_CHARS,
    );
  });
});

describe("isThinExcerpt — passes (real article)", () => {
  it("a substantive cyber-news excerpt passes", () => {
    const excerpt =
      "Microsoft has patched a critical vulnerability in Windows Server that allowed unauthenticated remote attackers to execute arbitrary code via a malformed Kerberos ticket. The flaw, tracked as CVE-2026-40372, carries a CVSS score of 9.8 and affects all supported Windows Server versions. Admins should apply the April 2026 cumulative update immediately; workarounds are limited to disabling Kerberos pre-authentication on affected DCs.";
    const v = isThinExcerpt({
      title: "Microsoft patches critical Kerberos RCE",
      excerpt,
    });
    expect(v.isThin).toBe(false);
    expect(v.substantiveChars).toBeGreaterThanOrEqual(
      THIN_EXCERPT_INTERNALS.MIN_SUBSTANTIVE_CHARS,
    );
  });

  it("copyright + substantive prose together passes (boilerplate stripped, prose remains)", () => {
    // Guards against over-stripping: a real excerpt that happens to
    // carry a trailing copyright notice must still pass.
    const excerpt =
      "Researchers at BlueHat disclosed a novel side-channel attack against Intel TDX that leaks enclave memory across tenant boundaries at roughly 8 kilobits per second. The technique abuses a timing oracle in the remote attestation path and has been reproduced on three generations of Xeon silicon. Intel has acknowledged the report and is preparing a microcode mitigation. (c) 2026 BlueHat Research.";
    const v = isThinExcerpt({ title: "TDX side-channel", excerpt });
    expect(v.isThin).toBe(false);
  });
});

describe("substantiveCharCount — boilerplate strip", () => {
  const { substantiveCharCount } = THIN_EXCERPT_INTERNALS;

  it("strips (c) copyright notice", () => {
    expect(
      substantiveCharCount("(c) SANS Internet Storm Center. leftover"),
    ).toBeLessThanOrEqual("leftover".length + 2);
  });

  it("strips Creative Commons attribution", () => {
    const before = "hello Creative Commons Attribution-Noncommercial 3.0 US.";
    expect(substantiveCharCount(before)).toBeLessThan(before.length);
  });

  it("strips utm_ tracking params", () => {
    const before = "real prose utm_source=rss utm_medium=feed more prose";
    const after = substantiveCharCount(before);
    expect(after).toBeLessThan(before.length);
  });
});
